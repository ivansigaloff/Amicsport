// Edge Function: verify-payment
//
// Called by the app when the user returns from the Monei payment page
// (via deep link or redirect). Checks the real status in Monei and
// reconciles it with the DB — covers the case where the webhook arrives
// before or after the user returns.
//
// Deploy:
//   supabase functions deploy verify-payment

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { moneiRequest } from '../_shared/monei.ts';
import { auditLog } from '../_shared/audit.ts';
import { confirmSlotOrRefund } from '../_shared/confirmSlot.ts';

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

  let body: { order_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const { order_id } = body;
  if (!order_id) return json({ error: 'order_id required' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Find payment — must belong to the requesting user
  const { data: payment, error: pmtErr } = await admin
    .from('payments')
    .select('*')
    .eq('order_id', order_id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (pmtErr || !payment) return json({ error: 'payment_not_found' }, 404);

  // If already resolved (terminal, or in the async-return pipeline), return the
  // current DB state — don't re-sync a payment the user has cancelled.
  const RESOLVED = new Set([
    'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED',
    'PENDING_RETURN', 'RETURNING', 'PENDING_REFUND_ADMIN',
  ]);
  if (RESOLVED.has(payment.status)) {
    return json({ status: payment.status, payment });
  }

  // Query Monei for the real current status
  if (!payment.monei_payment_id) {
    return json({ status: payment.status, payment });
  }

  let moneiPayment: { id: string; status: string; paymentMethod?: { method?: string }; statusMessage?: string };
  try {
    moneiPayment = await moneiRequest(`/payments/${payment.monei_payment_id}`);
  } catch (e) {
    console.error('Monei query failed:', e);
    return json({ status: payment.status, payment, warning: 'monei_unreachable' });
  }

  // Sync if status diverged
  if (moneiPayment.status !== payment.status) {
    const updateData: Record<string, unknown> = {
      status:         moneiPayment.status,
      payment_method: moneiPayment.paymentMethod?.method,
      error_message:  moneiPayment.statusMessage,
    };

    // If SUCCEEDED but participant not yet created: create it under the match
    // lock — or QUEUE a return if the match filled while the hold aged out, so
    // we never overbook. The refund worker (reconcile-payments) does the Monei
    // call; here we just persist PENDING_RETURN.
    if (moneiPayment.status === 'SUCCEEDED' && !payment.participant_id) {
      const slot = await confirmSlotOrRefund(admin, payment);
      if (slot.participant_id) updateData.participant_id = slot.participant_id;
      if (slot.status) updateData.status = slot.status;  // 'PENDING_RETURN' when full
    }

    await admin.from('payments').update(updateData).eq('id', payment.id);

    await auditLog({
      env: payment.env, actor_id: user.id, actor_email: user.email,
      action: 'PAYMENT_VERIFIED_SYNCED',
      entity_type: 'payment', entity_id: payment.id,
      payload: { old_status: payment.status, new_status: moneiPayment.status },
      source: 'app',
    });

    return json({ status: updateData.status, payment: { ...payment, ...updateData } });
  }

  return json({ status: payment.status, payment });
});
