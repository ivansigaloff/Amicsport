// Edge Function: refund-payment
//
// Requests a refund ("return") for a SUCCEEDED payment. ASYNCHRONOUS by design:
// this function only records the intent and frees the spot — it does NOT call
// Monei. The single refund worker in reconcile-payments sends every Monei
// /refund, so refunds can never be issued twice by concurrent requests.
//
// Flow:
//   1. Validate auth + ownership + status + cancellation deadline.
//   2. request_return() atomically flips SUCCEEDED -> PENDING_RETURN and deletes
//      the participant (spot is resellable immediately).
//   3. The worker later calls Monei and moves PENDING_RETURN -> REFUNDED.
//
// Admins bypass the deadline. Daily refund limits are enforced by the worker.
//
// Deploy:
//   supabase functions deploy refund-payment

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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

  let body: { payment_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const { payment_id } = body;
  if (!payment_id) return json({ error: 'payment_id required' }, 400);

  const isAdmin = (user.app_metadata?.role === 'admin');

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Load payment — user can only cancel their own; admin can cancel any. Used
  // for the deadline gate; request_return re-validates authoritatively.
  const query = admin.from('payments').select('id, env, match_id, status, user_id').eq('id', payment_id);
  if (!isAdmin) query.eq('user_id', user.id);
  const { data: payment, error: pmtErr } = await query.maybeSingle();

  if (pmtErr || !payment) return json({ error: 'payment_not_found' }, 404);

  // ── Cancellation deadline (server-side enforcement, non-admins) ─────────
  // The client (hooks/match/useMatchActions.ts) only blocks self-cancellation
  // in the UI; without this a user could call this function directly and get a
  // refund AFTER the cutoff, costing us the (now unfillable) spot. Mirrors the
  // client's wall-clock-in-Madrid comparison so DST offsets cancel out.
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

  // ── Queue the return (atomic; frees the spot; no Monei call here) ────────
  const { data: result, error: reqErr } = await admin.rpc('request_return', {
    p_payment_id: payment_id,
    p_user_id:    user.id,
    p_is_admin:   isAdmin,
  });
  if (reqErr || !result) {
    console.error('request_return failed:', reqErr);
    return json({ error: 'db_error' }, 500);
  }

  switch (result.outcome) {
    case 'not_found':
      return json({ error: 'payment_not_found' }, 404);
    case 'already_requested':
      // Idempotent: a return is already queued / in flight.
      return json({ status: 'PENDING_RETURN', message: 'Refund already requested. It is being processed.' });
    case 'already_refunded':
      return json({ error: 'already_fully_refunded' }, 409);
    case 'not_succeeded':
      return json({ error: 'only_succeeded_payments_can_be_refunded', current_status: result.status }, 409);
    case 'queued':
      break;
    default:
      console.error('request_return unknown outcome:', result);
      return json({ error: 'db_error' }, 500);
  }

  await auditLog({
    env: payment.env, actor_id: user.id, actor_email: user.email,
    action: 'REFUND_REQUESTED',
    entity_type: 'payment', entity_id: payment.id,
    payload: { match_id: payment.match_id, by_admin: isAdmin },
    source: isAdmin ? 'admin' : 'app',
  });

  return json({ status: 'PENDING_RETURN', message: 'Refund requested. It will be processed shortly.' });
});
