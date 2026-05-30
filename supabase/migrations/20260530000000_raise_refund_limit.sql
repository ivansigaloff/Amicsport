-- Raise the daily auto-refund ("max cancelaciones") limit to 999.
--
-- The original seed (20260526000000_payments_and_audit.sql) set
-- daily_refund_count_limit = 10: after 10 automatic refunds in a calendar day,
-- further cancellations of PAID spots go to PENDING_REFUND_ADMIN and the spot is
-- held until an admin approves. That blocks bulk E2E paid-cancel testing.
--
-- This UPDATE bumps the LIVE value (the seed above only applies to a fresh DB via
-- ON CONFLICT DO NOTHING, so the already-seeded row must be updated explicitly).
--
-- APPLY: run in the Supabase SQL editor (or via service role) — app_settings is
-- admin-write only (RLS), so it cannot be changed with the anon key.

UPDATE public.app_settings
SET value = '999'::jsonb
WHERE key = 'daily_refund_count_limit';
