// Edge Function: monei-webhook
//
// Public endpoint called by Monei when a payment status changes.
// MUST return 200 quickly — Monei retries on any non-2xx or timeout.
//
// On SUCCEEDED: adds player to match_participants and marks payment SUCCEEDED.
// On FAILED/CANCELED: marks payment and leaves no participant record.
//
// Deploy:
//   supabase functions deploy monei-webhook --no-verify-jwt
//
// Configure in Monei Dashboard → Settings → Webhooks → add this function URL.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyMoneiSignature } from '../_shared/monei.ts';
import { auditLog } from '../_shared/audit.ts';
import { confirmSlotOrRefund } from '../_shared/confirmSlot.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Terminal MONEI event statuses we act on (used against the incoming event).
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED']);

// Internal payment states that are already resolved: a late/duplicate webhook
// must NOT re-confirm or otherwise reopen them. Includes the async-return states
// so a late SUCCEEDED webhook can't re-create a participant for a payment the
// user already cancelled (race D).
const RESOLVED_PAYMENT_STATUSES = new Set([
  'SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED',
  'PENDING_RETURN', 'RETURNING', 'PENDING_REFUND_ADMIN',
]);

serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('method_not_allowed', { status: 405 });
  }

  const rawBody = await req.text();
  const signature = req.headers.get('MONEI-Signature') ?? '';

  // Verify webhook authenticity
  const valid = await verifyMoneiSignature(rawBody, signature);
  if (!valid) {
    await auditLog({
      action: 'WEBHOOK_FAILED',
      entity_type: 'payment',
      payload: { reason: 'invalid_signature', signature_header: signature },
      source: 'webhook',
    });
    return new Response('invalid_signature', { status: 401 });
  }

  let event: {
    id: string;
    orderId: string;
    status: string;
    amount: number;
    paymentMethod?: { method?: string };
    statusMessage?: string;
  };

  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('bad_json', { status: 400 });
  }

  await auditLog({
    action: 'WEBHOOK_RECEIVED',
    entity_type: 'payment',
    entity_id: event.orderId,
    payload: { monei_payment_id: event.id, status: event.status, amount: event.amount },
    source: 'webhook',
  });

  if (!TERMINAL_STATUSES.has(event.status)) {
    // Non-terminal status (e.g. AUTHORIZED) — acknowledge but don't act
    return new Response(JSON.stringify({ ok: true, skipped: true }), { status: 200 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Find payment by order_id (our internal ID sent to Monei as orderId)
  const { data: payment, error: pmtErr } = await admin
    .from('payments')
    .select('id, match_id, user_id, user_name, env, status, amount, is_guest')
    .eq('order_id', event.orderId)
    .maybeSingle();

  if (pmtErr || !payment) {
    console.error('Payment not found for orderId:', event.orderId);
    // Still return 200 so Monei doesn't keep retrying an unknown order
    return new Response(JSON.stringify({ ok: true, warning: 'payment_not_found' }), { status: 200 });
  }

  // Idempotency: skip if the payment is already resolved (terminal or in the
  // async-return pipeline) so we don't reopen it.
  if (RESOLVED_PAYMENT_STATUSES.has(payment.status)) {
    return new Response(JSON.stringify({ ok: true, skipped: 'already_resolved' }), { status: 200 });
  }

  const updateData: Record<string, unknown> = {
    monei_payment_id: event.id,
    status:           event.status,
    payment_method:   event.paymentMethod?.method,
    error_message:    event.statusMessage,
  };

  if (event.status === 'SUCCEEDED') {
    // Create the participant under the match lock — or QUEUE a return if the
    // match filled while the hold aged out, to avoid overbooking. The refund
    // worker (reconcile-payments) does the Monei call.
    const slot = await confirmSlotOrRefund(admin, payment);
    if (slot.participant_id) updateData.participant_id = slot.participant_id;
    if (slot.status) updateData.status = slot.status;  // 'PENDING_RETURN' when full

    await auditLog({
      env: payment.env, actor_id: payment.user_id,
      action: 'PAYMENT_SUCCEEDED',
      entity_type: 'payment', entity_id: payment.id,
      payload: { match_id: payment.match_id, amount: event.amount, monei_id: event.id },
      source: 'webhook',
    });
  } else {
    await auditLog({
      env: payment.env, actor_id: payment.user_id,
      action: `PAYMENT_${event.status}`,
      entity_type: 'payment', entity_id: payment.id,
      payload: { match_id: payment.match_id, status: event.status, monei_id: event.id },
      source: 'webhook',
    });
  }

  await admin.from('payments').update(updateData).eq('id', payment.id);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
