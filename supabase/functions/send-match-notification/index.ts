// Edge Function: send-match-notification
//
// Auth-gated proxy for the match-update email endpoint. Replaces a direct
// client-to-PHP call that was anonymous and spammable from anywhere.
//
// Flow:
//   1. Verify Supabase JWT (default behaviour, no --no-verify-jwt on deploy)
//   2. Validate the caller is either an admin OR is sending a notification
//      about themselves (player_name starts with their display name, which
//      also covers the "Caller (invitado N)" guest naming convention)
//   3. Load the match server-side so creator_email cannot be spoofed
//   4. Forward to NOTIFICATION_URL with an X-Internal-Auth header so the
//      PHP endpoint can reject anonymous direct calls (PHP must check that
//      header — without that update the EF only adds caller validation)
//
// Required Supabase secrets:
//   NOTIFICATION_URL     - the PHP endpoint
//   NOTIFICATION_SECRET  - shared with PHP for the X-Internal-Auth header
//
// Deploy:
//   supabase functions deploy send-match-notification

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

  // Auth
  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'missing_auth' }, 401);

  const userClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await userClient.auth.getUser();
  if (authErr || !user) return json({ error: 'invalid_jwt' }, 401);

  // Body
  let body: { match_id?: string; type?: string; player_name?: string };
  try { body = await req.json(); } catch { return json({ error: 'bad_json' }, 400); }
  const { match_id, type, player_name } = body;
  if (!match_id || !type || !player_name) return json({ error: 'missing_fields' }, 400);
  if (type !== 'join' && type !== 'leave') return json({ error: 'invalid_type' }, 400);

  // Caller-vs-player validation: prevent users from sending notifications
  // about other people. Admins can send anything.
  const callerName = (user.user_metadata?.full_name ?? user.user_metadata?.name ?? user.email ?? '').toString();
  const role = user.app_metadata?.role;
  const isAdmin = role === 'admin';
  const sameName = callerName && player_name === callerName;
  const isOwnGuest = callerName && player_name.startsWith(`${callerName} (invitado`);
  if (!isAdmin && !sameName && !isOwnGuest) {
    return json({ error: 'not_authorized_for_player' }, 403);
  }

  // Server-side match lookup (do NOT trust client-sent match fields)
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: match, error: matchErr } = await admin
    .from('matches')
    .select('id, title, venue, date, time, max_players, creator_email')
    .eq('id', match_id)
    .single();
  if (matchErr || !match)   return json({ error: 'match_not_found' }, 404);
  if (!match.creator_email) return json({ ok: true, skipped: 'no_creator_email' });

  // Real participant count
  const { count: playerCount } = await admin
    .from('match_participants')
    .select('*', { count: 'exact', head: true })
    .eq('match_id', match_id);

  // Forward to PHP with internal auth header
  const matchLink = `https://multigraf.info/Kickerzbcn/match/${match_id}`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (NOTIFICATION_SECRET) headers['X-Internal-Auth'] = NOTIFICATION_SECRET;

  try {
    const res = await fetch(NOTIFICATION_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        to:           match.creator_email,
        type,
        playerName:   player_name,
        matchTitle:   match.title || match.venue,
        matchVenue:   match.venue,
        matchDate:    match.date,
        matchTime:    match.time,
        playerCount:  playerCount ?? 0,
        maxPlayers:   match.max_players,
        matchLink,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      return json({ error: 'upstream_failed', status: res.status, detail: text.slice(0, 200) }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: 'upstream_unreachable', detail: String(e) }, 502);
  }
});
