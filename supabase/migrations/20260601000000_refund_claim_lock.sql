-- Migration: refund_claim_lock
-- Date: 2026-06-01
--
-- Fixes the double-refund race (V1) and the daily-cap race (V2) in the
-- refund-payment Edge Function.
--
-- BEFORE: refund-payment read the payment, checked status + daily limits,
-- called Monei, then wrote REFUNDED — with NO row lock and NO atomic state
-- transition. Two concurrent requests (a double-click or a client retry on
-- timeout) could both read status=SUCCEEDED, both pass the checks, and both
-- issue a Monei refund → paying out twice. The daily cap had the same race:
-- concurrent claims all read the same "today" total and all slipped under it.
--
-- AFTER: claim_refund() makes the whole decision atomic:
--   1. pg_advisory_xact_lock serializes ALL refund claims, so the daily-cap
--      read+write is race-free (closes V2).
--   2. SELECT ... FOR UPDATE locks the target payment row (closes V1).
--   3. Re-validates ownership + status under the lock and flips
--      SUCCEEDED -> REFUNDING as a compare-and-swap. Only ONE concurrent caller
--      can win; the others see status <> SUCCEEDED and are rejected.
--   4. Over the daily cap -> transitions SUCCEEDED -> PENDING_REFUND_ADMIN and
--      reports it (same behaviour as before, now atomic).
--
-- The Edge Function then calls Monei with the claim in hand and finalizes
-- REFUNDING -> REFUNDED (or rolls the claim back to SUCCEEDED on Monei failure).
-- A claim left in REFUNDING by a crashed invocation is money-SAFE — it blocks
-- further refund attempts rather than allowing a double payout — and should be
-- reconciled against Monei (see reconcile-payments follow-up).
--
-- Mirrors reserve_paid_slot: SECURITY DEFINER, service_role-only, prod+dev via
-- the env column on payments.

-- ── 1. Allow the new intermediate status on payments.status ────────────────
-- The original CHECK was created inline (auto-named payments_status_check).
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check
  CHECK (status IN (
    'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED',
    'REFUNDED', 'PARTIALLY_REFUNDED', 'EXPIRED',
    'PENDING_REFUND_ADMIN',
    'REFUNDING'              -- claimed, Monei refund in flight (this migration)
  ));

-- ── 2. Atomic claim function ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.claim_refund(
  p_payment_id uuid,
  p_user_id    uuid,
  p_is_admin   boolean,
  p_force      boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pay          public.payments;
  v_refund       integer;
  v_count_limit  integer;
  v_amount_limit integer;
  v_today_count  integer;
  v_today_amount bigint;
  v_day_start    timestamptz := date_trunc('day', now());
BEGIN
  -- Serialize all refund claims: makes the daily-cap read+write below race-free.
  -- Transaction-scoped: released automatically when this RPC's txn ends.
  PERFORM pg_advisory_xact_lock(hashtext('refund-claim'));

  -- Lock the target payment for the rest of the transaction.
  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- Ownership: non-admins may only refund their own payment. Reported as
  -- not_found so the endpoint does not reveal that the id exists.
  IF NOT p_is_admin AND v_pay.user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_pay.status <> 'SUCCEEDED' THEN
    -- REFUNDING => a concurrent claim already won the race.
    RETURN jsonb_build_object('outcome', 'not_succeeded', 'status', v_pay.status);
  END IF;

  IF v_pay.refunded_amount >= v_pay.amount THEN
    RETURN jsonb_build_object('outcome', 'already_refunded');
  END IF;

  v_refund := v_pay.amount - v_pay.refunded_amount;

  -- Daily limit (skipped only for admin + force, matching the old behaviour).
  IF NOT (p_is_admin AND p_force) THEN
    SELECT COALESCE((value #>> '{}')::int, 10)
      INTO v_count_limit
      FROM public.app_settings WHERE key = 'daily_refund_count_limit';
    v_count_limit := COALESCE(v_count_limit, 10);

    SELECT COALESCE((value #>> '{}')::int, 100000)
      INTO v_amount_limit
      FROM public.app_settings WHERE key = 'daily_refund_amount_limit_cents';
    v_amount_limit := COALESCE(v_amount_limit, 100000);

    -- Count refunds already settled today PLUS in-flight claims (REFUNDING from
    -- today, by updated_at), so a concurrent burst cannot collectively overshoot
    -- the cap. An in-flight claim contributes its yet-to-be-paid amount.
    SELECT
      count(*),
      COALESCE(SUM(CASE WHEN status = 'REFUNDING'
                        THEN amount - refunded_amount
                        ELSE refunded_amount END), 0)
      INTO v_today_count, v_today_amount
    FROM public.payments
    WHERE (status = 'REFUNDING' AND updated_at >= v_day_start)
       OR (status IN ('REFUNDED', 'PARTIALLY_REFUNDED') AND refunded_at >= v_day_start);

    IF v_today_count >= v_count_limit
       OR v_today_amount + v_refund > v_amount_limit THEN
      UPDATE public.payments SET status = 'PENDING_REFUND_ADMIN' WHERE id = v_pay.id;
      RETURN jsonb_build_object('outcome', 'blocked_limit');
    END IF;
  END IF;

  -- Claim it: SUCCEEDED -> REFUNDING (compare-and-swap under the row lock).
  UPDATE public.payments SET status = 'REFUNDING' WHERE id = v_pay.id;

  RETURN jsonb_build_object(
    'outcome',          'claimed',
    'refund_amount',    v_refund,
    'amount',           v_pay.amount,
    'refunded_amount',  v_pay.refunded_amount,
    'env',              v_pay.env,
    'match_id',         v_pay.match_id,
    'participant_id',   v_pay.participant_id,
    'monei_payment_id', v_pay.monei_payment_id
  );
END;
$$;

-- Only the service role (refund-payment Edge Function) may call this. It trusts
-- the caller's already-validated p_user_id / p_is_admin and bypasses RLS as
-- DEFINER, so it must NOT be exposed to anon/authenticated clients.
REVOKE ALL ON FUNCTION public.claim_refund(uuid, uuid, boolean, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_refund(uuid, uuid, boolean, boolean) TO service_role;
