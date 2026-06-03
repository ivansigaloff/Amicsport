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
import { moneiRequest } from '../_shared/monei.ts';
import { isPastCancellationDeadline } from '../_shared/cancellationDeadline.ts';
import { isInviteBlocked, recordInviteFailure } from '../_shared/inviteRateLimit.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const VERIFY_TOKEN = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '';
const APP_BASE_URL = Deno.env.get('APP_BASE_URL') || 'https://multigraf.info/Kickerzbcn';

// Invite codes (same secrets validate-invite uses). Duplicated here for the
// service-role onboarding path; unify with validate-invite at integration.
const INVITE_CODES = {
  admin_prod:  Deno.env.get('INVITE_ADMIN_PROD')  || '',
  player_prod: Deno.env.get('INVITE_PLAYER_PROD') || '',
  admin_dev:   Deno.env.get('INVITE_ADMIN_DEV')   || '',
  player_dev:  Deno.env.get('INVITE_PLAYER_DEV')  || '',
};
function resolveInviteRole(code: string): { role: 'admin' | 'participant'; is_dev: boolean } | null {
  const c = (code || '').trim().toUpperCase();
  if (!c) return null;
  if (INVITE_CODES.admin_prod  && c === INVITE_CODES.admin_prod.toUpperCase())  return { role: 'admin',       is_dev: false };
  if (INVITE_CODES.player_prod && c === INVITE_CODES.player_prod.toUpperCase()) return { role: 'participant', is_dev: false };
  if (INVITE_CODES.admin_dev   && c === INVITE_CODES.admin_dev.toUpperCase())   return { role: 'admin',       is_dev: true  };
  if (INVITE_CODES.player_dev  && c === INVITE_CODES.player_dev.toUpperCase())  return { role: 'participant', is_dev: true  };
  return null;
}

// Onboarding: create an invite-validated account from phone + WhatsApp profile
// name (no conversational state). Keeps invite-only — a valid invite code is
// required and sets app_metadata.role.
async function handleRegister(admin: any, from: string, profileName: string, code: string | null): Promise<string> {
  const { data: existing } = await admin.rpc('user_id_by_phone', { p_phone: from });
  if (existing) return 'Ya tienes cuenta. Apúntate con VOY <código del partido>.';
  if (!code) return 'Para darte de alta envía: ALTA <tu código de invitación>.';

  // Rate-limit invite-code attempts (V1) keyed by phone.
  if (await isInviteBlocked(admin, from)) {
    return 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
  }
  const resolved = resolveInviteRole(code);
  if (!resolved) {
    await recordInviteFailure(admin, from);
    return 'Ese código de invitación no es válido.';
  }

  const name = (profileName || 'Jugador').slice(0, 80);
  const { data: created, error } = await admin.auth.admin.createUser({
    phone: from,                 // E.164 as Meta sends it (digits, no '+')
    phone_confirm: true,         // verified: it came over WhatsApp
    user_metadata: { full_name: name },
    app_metadata: { role: resolved.role, is_dev: resolved.is_dev },
  });
  if (error || !created?.user) {
    console.error('createUser failed:', error);
    return 'No pude crear la cuenta. ¿Quizás ya estás registrado?';
  }

  // GDPR: record the service-registration consent (proof).
  await admin.from('consents').insert({
    user_id: created.user.id, phone: from, purpose: 'service',
    policy_version: 'v1', channel: 'whatsapp', evidence: `ALTA ${code}`,
  });

  return `✅ ¡Bienvenido, ${name}! Ya puedes apuntarte: VOY <código del partido>.`;
}

