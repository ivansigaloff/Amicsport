-- Migration: whatsapp_reminders
-- Date: 2026-06-02
--
-- ADDITIVE / ISOLATED support for proactive "match in X hours" reminders.
--   matches.reminder_sent_at  — dedup flag (set once a match has been reminded)
--   reminder_recipients()     — participants of a match who have a phone AND an
--                               active proactive_msgs consent (the only people
--                               we may message proactively).
-- Touches nothing existing; inert until whatsapp-reminders (not deployed) runs.

ALTER TABLE public.matches ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;

CREATE OR REPLACE FUNCTION public.reminder_recipients(p_match_id uuid)
RETURNS TABLE(user_id uuid, phone text, user_name text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT p.user_id, u.phone, p.user_name
  FROM public.match_participants p
  JOIN auth.users u ON u.id = p.user_id
  WHERE p.match_id = p_match_id
    AND u.phone IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.consents c
      WHERE c.user_id = p.user_id
        AND c.purpose = 'proactive_msgs'
        AND c.withdrawn_at IS NULL
    );
$$;

REVOKE ALL ON FUNCTION public.reminder_recipients(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reminder_recipients(uuid) TO service_role;
