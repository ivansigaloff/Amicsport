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
import { verifyWhatsAppSignature, sendWhatsAppText } from '../_shared/whatsapp.ts';
import { parseCommand, type WhatsAppCommand } from '../_shared/whatsappCommands.ts';
import { timingSafeEqual } from '../_shared/timingSafeEqual.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '';

// Maps a parsed command to a reply. Reuses the isolated service-role RPCs
// (user_id_by_phone, join_match_as). Paid join / paid leave / registration are
// deferred to later phases and answered with a safe message for now.
async function handleCommand(admin: any, from: string, cmd: WhatsAppCommand): Promise<string | null> {
  if (cmd.kind === 'unknown' || cmd.kind === 'help') {
    return 'Comandos:\n• VOY <código> — apuntarte\n• NOVOY <código> — salir\n• LISTA — próximos partidos';
  }

  // LIST works without resolving the user.
  if (cmd.kind === 'list') {
    if (cmd.code) {
      const { data: match } = await admin.from('matches')
        .select('id, title, venue, time, max_players, joined_players')
        .eq('short_code', cmd.code).maybeSingle();
      if (!match) return `No encuentro el partido ${cmd.code}.`;
      const { count } = await admin.from('match_participants')
        .select('id', { count: 'exact', head: true }).eq('match_id', match.id);
      const total = (count ?? 0) + (match.joined_players ?? 0);
      return `${match.title || match.venue} — ${match.time}\nApuntados: ${total}/${match.max_players}`;
    }
    const today = new Date().toISOString().split('T')[0];
    const { data: list } = await admin.from('matches')
      .select('title, venue, time, short_code')
      .gte('match_date', today).order('match_date', { ascending: true }).order('time', { ascending: true }).limit(10);
    if (!list?.length) return 'No hay partidos próximos.';
    return 'Próximos partidos:\n' + list.map((m: any) => `• ${m.title || m.venue} ${m.time} → VOY ${m.short_code}`).join('\n');
  }

  // JOIN / LEAVE need the user.
  const { data: userId, error: uErr } = await admin.rpc('user_id_by_phone', { p_phone: from });
  if (uErr) { console.error('user_id_by_phone failed:', uErr); return null; }
  if (!userId) {
    // Registration (invite-code onboarding) is a later phase.
    return 'No te tengo registrado todavía. Pídele el alta al organizador para apuntarte.';
  }
  if (!cmd.code) {
    return 'Dime a qué partido: usa el enlace del grupo (p. ej. VOY A7F3).';
  }

  const { data: match } = await admin.from('matches')
    .select('id, title, venue').eq('short_code', cmd.code).maybeSingle();
  if (!match) return `No encuentro el partido ${cmd.code}.`;
  const label = match.title || match.venue;

  if (cmd.kind === 'join') {
    const { data: u } = await admin.auth.admin.getUserById(userId);
    const name = u?.user?.user_metadata?.full_name ?? 'Jugador';
    const { error } = await admin.rpc('join_match_as', {
      p_user_id: userId, p_match_id: match.id, p_user_name: name, p_is_guest: false,
    });
    if (!error) return `✅ Apuntado a ${label}.`;
    const e = String(error.message || error);
    if (e.includes('already_joined'))  return `Ya estabas apuntado a ${label}.`;
    if (e.includes('match_full'))       return `${label} está completo.`;
    if (e.includes('payment_required')) return `${label} requiere pago — apúntate desde la app por ahora.`;
    if (e.includes('not_validated'))    return 'Tu cuenta necesita un código de invitación válido.';
    console.error('join_match_as failed:', error);
    return 'No pude apuntarte, inténtalo más tarde.';
  }

  // LEAVE — paid participations must cancel via the app (refund + deadline). Deferred.
  const { data: paid } = await admin.from('payments')
    .select('id').eq('match_id', match.id).eq('user_id', userId).eq('env', 'prod').eq('status', 'SUCCEEDED').maybeSingle();
  if (paid) return `Para cancelar ${label} (partido de pago) usa la app.`;
  const { error: delErr } = await admin.from('match_participants')
    .delete().eq('match_id', match.id).eq('user_id', userId);
  if (delErr) { console.error('leave delete failed:', delErr); return 'No pude darte de baja.'; }
  return `Te he sacado de ${label}.`;
}

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

    if (!from) continue;

    // Log every inbound message (idempotent on wa_message_id → safe on retries).
    // Returns the row only if it was newly inserted, so we don't re-act on a
    // duplicate delivery.
    const { data: inserted } = await admin.from('whatsapp_messages')
      .upsert(
        { phone: from, direction: 'in', wa_message_id: waId, body, raw: m },
        { onConflict: 'wa_message_id', ignoreDuplicates: true },
      )
      .select('id');
    if (waId && !(inserted && inserted.length)) continue;  // duplicate delivery → skip

    // ── Command router ──────────────────────────────────────────────────────
    try {
      const reply = await handleCommand(admin, from, parseCommand(body));
      if (reply) {
        await sendWhatsAppText(from, reply);
        await admin.from('whatsapp_messages').insert({ phone: from, direction: 'out', body: reply });
      }
    } catch (e) {
      console.error('whatsapp command handling failed:', e);  // still ack 200
    }
  }

  // Always ack fast so Meta doesn't retry.
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
