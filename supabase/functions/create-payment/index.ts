// Edge Function: create-payment
//
// Creates a Monei payment session for a match that requires payment.
// Called by the app when the user clicks "Reservar Plaza" on a paid match.
//
// Flow:
//   1. Validate auth + params
//   2. Check match requires_payment = true and price > 0
//   3. Check user has no existing SUCCEEDED payment for this match
//   4. Call Monei POST /payments → get redirectUrl
//   5. Save PENDING payment record in DB
//   6. Return redirectUrl to client
//
// Secrets needed (supabase secrets set ...):
//   MONEI_API_KEY
//
// Deploy:
//   supabase functions deploy create-payment

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { moneiRequest } from '../_shared/monei.ts';
import { auditLog } from '../_shared/audit.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const APP_BASE_URL = Deno.env.get('APP_BASE_URL') || 'https://multigraf.info/Kickerzbcn';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  // Auth
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'missing_auth' }, 401);

  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'invalid_jwt' }, 401);
  // Invite-only: only validated accounts (app_metadata.role set by
  // validate-invite) may pay-join. Blocks fake-invite-code orphan accounts.
  if (!user.app_metadata?.role) return json({ error: 'not_validated' }, 403);

  // Body
  let body: { match_id?: string; env?: string; return_base_url?: string; guest_name?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const { match_id, env = 'prod', return_base_url, guest_name } = body;
  const isGuest = typeof guest_name === 'string' && guest_name.trim().length > 0;
  const baseUrl = return_base_url || APP_BASE_URL;
  if (!match_id) return json({ error: 'match_id required' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const matchTable = env === 'dev' ? 'matches_dev' : 'matches';

  // Load match
  const { data: match, error: matchErr } = await admin
    .from(matchTable).select('id, title, venue, price, requires_payment, max_players, joined_players')
    .eq('id', match_id).single();

  if (matchErr || !match) return json({ error: 'match_not_found' }, 404);
  if (!match.requires_payment) return json({ error: 'match_does_not_require_payment' }, 400);
  if (!match.price || match.price <= 0) return json({ error: 'invalid_price' }, 400);

  // Check not already paid — skip for guest payments (multiple guest slots are fine)
  const { data: existing } = isGuest ? { data: null } : await admin
    .from('payments')
    .select('id, status')
    .eq('match_id', match_id)
    .eq('user_id', user.id)
    .eq('env', env)
    .eq('is_guest', false)
    .in('status', ['PENDING', 'SUCCEEDED'])
    .maybeSingle();

  if (existing?.status === 'SUCCEEDED') {
    // Verify with Monei — DB might be stale if refund wasn't synced
    const { data: pmtRow } = await admin.from('payments').select('monei_payment_id').eq('id', existing.id).single();
    if (pmtRow?.monei_payment_id) {
      try {
        const moneiPmt = await moneiRequest(`/payments/${pmtRow.monei_payment_id}`);
        const REFUNDED_STATES = ['REFUNDED', 'PARTIALLY_REFUNDED', 'CANCELED', 'FAILED', 'EXPIRED'];
        if (REFUNDED_STATES.includes(moneiPmt.status)) {
          // Sync DB and allow re-payment
          await admin.from('payments').update({ status: moneiPmt.status }).eq('id', existing.id);
        } else {
          return json({ error: 'already_paid' }, 409);
        }
      } catch {
        return json({ error: 'already_paid' }, 409);
      }
    } else {
      return json({ error: 'already_paid' }, 409);
    }
  }

  if (existing?.status === 'PENDING') {
    // Return the existing pending payment so the user can retry
    const { data: pmt } = await admin.from('payments').select('order_id, monei_payment_id').eq('id', existing.id).single();
    if (pmt?.monei_payment_id) {
      try {
        const moneiPmt = await moneiRequest(`/payments/${pmt.monei_payment_id}`);
        if (moneiPmt.nextAction?.redirectUrl) {
          return json({ redirectUrl: moneiPmt.nextAction.redirectUrl, order_id: pmt.order_id });
        }
        // Monei payment is in terminal state — update DB and create new payment
        const TERMINAL = ['SUCCEEDED', 'FAILED', 'CANCELED', 'EXPIRED', 'REFUNDED'];
        if (TERMINAL.includes(moneiPmt.status)) {
          await admin.from('payments').update({ status: moneiPmt.status }).eq('id', existing.id);
        }
      } catch { /* fall through to create new */ }
    }
  }

  const amountCents = Math.round(match.price * 100);
  const orderId = crypto.randomUUID();
  const userEmail = user.email ?? '';
  const hostName = user.user_metadata?.full_name ?? user.user_metadata?.name ?? userEmail.split('@')[0];
  // For guest payments the displayed name is the guest's; billing details remain the host's.
  const userName = isGuest ? guest_name!.trim() : hostName;

  // Atomically reserve the spot BEFORE charging. reserve_paid_slot locks the
  // match row (SELECT ... FOR UPDATE), recounts capacity (participants + manual
  // external counter + OTHER users' PENDING holds) and inserts THIS payment as
  // the PENDING hold — all in one transaction. This serializes concurrent paid
  // reservations, closing the check→hold TOCTOU that could overbook the last
  // spot, and guarantees we never charge for a spot we cannot grant.
  // monei_payment_id is attached after the Monei call below.
  const { data: hold, error: reserveErr } = await admin.rpc('reserve_paid_slot', {
    p_match_id:   match_id,
    p_env:        env,
    p_user_id:    user.id,
    p_user_name:  userName,
    p_user_email: userEmail,
    p_is_guest:   isGuest,
    p_order_id:   orderId,
    p_amount:     amountCents,
  });
  if (reserveErr || !hold) {
    if (String(reserveErr?.message || '').includes('match_full')) return json({ error: 'match_full' }, 409);
    console.error('reserve_paid_slot failed:', reserveErr);
    return json({ error: 'db_error', detail: reserveErr?.message }, 500);
  }

  const completeUrl = `${baseUrl}/payment/return?order_id=${orderId}&status=SUCCEEDED`;
  const cancelUrl   = `${baseUrl}/payment/return?order_id=${orderId}&status=CANCELED`;
  const callbackUrl = `${SUPABASE_URL}/functions/v1/monei-webhook`;
  // Expire the Monei session after 5 min so an ABANDONED payment frees its
  // reserved slot fast: Monei fires an EXPIRED webhook → monei-webhook marks the
  // payment EXPIRED → reserve_paid_slot stops counting the hold. 5 min covers a
  // genuine card-3DS / Bizum-RTP confirmation; past it Monei won't let the
  // payment succeed, so the slot can be freed/re-sold safely. (reserve_paid_slot's
  // 6-min freshness window is the backup if this webhook is ever missed.)
  const expireAt = Math.floor(Date.now() / 1000) + 5 * 60;

  let moneiPayment: { id: string; nextAction?: { redirectUrl?: string } };
  try {
    moneiPayment = await moneiRequest('/payments', 'POST', {
      orderId:     orderId,
      amount:      amountCents,
      currency:    'EUR',
      description: `AmicSport - ${match.title || match.venue}${isGuest ? ` (${userName})` : ''}`,
      customer:    { email: userEmail, name: hostName },
      completeUrl,
      cancelUrl,
      callbackUrl,
      expireAt,
    });
  } catch (e) {
    // Monei failed → release the hold so it does not keep occupying a spot.
    await admin.from('payments').delete().eq('id', hold.id);
    await auditLog({
      env, actor_id: user.id, actor_email: userEmail,
      action: 'PAYMENT_CREATE_FAILED',
      entity_type: 'payment', entity_id: match_id,
      payload: { error: String(e), match_id },
      source: 'app',
    });
    return json({ error: 'monei_error', detail: String(e) }, 502);
  }

  // Attach the Monei id to the hold we already reserved above.
  const { error: updErr } = await admin.from('payments')
    .update({ monei_payment_id: moneiPayment.id })
    .eq('id', hold.id);
  if (updErr) {
    console.error('Failed to attach monei id:', updErr);
    return json({ error: 'db_error' }, 500);
  }

  await auditLog({
    env, actor_id: user.id, actor_email: userEmail,
    action: 'PAYMENT_CREATED',
    entity_type: 'payment', entity_id: orderId,
    payload: { match_id, amount: amountCents, monei_payment_id: moneiPayment.id, is_guest: isGuest, guest_name: isGuest ? userName : undefined },
    source: 'app',
  });

  return json({
    redirectUrl: moneiPayment.nextAction?.redirectUrl,
    order_id: orderId,
  });
});
