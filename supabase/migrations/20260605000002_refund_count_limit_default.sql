-- Migration: sane default + accurate description for the daily refund limits
-- Date: 2026-06-05
--
-- R4 (analysis 2026-06-05): daily_refund_count_limit was seeded to 999
-- (effectively no cap) while its description said "Max 10", and the value was not
-- editable from the app. The admin screen added in this change set
-- (app/admin/ajustes.tsx → app_settings) now lets an admin edit both refund
-- limits live. Here we (a) make the descriptions accurate and (b) bring the
-- legacy 999 down to a sane anti-fraud default of 20 — but ONLY if it is still
-- the old 999, so we never clobber a value an admin has deliberately set.
--
-- The per-day AMOUNT cap (daily_refund_amount_limit_cents) remains the primary
-- guard; this count cap just decides when automatic refunds wait for admin
-- approval. Both are read by the reconcile-payments refund worker.

UPDATE public.app_settings
  SET value = '20'::jsonb,
      description = 'Máximo de reembolsos automáticos por día natural antes de requerir aprobación del admin (editable en Admin → Ajustes)'
  WHERE key = 'daily_refund_count_limit'
    AND value = '999'::jsonb;

-- Keep the amount-cap description accurate (idempotent; value unchanged).
UPDATE public.app_settings
  SET description = 'Importe máximo de reembolsos por día natural, en céntimos (100000 = 1000 €; editable en Admin → Ajustes)'
  WHERE key = 'daily_refund_amount_limit_cents';
