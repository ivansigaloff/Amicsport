-- Migration: join_match — restore payment + invite-only guards (regression fix)
-- Date: 2026-06-04
--
-- REGRESSION: 20260603000001_match_waitlist.sql rewrote join_match starting from
-- the 2026-05-29 capacity version (its header says "Replaces
-- 20260529000002_join_match_capacity.sql"), which predated TWO guards that had
-- since been added to the function body:
--   - payment_required  (20260601000002_paid_join_guard.sql)
--   - not_validated      (20260601000008_invite_only_enforcement.sql)
-- So the waitlist rewrite silently dropped both. Because join_match is
-- SECURITY DEFINER + GRANT EXECUTE TO authenticated, it BYPASSES RLS — meaning any
-- authenticated user could call rpc('join_match', { paid match }) and get a FREE
-- spot in a paid match (Monei bypass), and a never-validated orphan account could
-- join any match (invite-only bypass).
--
-- FIX: re-add both guards on top of the waitlist version, KEEPING the waitlist
-- behaviour intact — admin overflow above max_players still lands on the waiting
-- list (waitlist = true, FIFO by created_at); regular users are still rejected
-- with match_full and never reach the waitlist.
--
-- ⚠️ Future editors: do NOT base join_match on a pre-2026-06-04 version. The
-- canonical body (guards + waitlist) lives here.

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
  v_uid       uuid := auth.uid();
  v_admin     boolean := public.auth_is_admin();
  v_max       int;
  v_joined    int;
  v_active    int;
  v_req       boolean;
  v_full      boolean;
  v_waitlist  boolean := false;
  v_row       public.match_participants;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Invite-only: only validated accounts (app_metadata.role set) may join.
  -- (Restored: the waitlist rewrite had dropped this guard.)
  IF NOT public.auth_is_validated() THEN
    RAISE EXCEPTION 'not_validated';
  END IF;

  -- Lock the match row so concurrent joins for this match serialize here.
  SELECT max_players, COALESCE(joined_players, 0), requires_payment
    INTO v_max, v_joined, v_req
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  -- Paid matches: only admins may add a free participant here. Everyone else
  -- must go through create-payment (which inserts via confirm_paid_slot).
  -- (Restored: the waitlist rewrite had dropped this guard → free paid joins.)
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

  -- Active occupancy = active participants (NOT waitlist) + manual external counter.
  SELECT count(*) INTO v_active
  FROM public.match_participants
  WHERE match_id = p_match_id AND NOT waitlist;

  v_full := (v_active + v_joined) >= v_max;

  IF v_full THEN
    IF v_admin THEN
      v_waitlist := true;          -- admin overflow → waiting list (FIFO by created_at)
    ELSE
      RAISE EXCEPTION 'match_full'; -- regular users cannot reach the waitlist
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.match_participants (match_id, user_id, user_name, created_by, waitlist)
    VALUES (
      p_match_id,
      CASE WHEN p_is_guest THEN NULL ELSE v_uid END,
      p_user_name,
      v_uid,
      v_waitlist
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
