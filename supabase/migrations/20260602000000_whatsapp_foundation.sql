-- Migration: whatsapp_foundation
-- Date: 2026-06-02
--
-- ADDITIVE / ISOLATED: foundation for the WhatsApp integration (developed in
-- parallel, not yet wired). Creates two NEW tables; touches nothing existing.
-- Safe to apply at any time — no existing flow reads or writes these.
--
--   whatsapp_messages — full conversation log (supervision panel + dedupe). A
--                       high-volume stream, kept separate from audit_log (which
--                       is for discrete business events). See WHATSAPP §10.9.
--   consents          — GDPR proof of opt-in (purpose + policy version + channel
--                       + evidence). See WHATSAPP §10.5.
--
-- Writes happen only from the service role (whatsapp-webhook / outbound sender),
-- which bypasses RLS. Reads are admin-only (supervision), plus own-consents.

-- ── whatsapp_messages ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES auth.users ON DELETE SET NULL,  -- null until linked
  phone         text NOT NULL,                                  -- E.164
  direction     text NOT NULL CHECK (direction IN ('in', 'out')),
  wa_message_id text,                                           -- Meta message id
  body          text,
  raw           jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS whatsapp_messages_phone_idx   ON public.whatsapp_messages (phone);
CREATE INDEX IF NOT EXISTS whatsapp_messages_created_idx ON public.whatsapp_messages (created_at DESC);
-- Dedupe inbound deliveries (Meta is at-least-once) — webhook upserts on this.
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_messages_wamid_idx
  ON public.whatsapp_messages (wa_message_id) WHERE wa_message_id IS NOT NULL;

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- Admins read (supervision panel); service role writes (bypasses RLS). No client
-- writes, no anon reads.
CREATE POLICY whatsapp_messages_admin_select ON public.whatsapp_messages
  FOR SELECT USING (public.auth_is_admin());

-- ── consents ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES auth.users ON DELETE CASCADE,
  phone          text,                          -- E.164
  purpose        text NOT NULL,                 -- 'service' | 'transactional_msgs' | 'marketing'
  policy_version text NOT NULL,                 -- which policy text was accepted
  channel        text NOT NULL,                 -- 'whatsapp' | 'web_form'
  evidence       text,                          -- literal "ACEPTO" / form hash
  granted_at     timestamptz NOT NULL DEFAULT now(),
  withdrawn_at   timestamptz                    -- null = active
);

CREATE INDEX IF NOT EXISTS consents_user_idx  ON public.consents (user_id);
CREATE INDEX IF NOT EXISTS consents_phone_idx ON public.consents (phone);

ALTER TABLE public.consents ENABLE ROW LEVEL SECURITY;

-- Admins read all; users read their own. Writes only via service role.
CREATE POLICY consents_admin_select ON public.consents
  FOR SELECT USING (public.auth_is_admin());
CREATE POLICY consents_own_select ON public.consents
  FOR SELECT USING (auth.uid() = user_id);
