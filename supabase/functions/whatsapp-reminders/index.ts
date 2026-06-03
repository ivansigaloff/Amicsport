// Edge Function: whatsapp-reminders
//
// ISOLATED / not deployed. Scheduled (cron) proactive reminder sender: for each
// upcoming match entering the "X hours before" window, sends an approved
// template to participants who have a phone AND an active proactive_msgs consent
// (reminder_recipients), then marks the match reminded (dedup).
//
// Auth: x-reminder-secret header (fail-closed), like reconcile-payments.
//
// Deploy (only when ready): supabase functions deploy whatsapp-reminders --no-verify-jwt
// Secrets: WHATSAPP_REMINDER_SECRET, and the template config below.
// Schedule it (Supabase cron) to POST every ~15-30 min.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { sendWhatsAppTemplate } from '../_shared/whatsapp.ts';
import { timingSafeEqual } from '../_shared/timingSafeEqual.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const REMINDER_SECRET = Deno.env.get('WHATSAPP_REMINDER_SECRET') ?? '';
const REMINDER_HOURS = Number(Deno.env.get('WHATSAPP_REMINDER_HOURS') ?? '3');
const TEMPLATE_NAME = Deno.env.get('WHATSAPP_REMINDER_TEMPLATE') ?? 'match_reminder';
const TEMPLATE_LANG = Deno.env.get('WHATSAPP_REMINDER_LANG') ?? 'es';

// Hours until the match start in Madrid wall-clock (null if unresolved).
function hoursUntilMatch(matchDate: string, time: string): number | null {
  const [y, mo, d] = String(matchDate).split('-').map(Number);
  const [h, mi] = String(time).split(':').map(Number);
  if ([y, mo, d, h, mi].some((n) => Number.isNaN(n))) return null;
  const startWall = Date.UTC(y, mo - 1, d, h, mi);
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Madrid',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value);
  const nowWall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return (startWall - nowWall) / 3_600_000;
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('method_not_allowed', { status: 405 });

  const secret = req.headers.get('x-reminder-secret') ?? '';
  if (!REMINDER_SECRET || !timingSafeEqual(secret, REMINDER_SECRET)) {
    return new Response('unauthorized', { status: 401 });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const today = new Date().toISOString().split('T')[0];

  const { data: matches } = await admin.from('matches')
    .select('id, title, venue, time, match_date')
    .gte('match_date', today).limit(100);

  const results = { sent: 0, errors: 0 };

  for (const m of matches ?? []) {
    const hrs = hoursUntilMatch(m.match_date, m.time);
    if (hrs === null || hrs <= 0 || hrs > REMINDER_HOURS) continue;  // not in the window yet

    // reminder_recipients already excludes users that were reminded.
    const { data: recips } = await admin.rpc('reminder_recipients', { p_match_id: m.id });
    for (const r of (recips ?? []) as any[]) {
      try {
        await sendWhatsAppTemplate(r.phone, TEMPLATE_NAME, TEMPLATE_LANG, [
          r.user_name || 'Jugador', m.title || m.venue, m.time,
        ]);
        // Record per-recipient ONLY on success → a failed send retries next run.
        await admin.from('match_reminders').insert({ match_id: m.id, user_id: r.user_id });
        await admin.from('whatsapp_messages').insert({
          user_id: r.user_id, phone: r.phone, direction: 'out',
          body: `[plantilla ${TEMPLATE_NAME}] ${m.title || m.venue} ${m.time}`,
        });
        results.sent++;
      } catch (e) {
        console.error('reminder send failed:', e);
        results.errors++;
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, ...results }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
});
