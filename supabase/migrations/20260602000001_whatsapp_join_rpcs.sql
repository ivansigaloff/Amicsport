-- Migration: whatsapp_join_rpcs
-- Date: 2026-06-02
--
-- ADDITIVE / ISOLATED service-role RPCs for the WhatsApp "join by code" flow.
-- New functions only — they do NOT modify join_match / reserve_paid_slot or any
-- existing flow, and are inert until whatsapp-webhook (not yet deployed) calls
-- them. service-role-only (the webhook has no JWT).
--
--   user_id_by_phone(phone)            → maps the WhatsApp `from` to a user
--   join_match_as(user_id, match, ...) → join, trusting an already-resolved
--                                        user_id instead of auth.uid()
--
-- join_match_as MIRRORS join_match's capacity/lock/invite-only logic but reads
-- the role from auth.users (no JWT). The duplication is intentional for isolated
-- development; unify the two onto a shared core at integration time.

-- ── phone → user ───────────────────────────────────────────────────────────
-- NOTE: matches auth.users.phone exactly. The webhook/registration must store
-- the phone in the SAME normalized form Meta sends (E.164). Keep normalization
-- in one place upstream so this stays a plain equality lookup.
CREATE OR REPLACE FUNCTION public.user_id_by_phone(p_phone text)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT id FROM auth.users WHERE phone = p_phone LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.user_id_by_phone(text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.user_id_by_phone(text) TO service_role;

-- ── join as a resolved user (service-role) ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.join_match_as(
  p_user_id   uuid,
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
  v_admin boolean;
  v_valid boolean;
  v_max   int;
  v_dummy int;
  v_req   boolean;
  v_count int;
  v_row   public.match_participants;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Role from auth.users (no JWT here). Invite-only: must be validated.
  SELECT COALESCE(raw_app_meta_data ->> 'role', '') = 'admin',
         (raw_app_meta_data ->> 'role') IS NOT NULL
    INTO v_admin, v_valid
  FROM auth.users WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'user_not_found';
  END IF;
  IF NOT v_valid THEN
    RAISE EXCEPTION 'not_validated';
  END IF;

  -- Lock the match row: serialize concurrent joins (same as join_match).
  SELECT max_players, COALESCE(joined_players, 0), requires_payment
    INTO v_max, v_dummy, v_req
  FROM public.matches WHERE id = p_match_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'match_not_found';
  END IF;

  -- Paid matches must go through the payment flow, not a free join.
  IF v_req AND NOT v_admin THEN
    RAISE EXCEPTION 'payment_required';
  END IF;

  -- Guests: only admins or existing participants of the match may add them.
  IF p_is_guest AND NOT v_admin THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.match_participants
      WHERE match_id = p_match_id AND user_id = p_user_id
    ) THEN
      RAISE EXCEPTION 'not_a_participant';
    END IF;
  END IF;

  SELECT count(*) INTO v_count
  FROM public.match_participants WHERE match_id = p_match_id;

  IF NOT v_admin AND (v_count + v_dummy) >= v_max THEN
    RAISE EXCEPTION 'match_full';
  END IF;

  BEGIN
    INSERT INTO public.match_participants (match_id, user_id, user_name, created_by)
    VALUES (
      p_match_id,
      CASE WHEN p_is_guest THEN NULL ELSE p_user_id END,
      p_user_name,
      p_user_id
    )
    RETURNING * INTO v_row;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'already_joined';
  END;

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.join_match_as(uuid, uuid, text, boolean) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_match_as(uuid, uuid, text, boolean) TO service_role;
