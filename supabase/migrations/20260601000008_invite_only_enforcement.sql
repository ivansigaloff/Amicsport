-- Migration: invite_only_enforcement
-- Date: 2026-06-02
--
-- The app is invite-only, but enable_confirmations=false means signUp grants a
-- session immediately, and the invite code is validated AFTER (validate-invite
-- writes app_metadata.role). So a fake code leaves a roleless-but-authenticated
-- account that could still join matches. The client can't be the boundary (the
-- attacker controls it), so enforce server-side: writes require a VALIDATED role
-- (app_metadata.role set by validate-invite).
--
-- auth_is_validated() = the JWT carries app_metadata.role. All legitimate users
-- have it (secure_roles backfilled existing users; validate-invite sets it on
-- new ones), so this does not lock anyone out — only never-validated orphans.

CREATE OR REPLACE FUNCTION public.auth_is_validated()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT (auth.jwt() -> 'app_metadata' ->> 'role') IS NOT NULL
$$;

-- ── join_match: require a validated role (+ keep the paid-match guard) ──────
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

  -- Invite-only: only validated accounts may join.
  IF NOT public.auth_is_validated() THEN
    RAISE EXCEPTION 'not_validated';
  END IF;

  SELECT max_players, COALESCE(joined_players, 0), requires_payment
    INTO v_max, v_dummy, v_req
  FROM public.matches
  WHERE id = p_match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  IF v_req AND NOT v_admin THEN
    RAISE EXCEPTION 'payment_required';
  END IF;

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

-- ── RLS: direct participant inserts also require a validated role ───────────
DROP POLICY IF EXISTS participants_insert ON public.match_participants;
CREATE POLICY participants_insert ON public.match_participants
  FOR INSERT WITH CHECK (
    auth_is_admin()
    OR (
      auth.role() = 'authenticated' AND public.auth_is_validated() AND user_id = auth.uid()
      AND NOT EXISTS (
        SELECT 1 FROM public.matches m
        WHERE m.id = match_participants.match_id AND m.requires_payment
      )
    )
    OR (
      auth.role() = 'authenticated' AND public.auth_is_validated() AND user_id IS NULL
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

DROP POLICY IF EXISTS participants_dev_insert ON public.match_participants_dev;
CREATE POLICY participants_dev_insert ON public.match_participants_dev
  FOR INSERT WITH CHECK (
    auth_is_dev() AND (
      auth_is_admin()
      OR (
        public.auth_is_validated() AND user_id = auth.uid()
        AND NOT EXISTS (
          SELECT 1 FROM public.matches_dev m
          WHERE m.id = match_participants_dev.match_id AND m.requires_payment
        )
      )
      OR (
        public.auth_is_validated() AND user_id IS NULL
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
