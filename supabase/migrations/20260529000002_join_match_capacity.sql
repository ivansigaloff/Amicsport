-- Migration: join_match_capacity
-- Date: 2026-05-29
--
-- Fixes the overbooking hole: previously joins/guest-adds were plain client
-- INSERTs with no server-side capacity enforcement, so concurrent joins could
-- exceed max_players. This adds an atomic RPC that locks the match row
-- (SELECT ... FOR UPDATE) to serialize concurrent joins for the same match,
-- checks capacity, and inserts in one transaction.
--
-- Capacity = count(match_participants) + matches.joined_players (the manual
-- "external players" counter) must stay below max_players.
--
-- Rules enforced inside the function (it is SECURITY DEFINER, so it bypasses
-- RLS and must re-check auth itself):
--   - caller must be authenticated
--   - non-guest: inserts as the caller (user_id = auth.uid())
--   - guest: caller must be an admin OR already a participant of the match
--   - admins bypass the capacity cap (they fill/overfill deliberately);
--     regular users are capped
--
-- The paid path (create-payment Edge Function) does its own capacity check
-- since paid participants are inserted later by the webhook with the service
-- role, not through this RPC.

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
  v_count   int;
  v_row     public.match_participants;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Lock the match row so concurrent joins for this match serialize here.
  SELECT max_players, COALESCE(joined_players, 0)
    INTO v_max, v_dummy
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found';
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
