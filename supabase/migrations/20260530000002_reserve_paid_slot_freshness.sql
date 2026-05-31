-- Migration: reserve_paid_slot — freshness window on PENDING holds
-- Date: 2026-05-30
--
-- Problem: reserve_paid_slot counted ALL other users' PENDING holds toward
-- capacity with no time filter, and reconcile only EXPIRED a stale PENDING after
-- 24h. So an abandoned payment (user opened the Monei page, never paid) kept a
-- paid slot BLOCKED for up to 24h — if the match is sooner, that slot is wasted
-- (a real paying user can't take it) = lost sale.
--
-- Fix: only count PENDING holds created in the last 10 minutes toward capacity.
-- A genuine payment (card 3DS / Bizum RTP) completes well within 10 min; an
-- abandoned hold stops blocking the slot automatically after 10 min, in
-- real time, without waiting for any cron. (reconcile still tidies DB status.)
--
-- NOTE on the late-completion edge: if a hold "ages out" (>10 min), the slot can
-- be re-sold, and the original payment might still SUCCEED later at Monei. The
-- participant-creation paths (verify-payment / monei-webhook / reconcile) must
-- re-check capacity and REFUND instead of creating an over-capacity participant.

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

  -- Other users' in-flight holds — only those created in the last 6 minutes.
  -- create-payment sets the Monei session to expire at 5 min (so Monei itself
  -- frees abandoned sessions via an EXPIRED webhook); this 6-min window is the
  -- backup that stops a stale hold from blocking the slot even if that webhook
  -- is missed — in real time here, regardless of when the reconcile cron runs.
  SELECT count(*) INTO v_pending
  FROM public.payments
  WHERE match_id = p_match_id
    AND env = p_env
    AND status = 'PENDING'
    AND user_id <> p_user_id
    AND created_at > now() - interval '6 minutes';

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

REVOKE ALL ON FUNCTION public.reserve_paid_slot(uuid, text, uuid, text, text, boolean, text, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_paid_slot(uuid, text, uuid, text, text, boolean, text, integer) TO service_role;
