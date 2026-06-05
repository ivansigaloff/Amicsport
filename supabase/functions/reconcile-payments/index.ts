// Edge Function: reconcile-payments
//
// Reconciles PENDING payments older than 15 minutes against Monei.
// Designed to run on a schedule (e.g. every hour via Supabase cron or pg_cron).
// Can also be triggered manually by an admin via POST.
//
// For each stale PENDING payment:
//   - Queries Monei GET /payments/{id}
//   - Updates DB status to match Monei
//   - Creates participant row if SUCCEEDED and not yet created
//   - Marks as EXPIRED if >24h still PENDING in Monei
//
// Authorization: requires RECONCILE_SECRET header (set as a Supabase secret).
// This avoids exposing it as a public unauthenticated endpoint.
//
// Deploy:
//   supabase functions deploy reconcile-payments --no-verify-jwt
//   supabase secrets set RECONCILE_SECRET=<random-string>

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { moneiRequest } from '../_shared/monei.ts';
import { auditLog } from '../_shared/audit.ts';
import { confirmSlotOrRefund } from '../_shared/confirmSlot.ts';
import { timingSafeEqual } from '../_shared/timingSafeEqual.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RECONCILE_SECRET = Deno.env.get('RECONCILE_SECRET') ?? '';

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method_not_allowed', { status: 405 });
  }

  // Simple secret-based auth for cron / admin trigger.
  // Fail-closed: if RECONCILE_SECRET is unset, deny ALL requests rather than
  // letting the endpoint become public.
  const providedSecret = req.headers.get('x-reconcile-secret') ?? '';
  if (!RECONCILE_SECRET || !timingSafeEqual(providedSecret, RECONCILE_SECRET)) {
    return new Response('unauthorized', { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const startedAt = new Date();
  // 5 min, just UNDER reserve_paid_slot's 6-min freshness window: a paid hold
  // whose webhook was missed gets confirmed here BEFORE the freshness window
  // stops counting it, so its spot is never silently exposed (review case G).
  // Requires the cron to run frequently (every 1-2 min) to actually close the gap.
  const staleThreshold = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  // Load PENDING payments older than the threshold that have a Monei ID
  const { data: stalePending, error } = await admin
    .from('payments')
    .select('id, match_id, user_id, user_name, env, monei_payment_id, created_at, is_guest')
    .eq('status', 'PENDING')
    .lt('created_at', staleThreshold)
    .not('monei_payment_id', 'is', null)
    .limit(100);  // process max 100 per run to avoid timeout

  if (error) {
    console.error('reconcile: failed to load pending payments:', error);
    return new Response(JSON.stringify({ error: 'db_error' }), { status: 500 });
  }

  const results = { synced: 0, expired: 0, errors: 0, skipped: 0, repaired: 0 };
  const expiredThreshold = new Date(Date.now() - 60 * 60 * 1000); // 1h: a Monei-PENDING that old is dead (slot already freed by reserve_paid_slot's 6-min window)

  for (const payment of stalePending ?? []) {
    try {
      let moneiPayment: { status: string; paymentMethod?: { method?: string } };
      try {
        moneiPayment = await moneiRequest(`/payments/${payment.monei_payment_id}`);
      } catch {
        results.errors++;
        continue;
      }

      const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'REFUNDED']);

      if (!TERMINAL.has(moneiPayment.status)) {
        // Still PENDING in Monei — check if past 24h and expire locally
        if (new Date(payment.created_at) < expiredThreshold) {
          await admin.from('payments').update({ status: 'EXPIRED' }).eq('id', payment.id);
          await auditLog({
            env: payment.env, action: 'PAYMENT_EXPIRED',
            entity_type: 'payment', entity_id: payment.id,
            payload: { monei_status: moneiPayment.status, age_hours: Math.round((Date.now() - new Date(payment.created_at).getTime()) / 3600000) },
            source: 'reconcile',
          });
          results.expired++;
        } else {
          results.skipped++;
        }
        continue;
      }

      const updateData: Record<string, unknown> = {
        status:         moneiPayment.status,
        payment_method: moneiPayment.paymentMethod?.method,
      };

      if (moneiPayment.status === 'SUCCEEDED') {
        // Create the participant under the match lock — or QUEUE a return if the
        // match filled while this hold aged out, to avoid overbooking. The refund
        // worker below does the Monei call.
        const slot = await confirmSlotOrRefund(admin, payment);
        if (slot.participant_id) updateData.participant_id = slot.participant_id;
        if (slot.status) updateData.status = slot.status;  // 'PENDING_RETURN' when full
      }

      await admin.from('payments').update(updateData).eq('id', payment.id);
      await auditLog({
        env: payment.env, action: `RECONCILE_SYNCED`,
        entity_type: 'payment', entity_id: payment.id,
        payload: { monei_status: moneiPayment.status },
        source: 'reconcile',
      });
      results.synced++;

    } catch (e) {
      console.error(`reconcile: error processing payment ${payment.id}:`, e);
      results.errors++;
    }
  }

  // ── Repair SUCCEEDED-without-participant (review gap H) ──────────────────
  // A transient confirm failure can leave a payment SUCCEEDED with no
  // participant, and no other path retries it (webhook/verify treat SUCCEEDED
  // as resolved; the loop above only scans PENDING). Re-run the locked confirm.
  // Bounded to the last 24h: a transient failure is caught long before that, and
  // we must never auto-confirm/refund a historical payment for a past match.
  const repairSince = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: unconfirmed } = await admin
    .from('payments')
    .select('id, env, match_id, user_id, user_name, is_guest, participant_id')
    .eq('status', 'SUCCEEDED')
    .is('participant_id', null)
    .gte('created_at', repairSince)
    .limit(50);

  for (const payment of unconfirmed ?? []) {
    try {
      const slot = await confirmSlotOrRefund(admin, payment);
      const upd: Record<string, unknown> = {};
      if (slot.participant_id) upd.participant_id = slot.participant_id;
      if (slot.status) upd.status = slot.status;  // 'PENDING_RETURN' when full
      if (Object.keys(upd).length) {
        await admin.from('payments').update(upd).eq('id', payment.id);
        results.repaired++;
      }
    } catch (e) {
      console.error(`reconcile: repair failed for payment ${payment.id}:`, e);
      results.errors++;
    }
  }

  // ── Refund worker: the SINGLE owner of Monei /refund ────────────────────
  // Processes the async return queue. claim_returns atomically flips a batch
  // PENDING_RETURN -> RETURNING (FOR UPDATE SKIP LOCKED), so overlapping
  // reconcile runs never refund the same payment twice.
  const returns = { refunded: 0, requeued: 0, queued_admin: 0, errors: 0 };

  // (a) Recover RETURNING rows orphaned by a crashed run: ask Monei whether the
  //     refund actually went through, then finalize or requeue. Money-safe.
  const staleReturning = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const { data: orphans } = await admin
    .from('payments')
    .select('id, env, user_id, match_id, monei_payment_id, amount')
    .eq('status', 'RETURNING')
    .lt('updated_at', staleReturning)
    .limit(50);

  for (const pay of orphans ?? []) {
    if (!pay.monei_payment_id) {
      await admin.from('payments').update({ status: 'PENDING_RETURN' }).eq('id', pay.id);
      returns.requeued++;
      continue;
    }
    try {
      const m = await moneiRequest(`/payments/${pay.monei_payment_id}`);
      if (m.status === 'REFUNDED' || m.status === 'PARTIALLY_REFUNDED') {
        await admin.from('payments').update({
          status: m.status, refunded_amount: pay.amount, refunded_at: new Date().toISOString(),
        }).eq('id', pay.id);
        returns.refunded++;
      } else {
        await admin.from('payments').update({ status: 'PENDING_RETURN' }).eq('id', pay.id);
        returns.requeued++;
      }
    } catch {
      returns.errors++;  // leave RETURNING; next run retries
    }
  }

  // (b) Daily cap (this is now the only place refunds are issued).
  const [countRow, amountRow] = await Promise.all([
    admin.from('app_settings').select('value').eq('key', 'daily_refund_count_limit').single(),
    admin.from('app_settings').select('value').eq('key', 'daily_refund_amount_limit_cents').single(),
  ]);
  const countLimit  = Number(countRow.data?.value  ?? 10);
  const amountLimit = Number(amountRow.data?.value ?? 100000);
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const { data: todayRefunds } = await admin
    .from('payments').select('refunded_amount')
    .gte('refunded_at', dayStart.toISOString())
    .in('status', ['REFUNDED', 'PARTIALLY_REFUNDED']);
  let dayCount  = todayRefunds?.length ?? 0;
  let dayAmount = todayRefunds?.reduce((s, r) => s + (r.refunded_amount ?? 0), 0) ?? 0;

  // (c) Claim and process the queue.
  const { data: claimed, error: claimErr } = await admin.rpc('claim_returns', { p_limit: 50 });
  if (claimErr) console.error('claim_returns failed:', claimErr);

  for (const pay of claimed ?? []) {
    const amount = pay.amount - (pay.refunded_amount ?? 0);

    // Admin-requested returns bypass the daily cap (old "force" semantics).
    if (!pay.return_admin && (dayCount >= countLimit || dayAmount + amount > amountLimit)) {
      await admin.from('payments').update({ status: 'PENDING_REFUND_ADMIN' }).eq('id', pay.id);
      await auditLog({
        env: pay.env, actor_id: pay.user_id, action: 'REFUND_QUEUED_ADMIN',
        entity_type: 'payment', entity_id: pay.id,
        payload: { match_id: pay.match_id, amount, reason: 'daily_limit_exceeded' }, source: 'reconcile',
      });
      returns.queued_admin++;
      continue;
    }

    if (!pay.monei_payment_id) {
      await admin.from('payments').update({ status: 'PENDING_REFUND_ADMIN' }).eq('id', pay.id);
      returns.queued_admin++;
      continue;
    }

    try {
      await moneiRequest(`/payments/${pay.monei_payment_id}/refund`, 'POST', { refundAmount: amount });
    } catch (e) {
      // Transient (e.g. Monei down) → back to the queue for the next run.
      await admin.from('payments').update({ status: 'PENDING_RETURN' }).eq('id', pay.id);
      await auditLog({
        env: pay.env, actor_id: pay.user_id, action: 'REFUND_FAILED',
        entity_type: 'payment', entity_id: pay.id,
        payload: { error: String(e), amount }, source: 'reconcile',
      });
      returns.errors++;
      continue;
    }

    await admin.from('payments').update({
      status: 'REFUNDED', refunded_amount: (pay.refunded_amount ?? 0) + amount, refunded_at: new Date().toISOString(),
    }).eq('id', pay.id);
    await auditLog({
      env: pay.env, actor_id: pay.user_id, action: 'REFUND_ISSUED',
      entity_type: 'payment', entity_id: pay.id,
      payload: { match_id: pay.match_id, refund_amount: amount }, source: 'reconcile',
    });
    dayCount++; dayAmount += amount;
    returns.refunded++;
  }

  const durationMs = Date.now() - startedAt.getTime();
  await auditLog({
    action: 'RECONCILE_RUN',
    payload: { ...results, returns, total: stalePending?.length ?? 0, duration_ms: durationMs },
    source: 'reconcile',
  });

  return new Response(JSON.stringify({ ok: true, ...results, returns, duration_ms: durationMs }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
