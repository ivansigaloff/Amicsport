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
  if (!RECONCILE_SECRET || providedSecret !== RECONCILE_SECRET) {
    return new Response('unauthorized', { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const startedAt = new Date();
  const staleThreshold = new Date(Date.now() - 15 * 60 * 1000).toISOString();

  // Load all PENDING payments older than 15 minutes that have a Monei ID
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

  const results = { synced: 0, expired: 0, errors: 0, skipped: 0 };
  const expiredThreshold = new Date(Date.now() - 60 * 60 * 1000); // 1h: a Monei-PENDING that old is dead (slot already freed by reserve_paid_slot's 10-min window)

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
        // Create the participant — or REFUND if the match filled while this hold
        // aged out (reserve_paid_slot freshness window), to avoid overbooking.
        const slot = await confirmSlotOrRefund(admin, payment);
        if (slot.participant_id) updateData.participant_id = slot.participant_id;
        if (slot.status) {
          updateData.status = slot.status;
          if (slot.refunded_amount != null) { updateData.refunded_amount = slot.refunded_amount; updateData.refunded_at = slot.refunded_at; }
        }
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

  const durationMs = Date.now() - startedAt.getTime();
  await auditLog({
    action: 'RECONCILE_RUN',
    payload: { ...results, total: stalePending?.length ?? 0, duration_ms: durationMs },
    source: 'reconcile',
  });

  return new Response(JSON.stringify({ ok: true, ...results, duration_ms: durationMs }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
