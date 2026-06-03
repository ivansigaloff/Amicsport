-- Migration: whatsapp_reminders
-- Date: 2026-06-02
--
-- ADDITIVE / ISOLATED support for proactive "match in X hours" reminders.
--   match_reminders        — per (match,user) dedup: a transient send failure
--                            retries only the missing recipients (no lost nor
--                            duplicate reminders), and late joiners still get one.
--   reminder_recipients()  — participants of a match who have a phone, an active
--                            proactive_msgs consent, AND were not yet reminded.
-- Touches nothing existing; inert until whatsapp-reminders (not deployed) runs.

CREATE TABLE IF NOT EXISTS public.match_reminders (
  match_id uuid NOT NULL,
  user_id  uuid NOT NULL,
  sent_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_id, user_id)
);

ALTER TABLE public.match_reminders ENABLE ROW LEVEL SECURITY;
-- No policies: only the service role (whatsapp-reminders) touches this.

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
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.match_reminders mr
      WHERE mr.match_id = p_match_id AND mr.user_id = p.user_id
    );
$$;

REVOKE ALL ON FUNCTION public.reminder_recipients(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reminder_recipients(uuid) TO service_role;
