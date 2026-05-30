-- Migration: reserve_paid_slot
-- Date: 2026-05-30
--
-- Closes the paid-path overbooking race (TOCTOU). create-payment used to check
-- capacity and THEN — after the Monei call — insert the PENDING "hold" as two
-- separate statements with no row lock, so two simultaneous payments for the
-- last spot could both pass the check and both get inserted later by the
-- webhook. The FREE path already serializes via join_match's SELECT ... FOR
-- UPDATE; this gives the PAID path the same guarantee.
--
-- reserve_paid_slot locks the match row, recounts capacity (real participants +
-- manual external counter + OTHER users' PENDING holds) and inserts THIS
-- PENDING payment as the hold — atomically. create-payment then creates the
-- Monei session and attaches monei_payment_id to this row (or deletes it on
-- failure). Because the hold is taken under the lock, a spot can never be
-- double-sold, so we never charge for a spot we cannot grant.
--
-- Prod tables only (matches/match_participants), like join_match; the dev split
-- is dormant. payments is filtered by env for correctness.

CREATE OR REPLACE FUNCTION public.reserve_paid_slot(
  p_match_id   uuid,
  p_env        text,
  p_user_id    uuid,
  p_user_name  text,
  p_user_email text,
  p_is_guest   boolean,
  p_order_id   text,
  p_amount     integer
)
RETURNS public.payments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_max     int;
  v_dummy   int;
  v_parts   int;
  v_pending int;
  v_row     public.payments;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Lock the match row so concurrent paid reservations serialize here.
  SELECT max_players, COALESCE(joined_players, 0)
    INTO v_max, v_dummy
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  SELECT count(*) INTO v_parts
  FROM public.match_participants
  WHERE match_id = p_match_id;

  -- Other users' in-flight holds (the caller's own PENDING is handled upstream
  -- in create-payment, which returns the existing pending instead of reserving).
  SELECT count(*) INTO v_pending
  FROM public.payments
  WHERE match_id = p_match_id
    AND env = p_env
    AND status = 'PENDING'
    AND user_id <> p_user_id;

  IF (v_parts + v_dummy + v_pending) >= v_max THEN
    RAISE EXCEPTION 'match_full';
  END IF;

  INSERT INTO public.payments (
    env, match_id, user_id, user_name, user_email, is_guest, order_id, amount, status
  ) VALUES (
    p_env, p_match_id, p_user_id, p_user_name, p_user_email, p_is_guest, p_order_id, p_amount, 'PENDING'
  )
  RETURNING * INTO v_row;

  RETURN v_row;
END;
$$;

-- Only the service role (create-payment Edge Function) may call this. It trusts
-- the caller's already-validated p_user_id and bypasses RLS as DEFINER, so it
-- must NOT be exposed to anon/authenticated clients.
REVOKE ALL ON FUNCTION public.reserve_paid_slot(uuid, text, uuid, text, text, boolean, text, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_paid_slot(uuid, text, uuid, text, text, boolean, text, integer) TO service_role;
