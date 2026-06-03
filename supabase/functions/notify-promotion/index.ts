// Edge Function: notify-promotion
//
// Sends the "you've been moved off the waiting list into the match" emails after
// the DB trigger (promote_waitlist_after_leave) promotes a waitlisted player.
//
// The trigger flags the promoted row with pending_promotion_notice = true. The
// client calls this function with the match_id right after a leave/removal; the
// function (service role) drains every pending row for that match, emails the
// match admin (matches.creator_email) and the promoted player (only if a
// registered user with an email — guests/agenda players have none), then clears
// the flag. Draining-by-flag makes it idempotent and safe to call more than once.
//
// Required Supabase secrets (shared with send-match-notification):
//   NOTIFICATION_URL     - the PHP endpoint
//   NOTIFICATION_SECRET  - shared secret for the X-Internal-Auth header
//
// Deploy: supabase functions deploy notify-promotion --use-api

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL        = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY    = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const NOTIFICATION_URL    = Deno.env.get('NOTIFICATION_URL') ?? '';
const NOTIFICATION_SECRET = Deno.env.get('NOTIFICATION_SECRET') ?? '';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST')    return json({ error: 'method_not_allowed' }, 405);

  if (!NOTIFICATION_URL) return json({ error: 'notification_url_not_configured' }, 503);

  // Auth — any authenticated user (the player who left triggers the promotion).
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'missing_auth' }, 401);
  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'invalid_jwt' }, 401);

  let body: { match_id?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const { match_id } = body;
  if (!match_id) return json({ error: 'missing_fields' }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // Drain the pending-promotion rows for this match (server-derived recipients —
  // nothing about who to email is trusted from the client).
  const { data: promoted, error: pErr } = await admin
    .from('match_participants')
    .select('id, user_id, user_name')
    .eq('match_id', match_id)
    .eq('pending_promotion_notice', true);
  if (pErr) return json({ error: 'query_failed' }, 500);
  if (!promoted || promoted.length === 0) return json({ ok: true, notified: 0 });

  const { data: match } = await admin
    .from('matches')
    .select('id, title, venue, date, time, max_players, creator_email')
    .eq('id', match_id)
    .single();
  if (!match) return json({ error: 'match_not_found' }, 404);

  const { count: activeCount } = await admin
    .from('match_participants')
    .select('*', { count: 'exact', head: true })
    .eq('match_id', match_id)
    .eq('waitlist', false);

  const matchLink = `https://multigraf.info/Kickerzbcn/match/${match_id}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (NOTIFICATION_SECRET) headers['X-Internal-Auth'] = NOTIFICATION_SECRET;

  const post = async (to: string, recipientRole: 'admin' | 'player', playerName: string) => {
    try {
      const res = await fetch(NOTIFICATION_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          to,
          type: 'promoted',
          recipientRole,
          playerName,
          matchTitle: match.title || match.venue,
          matchVenue: match.venue,
          matchDate:  match.date,
          matchTime:  match.time,
          playerCount: activeCount ?? 0,
          maxPlayers:  match.max_players,
          matchLink,
        }),
      });
      if (!res.ok) console.error('notify-promotion upstream failed:', res.status, (await res.text()).slice(0, 200));
    } catch (e) {
      console.error('notify-promotion upstream unreachable:', String(e));
    }
  };

  let notified = 0;
  for (const p of promoted) {
    // Admin notice.
    if (match.creator_email) await post(match.creator_email, 'admin', p.user_name);

    // Player notice — only for registered users with an email on their account.
    if (p.user_id) {
      const { data: pl } = await admin.auth.admin.getUserById(p.user_id);
      const playerEmail = pl?.user?.email;
      if (playerEmail) await post(playerEmail, 'player', p.user_name);
    }

    // Clear the flag regardless of email outcome (best-effort, idempotent).
    await admin.from('match_participants')
      .update({ pending_promotion_notice: false })
      .eq('id', p.id);
    notified++;
  }

  return json({ ok: true, notified });
});