// Generates a Monei checkout link for a paid join. Mirrors create-payment
// (reserve_paid_slot hold → Monei session → attach id); the EXISTING
// monei-webhook confirms the slot on payment, so reconciliation/refunds are
// reused unchanged. Throws 'already_paid' | 'match_full' | 'monei_error'.
async function createPaymentLink(admin: any, userId: string, name: string, email: string, match: any): Promise<string> {
  // reserve_paid_slot only excludes OTHER users' holds — dedupe the caller's own
  // payment here (create-payment does this upstream).
  const { data: existing } = await admin.from('payments')
    .select('id, status, monei_payment_id')
    .eq('match_id', match.id).eq('user_id', userId).eq('env', 'prod').eq('is_guest', false)
    .in('status', ['PENDING', 'SUCCEEDED']).maybeSingle();
  if (existing?.status === 'SUCCEEDED') throw new Error('already_paid');
  if (existing?.status === 'PENDING' && existing.monei_payment_id) {
    try {
      const p = await moneiRequest(`/payments/${existing.monei_payment_id}`);
      if (p?.nextAction?.redirectUrl) return p.nextAction.redirectUrl;  // resume the pending checkout
    } catch { /* fall through to create a new one */ }
  }

  const orderId = crypto.randomUUID();
  const amountCents = Math.round(match.price * 100);
  const { data: hold, error: reserveErr } = await admin.rpc('reserve_paid_slot', {
    p_match_id: match.id, p_env: 'prod', p_user_id: userId, p_user_name: name,
    p_user_email: email, p_is_guest: false, p_order_id: orderId, p_amount: amountCents,
  });
  if (reserveErr || !hold) {
    if (String(reserveErr?.message || '').includes('match_full')) throw new Error('match_full');
    throw new Error('db_error');
  }

  const completeUrl = `${APP_BASE_URL}/payment/return?order_id=${orderId}&status=SUCCEEDED`;
  const cancelUrl   = `${APP_BASE_URL}/payment/return?order_id=${orderId}&status=CANCELED`;
  const callbackUrl = `${SUPABASE_URL}/functions/v1/monei-webhook`;
  const expireAt = Math.floor(Date.now() / 1000) + 5 * 60;

  let moneiPayment: { id: string; nextAction?: { redirectUrl?: string } };
  try {
    moneiPayment = await moneiRequest('/payments', 'POST', {
      orderId, amount: amountCents, currency: 'EUR',
      description: `AmicSport - ${match.title || match.venue}`,
      customer: { email, name }, completeUrl, cancelUrl, callbackUrl, expireAt,
    });
  } catch (e) {
    await admin.from('payments').delete().eq('id', hold.id);  // release the hold
    throw new Error('monei_error');
  }

  await admin.from('payments').update({ monei_payment_id: moneiPayment.id }).eq('id', hold.id);
  return moneiPayment.nextAction?.redirectUrl ?? '';
}

