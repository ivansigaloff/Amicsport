-- Migration: async_refund_queue + confirm_paid_slot
-- Date: 2026-06-01
--
-- Reworks refunds into an asynchronous queue and serializes paid-slot
-- confirmation, closing every payment-pipeline race we found:
--
--   V1  double refund (manual)                  -> single worker owns Monei /refund
--   V2  daily-cap race                          -> enforced in the single worker
--   A   duplicate (guest) participant on confirm -> confirm_paid_slot locks match
--   B   overbooking last spot on confirm        -> confirm_paid_slot locks match
--   C   double refund via confirm "full" branch -> confirm just queues, never calls Monei
--   D   refund undone by late webhook           -> new PENDING_RETURN/RETURNING states
--                                                  (callers treat them as terminal)
--
-- Model:
--   Cancel (synchronous, refund-payment fn):  SUCCEEDED -> PENDING_RETURN
--     + delete the participant (frees the spot immediately). NO Monei call.
--   Worker (reconcile-payments fn):  claim_returns() flips
--     PENDING_RETURN -> RETURNING (FOR UPDATE SKIP LOCKED, so overlapping runs
--     never grab the same row), calls Monei /refund, then RETURNING -> REFUNDED
--     (or back to PENDING_RETURN on a transient failure / PENDING_REFUND_ADMIN
--     when the daily cap is hit). A RETURNING row orphaned by a crash is
--     money-safe and is reconciled against Monei on the next run.
--
-- Supersedes the unapplied 20260601000000_refund_claim_lock.sql (claim_refund),
-- dropped defensively below in case it was applied.

-- ── 0. Drop the superseded function (no-op if it never existed) ────────────
DROP FUNCTION IF EXISTS public.claim_refund(uuid, uuid, boolean, boolean);

-- ── 1. Payment status states: add PENDING_RETURN + RETURNING ───────────────
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_status_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_status_check
  CHECK (status IN (
    'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELED',
    'REFUNDED', 'PARTIALLY_REFUNDED', 'EXPIRED',
    'PENDING_REFUND_ADMIN',
    'PENDING_RETURN',   -- cancelled: spot freed, refund queued (this migration)
    'RETURNING'         -- claimed by the refund worker, Monei /refund in flight
  ));

-- Worker scans this constantly; keep it cheap.
CREATE INDEX IF NOT EXISTS payments_status_return_idx
  ON public.payments (status) WHERE status IN ('PENDING_RETURN', 'RETURNING');

-- Admin-initiated returns are exempt from the worker's daily cap (preserves the
-- old admin "force" bypass; the cap is an anti-fraud net for user self-refunds).
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS return_admin boolean NOT NULL DEFAULT false;

