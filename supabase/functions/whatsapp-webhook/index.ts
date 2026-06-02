// Edge Function: whatsapp-webhook
//
// ISOLATED / not yet wired to actions. Mirrors monei-webhook:
//   GET  → Meta verification handshake (echo hub.challenge if verify token matches)
//   POST → verify X-Hub-Signature-256 HMAC → parse → LOG each inbound message to
//          whatsapp_messages (idempotent) → 200 fast (Meta retries otherwise).
//
// Command routing (VOY/NOVOY/LISTA <code>) + actions are added in later phases.
// Until then this only logs the conversation (supervision foundation).
//
// Deploy (only when ready to integrate):
//   supabase functions deploy whatsapp-webhook --no-verify-jwt
// Secrets: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET,
//          WHATSAPP_VERIFY_TOKEN

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyWhatsAppSignature } from '../_shared/whatsapp.ts';
import { timingSafeEqual } from '../_shared/timingSafeEqual.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '';

serve(async (req) => {
  const url = new URL(req.url);

  // ── GET: Meta verification handshake ──────────────────────────────────────
  if (req.method === 'GET') {
    const mode = url.searchParams.get('hub.mode');
    const token = url.searchParams.get('hub.verify_token') ?? '';
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    if (mode === 'subscribe' && VERIFY_TOKEN && timingSafeEqual(token, VERIFY_TOKEN)) {
      return new Response(challenge, { status: 200 });
    }
    return new Response('forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 });

  // ── POST: event callbacks (HMAC-protected) ────────────────────────────────
  const rawBody = await req.text();
  const signature = req.headers.get('X-Hub-Signature-256') ?? '';
  if (!(await verifyWhatsAppSignature(rawBody, signature))) {
    return new Response('invalid_signature', { status: 401 });
  }

  let event: any;
  try { event = JSON.parse(rawBody); } catch { return new Response('bad_json', { status: 400 }); }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Meta payload: entry[].changes[].value.messages[]
  const value = event?.entry?.[0]?.changes?.[0]?.value;
  const messages: any[] = value?.messages ?? [];

  for (const m of messages) {
    const from = m?.from;                       // E.164 (no '+')
    const waId = m?.id;
    const body = m?.text?.body ?? m?.button?.text ?? '';

    // Log every inbound message (idempotent on wa_message_id → safe on retries).
    await admin.from('whatsapp_messages')
      .upsert(
        { phone: from, direction: 'in', wa_message_id: waId, body, raw: m },
        { onConflict: 'wa_message_id', ignoreDuplicates: true },
      );

    // ── Command router — wired in a later phase ─────────────────────────────
    // const cmd = parseCommand(body);   // VOY / NOVOY / LISTA <code>
    // switch (cmd?.kind) { ... join_match_as / request_return / list ... }
  }

  // Always ack fast so Meta doesn't retry.
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
