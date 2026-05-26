-- Migration: payments_and_audit
-- Date: 2026-05-26
--
-- Adds:
--   1. requires_payment / payment_deadline_hours columns to matches (+ _dev)
--   2. payments table (single table with env column, no FK to avoid prod/dev split issues)
--   3. audit_log table (unified)
--   4. app_settings table (configurable values like daily refund limits)
--   5. RLS policies + updated_at trigger

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Add payment columns to matches
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.matches
  ADD COLUMN IF NOT EXISTS requires_payment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_deadline_hours integer;

ALTER TABLE public.matches_dev
  ADD COLUMN IF NOT EXISTS requires_payment boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_deadline_hours integer;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. payments table
--    Single table with `env` column ('prod'|'dev') to avoid the prod/dev table
--    split complexity. FKs intentionally omitted to support both envs.
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payments (
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  env                text NOT NULL DEFAULT 'prod' CHECK (env IN ('prod', 'dev')),
  match_id           uuid NOT NULL,
  participant_id     uuid,              -- set after SUCCEEDED (match_participants row)
  user_id            uuid NOT NULL,
  user_name          text NOT NULL,
  user_email         text,
  monei_payment_id   text UNIQUE,
  order_id           text UNIQUE NOT NULL,
  amount             integer NOT NULL CHECK (amount > 0),  -- cents (e.g. 800 = €8.00)
  currency           text NOT NULL DEFAULT 'EUR',
  status             text NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN (
                         'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED',
                         'REFUNDED', 'PARTIALLY_REFUNDED', 'EXPIRED',
                         'PENDING_REFUND_ADMIN'  -- auto-refund blocked by daily limit
                       )),
  payment_method     text,
  refunded_amount    integer NOT NULL DEFAULT 0,
  refunded_at        timestamptz,
  error_message      text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payments_match_id_idx   ON public.payments (match_id);
CREATE INDEX IF NOT EXISTS payments_user_id_idx    ON public.payments (user_id);
CREATE INDEX IF NOT EXISTS payments_status_idx     ON public.payments (status);
CREATE INDEX IF NOT EXISTS payments_created_at_idx ON public.payments (created_at);

-- ────────────────────────────────────────────────────────────────────────────
-- 3. audit_log table
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.audit_log (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at   timestamptz NOT NULL DEFAULT now(),
  env          text NOT NULL DEFAULT 'prod',
  actor_id     uuid,        -- null for system/webhook actions
  actor_email  text,        -- denormalized: survives user deletion
  action       text NOT NULL,
  -- e.g. PAYMENT_CREATED | PAYMENT_SUCCEEDED | PAYMENT_FAILED | PAYMENT_CANCELED
  --      REFUND_ISSUED | REFUND_QUEUED_ADMIN | RECONCILE_RUN
  --      WEBHOOK_RECEIVED | WEBHOOK_FAILED | PARTICIPANT_JOINED | PARTICIPANT_REMOVED
  entity_type  text,        -- 'payment' | 'match' | 'participant'
  entity_id    text,        -- uuid as text (flexible for different entity types)
  payload      jsonb,       -- before/after snapshot or event details
  source       text NOT NULL DEFAULT 'app'
               -- 'app' | 'webhook' | 'reconcile' | 'admin' | 'system'
);

CREATE INDEX IF NOT EXISTS audit_log_action_idx     ON public.audit_log (action);
CREATE INDEX IF NOT EXISTS audit_log_created_at_idx ON public.audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_actor_id_idx   ON public.audit_log (actor_id);
CREATE INDEX IF NOT EXISTS audit_log_entity_idx     ON public.audit_log (entity_type, entity_id);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. app_settings table
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_settings (key, value, description) VALUES
  ('daily_refund_count_limit',
   '10'::jsonb,
   'Max number of automatic refunds per calendar day before requiring admin approval'),
  ('daily_refund_amount_limit_cents',
   '100000'::jsonb,
   'Max total refund amount per calendar day in cents (100000 = €1000)')
ON CONFLICT (key) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. updated_at trigger (reuse or create function)
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_updated_at ON public.payments;
CREATE TRIGGER payments_updated_at
  BEFORE UPDATE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS app_settings_updated_at ON public.app_settings;
CREATE TRIGGER app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- 6. RLS
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.payments     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- payments: users see own; admins see all; service role bypasses RLS (Edge Functions)
CREATE POLICY "payments_user_select" ON public.payments
  FOR SELECT USING (auth.uid() = user_id OR public.auth_is_admin());

-- audit_log: read-only for admins; nobody writes directly (only service role via Edge Functions)
CREATE POLICY "audit_log_admin_select" ON public.audit_log
  FOR SELECT USING (public.auth_is_admin());

-- app_settings: admins read + write
CREATE POLICY "settings_admin_select" ON public.app_settings
  FOR SELECT USING (public.auth_is_admin());

CREATE POLICY "settings_admin_update" ON public.app_settings
  FOR UPDATE USING (public.auth_is_admin());
