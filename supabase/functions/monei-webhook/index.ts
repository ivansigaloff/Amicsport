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

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Terminal statuses that map directly from Monei
const TERMINAL_STATUSES = new Set(['SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'REFUNDED', 'PARTIALLY_REFUNDED']);

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
    .select('id, match_id, user_id, user_name, env, status, amount')
    .eq('order_id', event.orderId)
    .maybeSingle();

  if (pmtErr || !payment) {
    console.error('Payment not found for orderId:', event.orderId);
    // Still return 200 so Monei doesn't keep retrying an unknown order
    return new Response(JSON.stringify({ ok: true, warning: 'payment_not_found' }), { status: 200 });
  }

  // Idempotency: skip if already in a terminal state
  if (TERMINAL_STATUSES.has(payment.status)) {
    return new Response(JSON.stringify({ ok: true, skipped: 'already_terminal' }), { status: 200 });
  }

  const updateData: Record<string, unknown> = {
    monei_payment_id: event.id,
    status:           event.status,
    payment_method:   event.paymentMethod?.method,
    error_message:    event.statusMessage,
  };

  if (event.status === 'SUCCEEDED') {
    const participantsTable = payment.env === 'dev' ? 'match_participants_dev' : 'match_participants';

    // Add to match_participants
    const { data: participant, error: partErr } = await admin
      .from(participantsTable)
      .insert({ match_id: payment.match_id, user_id: payment.user_id, user_name: payment.user_name })
      .select('id')
      .single();

    if (partErr) {
      console.error('Failed to create participant:', partErr);
      // Don't fail the webhook — we still update payment status and reconcile can retry
    } else if (participant) {
      updateData.participant_id = participant.id;
    }

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
