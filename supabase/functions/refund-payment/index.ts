// Edge Function: refund-payment
//
// Issues a refund for a SUCCEEDED payment.
//
// Automatic path (user cancels their spot before deadline):
//   - Checks daily refund count and amount against app_settings limits
//   - If under limits: processes refund immediately
//   - If over limits: sets status PENDING_REFUND_ADMIN and notifies admin
//
// Manual path (admin triggers refund):
//   - Admin can refund any SUCCEEDED payment regardless of daily limits
//
// Deploy:
//   supabase functions deploy refund-payment

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { moneiRequest } from '../_shared/monei.ts';
import { auditLog } from '../_shared/audit.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'missing_auth' }, 401);

  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'invalid_jwt' }, 401);

  let body: { payment_id?: string; force?: boolean };
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const { payment_id, force = false } = body;
  if (!payment_id) return json({ error: 'payment_id required' }, 400);

  const isAdmin = (user.app_metadata?.role === 'admin');

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Load payment — user can only refund their own; admin can refund any
  const query = admin.from('payments').select('*').eq('id', payment_id);
  if (!isAdmin) query.eq('user_id', user.id);
  const { data: payment, error: pmtErr } = await query.maybeSingle();

  if (pmtErr || !payment) return json({ error: 'payment_not_found' }, 404);
  if (payment.status === 'REFUNDING') {
    // A concurrent refund already claimed this payment (see claim_refund).
    return json({ error: 'refund_in_progress' }, 409);
  }
  if (payment.status !== 'SUCCEEDED') {
    return json({ error: 'only_succeeded_payments_can_be_refunded', current_status: payment.status }, 409);
  }
  if (payment.refunded_amount >= payment.amount) {
    return json({ error: 'already_fully_refunded' }, 409);
  }

  // ── Cancellation deadline (server-side enforcement) ─────────────────────
  // The client (hooks/match/useMatchActions.ts) only blocks self-cancellation
  // in the UI; without this check a user could call this function directly and
  // get a refund AFTER the cutoff, costing us the (now unfillable) spot.
  // Admins bypass. Mirrors the client's wall-clock-in-Madrid comparison:
  // both "now" and the deadline are expressed as Madrid wall-clock instants so
  // DST offsets cancel out (no UTC conversion needed on either side).
  if (!isAdmin) {
    const matchTable = payment.env === 'dev' ? 'matches_dev' : 'matches';
    const { data: match } = await admin
      .from(matchTable)
      .select('match_date, time, cancellation_hours')
      .eq('id', payment.match_id)
      .maybeSingle();

    // Only enforce when we can resolve a concrete start instant. Legacy matches
    // with an unparseable date (match_date NULL) are left to the admin path.
    if (match?.match_date && match.time) {
      const [y, mo, d] = String(match.match_date).split('-').map(Number);
      const [h, mi] = String(match.time).split(':').map(Number);
      if (![y, mo, d, h, mi].some((n) => Number.isNaN(n))) {
        const startWall = Date.UTC(y, mo - 1, d, h, mi);
        const limitHours = match.cancellation_hours || 12;
        const deadlineWall = startWall - limitHours * 60 * 60 * 1000;

        // "Now" as Madrid wall-clock, encoded with Date.UTC for a frame match.
        const p = new Intl.DateTimeFormat('en-US', {
          timeZone: 'Europe/Madrid',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        }).formatToParts(new Date());
        const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
        const nowWall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));

        if (nowWall > deadlineWall) {
          await auditLog({
            env: payment.env, actor_id: user.id, actor_email: user.email,
            action: 'REFUND_BLOCKED_DEADLINE',
            entity_type: 'payment', entity_id: payment.id,
            payload: { match_id: payment.match_id, limit_hours: limitHours },
            source: 'app',
          });
          return json({ error: 'cancellation_deadline_passed', limit_hours: limitHours }, 403);
        }
      }
    }
  }

  // ── Atomically claim the refund (closes the double-refund race) ─────────
  // claim_refund locks the payment row, re-checks status + the daily limit
  // under a global advisory lock, and flips SUCCEEDED -> REFUNDING so only ONE
  // caller proceeds to Monei. Everything below runs with the claim held, so no
  // concurrent request can refund this payment again.
  // See migration 20260601000000_refund_claim_lock.sql.
  const { data: claim, error: claimErr } = await admin.rpc('claim_refund', {
    p_payment_id: payment_id,
    p_user_id:    user.id,
    p_is_admin:   isAdmin,
    p_force:      force,
  });
  if (claimErr || !claim) {
    console.error('claim_refund failed:', claimErr);
    return json({ error: 'db_error' }, 500);
  }

  switch (claim.outcome) {
    case 'not_found':
      return json({ error: 'payment_not_found' }, 404);
    case 'already_refunded':
      return json({ error: 'already_fully_refunded' }, 409);
    case 'not_succeeded':
      return claim.status === 'REFUNDING'
        ? json({ error: 'refund_in_progress' }, 409)
        : json({ error: 'only_succeeded_payments_can_be_refunded', current_status: claim.status }, 409);
    case 'blocked_limit':
      await auditLog({
        env: payment.env, actor_id: user.id, actor_email: user.email,
        action: 'REFUND_QUEUED_ADMIN',
        entity_type: 'payment', entity_id: payment.id,
        payload: { match_id: payment.match_id, amount: payment.amount, reason: 'daily_limit_exceeded' },
        source: isAdmin ? 'admin' : 'app',
      });
      return json({ status: 'PENDING_REFUND_ADMIN', message: 'Daily refund limit reached. An admin will process this refund.' });
    case 'claimed':
      break;  // proceed to Monei below
    default:
      console.error('claim_refund unknown outcome:', claim);
      return json({ error: 'db_error' }, 500);
  }

  // ── Process refund via Monei (claim held; payment is REFUNDING) ─────────
  const refundAmount: number = claim.refund_amount;
  try {
    await moneiRequest(`/payments/${claim.monei_payment_id}/refund`, 'POST', { refundAmount });
  } catch (e) {
    // Monei failed → release the claim (REFUNDING -> SUCCEEDED) so it can be
    // retried, and stop it counting against the daily cap.
    await admin.from('payments').update({ status: 'SUCCEEDED' }).eq('id', payment.id);
    await auditLog({
      env: payment.env, actor_id: user.id, actor_email: user.email,
      action: 'REFUND_FAILED',
      entity_type: 'payment', entity_id: payment.id,
      payload: { error: String(e), amount: refundAmount },
      source: isAdmin ? 'admin' : 'app',
    });
    return json({ error: 'monei_refund_failed' }, 502);  // detail kept server-side only
  }

  // Remove from match_participants (best-effort; log but don't fail the refund —
  // Monei already paid out).
  if (claim.participant_id) {
    const participantsTable = claim.env === 'dev' ? 'match_participants_dev' : 'match_participants';
    const { error: delErr } = await admin.from(participantsTable).delete().eq('id', claim.participant_id);
    if (delErr) console.error('refund: participant delete failed:', delErr);
  }

  // Finalize REFUNDING -> REFUNDED / PARTIALLY_REFUNDED.
  const newRefunded = claim.refunded_amount + refundAmount;
  const newStatus = newRefunded >= claim.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  const { error: finErr } = await admin.from('payments').update({
    status:          newStatus,
    refunded_amount: newRefunded,
    refunded_at:     new Date().toISOString(),
  }).eq('id', payment.id);
  if (finErr) {
    // Monei already refunded but the DB write failed: leave the row REFUNDING
    // for reconcile/admin to finalize rather than risk a wrong terminal state.
    console.error('refund: finalize update failed (Monei already refunded):', finErr);
  }

  await auditLog({
    env: payment.env, actor_id: user.id, actor_email: user.email,
    action: 'REFUND_ISSUED',
    entity_type: 'payment', entity_id: payment.id,
    payload: {
      match_id: payment.match_id, refund_amount: refundAmount,
      new_status: newStatus, by_admin: isAdmin,
    },
    source: isAdmin ? 'admin' : 'app',
  });

  return json({ status: newStatus, refunded_amount: refundAmount });
});