-- ── 2. request_return: cancel a paid spot (atomic, no external I/O) ─────────
-- Locks the payment row, validates ownership + state, flips SUCCEEDED ->
-- PENDING_RETURN as a compare-and-swap, and deletes the participant so the spot
-- is resellable at once. Only one caller can win the CAS, so a double-click /
-- retry is a harmless 'already_requested'. The Monei refund is done later by the
-- worker. Deadline enforcement stays in the Edge Function (needs Madrid wall
-- clock); this is the atomic state transition only.
CREATE OR REPLACE FUNCTION public.request_return(
  p_payment_id uuid,
  p_user_id    uuid,
  p_is_admin   boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pay public.payments;
BEGIN
  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  -- Ownership: non-admins may only cancel their own payment. Reported as
  -- not_found so the endpoint does not reveal that the id exists.
  IF NOT p_is_admin AND v_pay.user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  IF v_pay.status IN ('PENDING_RETURN', 'RETURNING') THEN
    RETURN jsonb_build_object('outcome', 'already_requested');
  END IF;
  IF v_pay.status <> 'SUCCEEDED' THEN
    RETURN jsonb_build_object('outcome', 'not_succeeded', 'status', v_pay.status);
  END IF;
  IF v_pay.refunded_amount >= v_pay.amount THEN
    RETURN jsonb_build_object('outcome', 'already_refunded');
  END IF;

  -- Queue the money return and free the spot immediately. Admin requests are
  -- flagged so the worker exempts them from the daily cap.
  UPDATE public.payments
    SET status = 'PENDING_RETURN', return_admin = p_is_admin
    WHERE id = v_pay.id;

  IF v_pay.participant_id IS NOT NULL THEN
    IF v_pay.env = 'dev' THEN
      DELETE FROM public.match_participants_dev WHERE id = v_pay.participant_id;
    ELSE
      DELETE FROM public.match_participants     WHERE id = v_pay.participant_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('outcome', 'queued');
END;
$$;

-- ── 3. claim_returns: the worker's atomic batch claim ──────────────────────
-- Flips up to p_limit PENDING_RETURN rows to RETURNING and returns them.
-- FOR UPDATE SKIP LOCKED guarantees two concurrent worker runs never claim the
-- same row, so the Monei /refund for a payment happens exactly once.
CREATE OR REPLACE FUNCTION public.claim_returns(p_limit int DEFAULT 50)
RETURNS SETOF public.payments
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  UPDATE public.payments p
  SET status = 'RETURNING'
  WHERE p.id IN (
    SELECT id FROM public.payments
    WHERE status = 'PENDING_RETURN'
    ORDER BY updated_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING p.*;
$$;

-- ── 4. confirm_paid_slot: serialized paid-slot confirmation (fixes A + B) ───
-- Replaces the unlocked check-then-act in _shared/confirmSlot.ts. Locks the
-- match row so the three confirm paths (webhook / verify-payment / reconcile)
-- serialize: re-checks idempotency + capacity and inserts the participant under
-- the lock, or signals 'queued_return' when the match filled while the hold
-- aged out (the caller sets PENDING_RETURN; the worker refunds — never Monei
-- here). Mirrors confirmSlotOrRefund: capacity from matches.joined_players,
-- participants in the env table.
CREATE OR REPLACE FUNCTION public.confirm_paid_slot(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pay   public.payments;
  v_max   int;
  v_join  int;
  v_count int;
  v_exist uuid;
  v_pid   uuid;
BEGIN
  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'payment_not_found');
  END IF;

  -- Lock the match row (env-aware): serialize every confirmation for this match.
  IF v_pay.env = 'dev' THEN
    SELECT max_players, COALESCE(joined_players, 0) INTO v_max, v_join
    FROM public.matches_dev WHERE id = v_pay.match_id FOR UPDATE;
  ELSE
    SELECT max_players, COALESCE(joined_players, 0) INTO v_max, v_join
    FROM public.matches WHERE id = v_pay.match_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'match_not_found');
  END IF;

  -- Idempotency under the lock (closes the webhook/verify/reconcile race).
  IF v_pay.is_guest THEN
    IF v_pay.env = 'dev' THEN
      SELECT id INTO v_exist FROM public.match_participants_dev
        WHERE match_id = v_pay.match_id AND user_id IS NULL AND user_name = v_pay.user_name LIMIT 1;
    ELSE
      SELECT id INTO v_exist FROM public.match_participants
        WHERE match_id = v_pay.match_id AND user_id IS NULL AND user_name = v_pay.user_name LIMIT 1;
    END IF;
  ELSE
    IF v_pay.env = 'dev' THEN
      SELECT id INTO v_exist FROM public.match_participants_dev
        WHERE match_id = v_pay.match_id AND user_id = v_pay.user_id LIMIT 1;
    ELSE
      SELECT id INTO v_exist FROM public.match_participants
        WHERE match_id = v_pay.match_id AND user_id = v_pay.user_id LIMIT 1;
    END IF;
  END IF;
  IF v_exist IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'confirmed', 'participant_id', v_exist);
  END IF;

  -- Capacity: real participants (env table) + manual external counter.
  IF v_pay.env = 'dev' THEN
    SELECT count(*) INTO v_count FROM public.match_participants_dev WHERE match_id = v_pay.match_id;
  ELSE
    SELECT count(*) INTO v_count FROM public.match_participants     WHERE match_id = v_pay.match_id;
  END IF;

  IF (v_count + v_join) >= v_max THEN
    -- Filled while this hold aged out → owe a refund. Queue it; never overbook.
    RETURN jsonb_build_object('outcome', 'queued_return');
  END IF;

  -- Room → create the participant (created_by = paying host, even for guests).
  BEGIN
    IF v_pay.env = 'dev' THEN
      INSERT INTO public.match_participants_dev (match_id, user_id, user_name, created_by)
      VALUES (v_pay.match_id, CASE WHEN v_pay.is_guest THEN NULL ELSE v_pay.user_id END, v_pay.user_name, v_pay.user_id)
      RETURNING id INTO v_pid;
    ELSE
      INSERT INTO public.match_participants (match_id, user_id, user_name, created_by)
      VALUES (v_pay.match_id, CASE WHEN v_pay.is_guest THEN NULL ELSE v_pay.user_id END, v_pay.user_name, v_pay.user_id)
      RETURNING id INTO v_pid;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent confirm for the same registered user won; reuse its row.
    IF v_pay.env = 'dev' THEN
      SELECT id INTO v_pid FROM public.match_participants_dev
        WHERE match_id = v_pay.match_id AND user_id = v_pay.user_id LIMIT 1;
    ELSE
      SELECT id INTO v_pid FROM public.match_participants
        WHERE match_id = v_pay.match_id AND user_id = v_pay.user_id LIMIT 1;
    END IF;
  END;

  RETURN jsonb_build_object('outcome', 'confirmed', 'participant_id', v_pid);
END;
$$;

-- ── 5. Lock down EXECUTE to the service role (Edge Functions only) ─────────
REVOKE ALL ON FUNCTION public.request_return(uuid, uuid, boolean)  FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_returns(int)                   FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirm_paid_slot(uuid)              FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_return(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_returns(int)                 TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_paid_slot(uuid)            TO service_role;
