-- Migration: invite_rate_limit
-- Date: 2026-06-03
--
-- Closes V1: invite-code validation had no rate limit, so the invite-only gate
-- was brute-forceable (web validate-invite and WhatsApp ALTA). Guessing the
-- admin code = admin access. This adds a per-key failed-attempt log that both
-- edge functions check before validating and append to on failure.
--
-- key = client IP (web) or phone (WhatsApp). service-role only (RLS, no policy).
-- NOTE: rate limiting is defense-in-depth; the real fix is HIGH-ENTROPY invite
-- codes (the INVITE_* secrets) — short human codes stay risky even rate-limited.

CREATE TABLE IF NOT EXISTS public.invite_attempts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key          text NOT NULL,
  success      boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS invite_attempts_key_idx
  ON public.invite_attempts (key, attempted_at);

ALTER TABLE public.invite_attempts ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: only the service role (edge functions) touches this.
