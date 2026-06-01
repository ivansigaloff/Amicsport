-- Migration: adjust_joined_players
-- Date: 2026-06-01
--
-- Replaces the client read-modify-write of matches.joined_players (the manual
-- "external players" counter): removeDummyPlayer fetched the current value and
-- wrote current-1 in two round-trips, so two concurrent admin edits could lose
-- an update, and the wide window made it worse. This does the delta atomically
-- in one statement, clamped at 0, and returns the new value.
--
-- Admin-only (the function is SECURITY DEFINER so it bypasses RLS and re-checks
-- the role itself, like join_match). env-aware for the dormant dev split.

CREATE OR REPLACE FUNCTION public.adjust_joined_players(
  p_match_id uuid,
  p_delta    int,
  p_env      text DEFAULT 'prod'
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new int;
BEGIN
  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  IF p_env = 'dev' THEN
    UPDATE public.matches_dev
      SET joined_players = GREATEST(0, COALESCE(joined_players, 0) + p_delta)
      WHERE id = p_match_id
      RETURNING joined_players INTO v_new;
  ELSE
    UPDATE public.matches
      SET joined_players = GREATEST(0, COALESCE(joined_players, 0) + p_delta)
      WHERE id = p_match_id
      RETURNING joined_players INTO v_new;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  RETURN v_new;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_joined_players(uuid, int, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.adjust_joined_players(uuid, int, text) TO authenticated;
