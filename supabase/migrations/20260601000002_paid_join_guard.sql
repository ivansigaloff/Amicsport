-- Migration: paid_join_guard
-- Date: 2026-06-01
--
-- Closes the payment bypass (review invariant 2): requires_payment was ONLY
-- checked in create-payment. Nothing stopped a regular authenticated user from
-- getting a FREE spot in a paid match via:
--   - a direct INSERT (RLS participants_insert allowed user_id = auth.uid()
--     for ANY match), or
--   - the join_match RPC (SECURITY DEFINER, no payment check).
--
-- Fix, two layers:
--   1. RLS: forbid self / guest inserts into a match that requires payment.
--      Paid participants are inserted by confirm_paid_slot with the service role
--      (bypasses RLS), so legitimate paid joins are unaffected. Admins keep
--      their unconditional insert (comp players at their discretion).
--   2. join_match: raise payment_required for non-admins on paid matches.
--
-- NOTE: this sets the correct gated participants_insert policy outright, but its
-- effectiveness assumes no OTHER permissive INSERT policy lingers on
-- match_participants (permissive policies OR together — the loosest wins). Verify
-- with: SELECT * FROM pg_policies WHERE tablename='match_participants' AND cmd='INSERT';

-- ── 1. join_match: block non-admin free joins on paid matches ──────────────
CREATE OR REPLACE FUNCTION public.join_match(
  p_match_id  uuid,
  p_user_name text,
  p_is_guest  boolean DEFAULT false
)
RETURNS public.match_participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_admin   boolean := public.auth_is_admin();
  v_max     int;
  v_dummy   int;
  v_req     boolean;
  v_count   int;
  v_row     public.match_participants;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Lock the match row so concurrent joins for this match serialize here.
  SELECT max_players, COALESCE(joined_players, 0), requires_payment
    INTO v_max, v_dummy, v_req
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  -- Paid matches: only admins may add a free participant here. Everyone else
  -- must go through create-payment (which inserts via confirm_paid_slot).
  IF v_req AND NOT v_admin THEN
    RAISE EXCEPTION 'payment_required';
  END IF;

  -- Guests can only be added by an admin or by an existing participant.
  IF p_is_guest AND NOT v_admin THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.match_participants
      WHERE match_id = p_match_id AND user_id = v_uid
    ) THEN
      RAISE EXCEPTION 'not_a_participant';
    END IF;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.match_participants
  WHERE match_id = p_match_id;

  -- Capacity cap applies to regular users; admins may overfill.
  IF NOT v_admin AND (v_count + v_dummy) >= v_max THEN
    RAISE EXCEPTION 'match_full';
  END IF;

  BEGIN
    INSERT INTO public.match_participants (match_id, user_id, user_name, created_by)
    VALUES (
      p_match_id,
      CASE WHEN p_is_guest THEN NULL ELSE v_uid END,
      p_user_name,
      v_uid
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_joined';
  END;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.join_match(uuid, text, boolean) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.join_match(uuid, text, boolean) TO authenticated;

-- ── 2. RLS: forbid direct self / guest inserts into a paid match ───────────
DROP POLICY IF EXISTS participants_insert ON public.match_participants;
CREATE POLICY participants_insert ON public.match_participants
  FOR INSERT WITH CHECK (
    auth_is_admin()
    OR (
      auth.role() = 'authenticated' AND user_id = auth.uid()
      AND NOT EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.id = match_participants.match_id AND m.requires_payment
      )
    )
    OR (
      auth.role() = 'authenticated' AND user_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.id = match_participants.match_id AND m.requires_payment
      )
      AND EXISTS (
        SELECT 1 FROM public.match_participants p
        WHERE p.match_id = match_participants.match_id AND p.user_id = auth.uid()
      )
    )
  );

-- Mirror for the (dormant) dev tables.
DROP POLICY IF EXISTS participants_dev_insert ON public.match_participants_dev;
CREATE POLICY participants_dev_insert ON public.match_participants_dev
  FOR INSERT WITH CHECK (
    auth_is_dev() AND (
      auth_is_admin()
      OR (
        user_id = auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM public.matches_dev m
          WHERE m.id = match_participants_dev.match_id AND m.requires_payment
        )
      )
      OR (
        user_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.matches_dev m
          WHERE m.id = match_participants_dev.match_id AND m.requires_payment
        )
        AND EXISTS (
          SELECT 1 FROM public.match_participants_dev p
          WHERE p.match_id = match_participants_dev.match_id AND p.user_id = auth.uid()
        )
      )
    )
  );