// Maps a parsed command to a reply. Reuses the isolated service-role RPCs
// (user_id_by_phone, join_match_as) + Monei for paid joins. Paid leave
// (refund+deadline) is deferred to a later phase.
async function handleCommand(admin: any, from: string, profileName: string, cmd: WhatsAppCommand): Promise<string | null> {
  if (cmd.kind === 'register') return handleRegister(admin, from, profileName, cmd.code);

  // Proactive-message consent (opt-in / opt-out).
  if (cmd.kind === 'optin' || cmd.kind === 'optout') {
    const { data: userId } = await admin.rpc('user_id_by_phone', { p_phone: from });
    if (!userId) return 'No te tengo registrado. Envía ALTA <código de invitación> primero.';
    if (cmd.kind === 'optin') {
      const { data: active } = await admin.from('consents').select('id')
        .eq('user_id', userId).eq('purpose', 'proactive_msgs').is('withdrawn_at', null).maybeSingle();
      if (active) return 'Ya estás suscrito a los avisos. Escribe BAJA para darte de baja.';
      await admin.from('consents').insert({
        user_id: userId, phone: from, purpose: 'proactive_msgs',
        policy_version: 'v1', channel: 'whatsapp', evidence: 'ACEPTO',
      });
      return '✅ Recibirás avisos de tus partidos. Escribe BAJA para dejar de recibirlos.';
    }
    await admin.from('consents').update({ withdrawn_at: new Date().toISOString() })
      .eq('user_id', userId).eq('purpose', 'proactive_msgs').is('withdrawn_at', null);
    return 'Dejarás de recibir avisos. (Para salir de un partido usa NOVOY <código>.)';
  }

  if (cmd.kind === 'unknown' || cmd.kind === 'help') {
    return 'Comandos:\n• ALTA <código invitación> — darte de alta\n• VOY <código> — apuntarte\n• NOVOY <código> — salir\n• LISTA — próximos partidos\n• ACEPTO / BAJA — activar / desactivar avisos';
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
    .select('id, title, venue, requires_payment, price').eq('short_code', cmd.code).maybeSingle();
  if (!match) return `No encuentro el partido ${cmd.code}.`;
  const label = match.title || match.venue;

  if (cmd.kind === 'join') {
    const { data: u } = await admin.auth.admin.getUserById(userId);
    const name = u?.user?.user_metadata?.full_name ?? 'Jugador';
    const email = u?.user?.email ?? '';

    // Paid match → send a Monei checkout link instead of joining for free.
    if (match.requires_payment) {
      try {
        const link = await createPaymentLink(admin, userId, name, email, match);
        return `${label} requiere pago (${Number(match.price).toFixed(2)}€).\nReserva tu plaza aquí:\n${link}`;
      } catch (err) {
        const m = String((err as any)?.message || err);
        if (m.includes('already_paid')) return `Ya tienes plaza pagada en ${label}.`;
        if (m.includes('match_full'))   return `${label} está completo.`;
        console.error('createPaymentLink failed:', err);
        return 'No pude generar el pago, inténtalo más tarde.';
      }
    }

    const { error } = await admin.rpc('join_match_as', {
      p_user_id: userId, p_match_id: match.id, p_user_name: name, p_is_guest: false,
    });
    if (!error) return `✅ Apuntado a ${label}.`;
    const e = String(error.message || error);
    if (e.includes('already_joined'))  return `Ya estabas apuntado a ${label}.`;
    if (e.includes('match_full'))       return `${label} está completo.`;
    if (e.includes('not_validated'))    return 'Tu cuenta necesita un código de invitación válido.';
    console.error('join_match_as failed:', error);
    return 'No pude apuntarte, inténtalo más tarde.';
  }

  // LEAVE — paid participations go through the async refund queue (request_return)
  // with the same cancellation-deadline gate as the web (refund-payment).
  const { data: paid } = await admin.from('payments')
    .select('id').eq('match_id', match.id).eq('user_id', userId).eq('env', 'prod').eq('status', 'SUCCEEDED').maybeSingle();
  if (paid) {
    const { data: mfull } = await admin.from('matches')
      .select('match_date, time, cancellation_hours').eq('id', match.id).maybeSingle();
    if (mfull?.match_date && mfull.time &&
        isPastCancellationDeadline(mfull.match_date, mfull.time, mfull.cancellation_hours)) {
      return `Ya ha pasado el plazo de cancelación de ${label}.`;
    }
    const { data: result, error } = await admin.rpc('request_return', {
      p_payment_id: paid.id, p_user_id: userId, p_is_admin: false,
    });
    if (error) { console.error('request_return failed:', error); return 'No pude procesar la baja.'; }
    switch (result?.outcome) {
      case 'queued':            return `Te he dado de baja de ${label}. El reembolso se procesará en breve.`;
      case 'already_requested': return `Tu baja de ${label} ya está en proceso.`;
      case 'already_refunded':  return `Ya estabas reembolsado de ${label}.`;
      default:                  return `Te he dado de baja de ${label}.`;
    }
  }

  // Free participation → just remove the row.
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
  // Meta includes the sender's WhatsApp profile name → use it for onboarding.
  const profileName: string = value?.contacts?.[0]?.profile?.name ?? '';

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
      const reply = await handleCommand(admin, from, profileName, parseCommand(body));
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
