-- Migration: authenticated-only reads + server-side leave deadline + server-derived names
-- Date: 2026-09-08
--
-- Closes three findings of the 2026-09 security review:
--
--   1. matches / match_participants were readable with the public anon key
--      (`USING (true)`): anyone could list every match (incl. the organizer's
--      creator_email) and every participant name without an account. The app
--      never shows these screens to anonymous visitors (the _layout gate sends
--      them to /login), so restricting reads to authenticated users is a
--      no-op for legitimate use.
--
--   2. The cancellation deadline ("no puedes desapuntarte si faltan menos de
--      X horas") was enforced only in the UI for FREE matches. The
--      participants_delete policy let a user delete their own row at any time
--      via the REST API. A BEFORE DELETE trigger now raises
--      cancellation_deadline_passed for non-admin self/guest removals. The
--      service role (webhooks, request_return) and admins bypass it; the paid
--      path keeps its own gate in refund-payment.
--
--   3. join_match trusted p_user_name from the client, so a regular user could
--      appear under any display name (and guests under any host). The name is
--      now derived from the caller's JWT for non-admins; guests must be
--      "<caller name> (invitado…)". Admins keep free-form names (directory
--      inscriptions). Waitlist / payment / invite-only guards are unchanged —
--      this body is the 2026-06-04 canonical one plus the name derivation.

-- ── 1. Reads require an authenticated session ───────────────────────────────
DROP POLICY IF EXISTS matches_select ON public.matches;
CREATE POLICY matches_select ON public.matches
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS participants_select ON public.match_participants;
CREATE POLICY participants_select ON public.match_participants
  FOR SELECT USING (auth.role() = 'authenticated');

-- ── 2. Cancellation deadline on free leave ─────────────────────────────────
-- Madrid wall-clock comparison, mirroring refund-payment / cancellationDeadline.ts.
-- Unresolvable dates (legacy rows with match_date NULL, unparseable time) do not
-- block, same as the Edge Functions.
CREATE OR REPLACE FUNCTION public.match_cancel_deadline_passed(p_match_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_date  date;
  v_time  text;
  v_hours int;
  v_start timestamptz;
BEGIN
  SELECT match_date, time, cancellation_hours
    INTO v_date, v_time, v_hours
  FROM public.matches WHERE id = p_match_id;

  IF NOT FOUND OR v_date IS NULL OR v_time IS NULL OR btrim(v_time) = '' THEN
    RETURN false;
  END IF;

  BEGIN
    v_start := (v_date + btrim(v_time)::time) AT TIME ZONE 'Europe/Madrid';
  EXCEPTION WHEN OTHERS THEN
    RETURN false;
  END;

  RETURN now() > v_start - make_interval(hours => COALESCE(NULLIF(v_hours, 0), 12));
END;
$$;

REVOKE ALL ON FUNCTION public.match_cancel_deadline_passed(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.match_cancel_deadline_passed(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.enforce_leave_deadline()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- No JWT (service role: webhooks, request_return, cron) or admin → bypass.
  IF v_uid IS NULL OR public.auth_is_admin() THEN
    RETURN OLD;
  END IF;

  -- Waitlisted rows hold no slot; leaving the waiting list is always allowed.
  IF OLD.waitlist THEN
    RETURN OLD;
  END IF;

  IF public.match_cancel_deadline_passed(OLD.match_id) THEN
    RAISE EXCEPTION 'cancellation_deadline_passed';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS match_participants_leave_deadline ON public.match_participants;
CREATE TRIGGER match_participants_leave_deadline
  BEFORE DELETE ON public.match_participants
  FOR EACH ROW EXECUTE FUNCTION public.enforce_leave_deadline();

-- ── 3. join_match: server-derived participant name ─────────────────────────
-- ⚠️ Canonical body = 20260604000000_join_match_restore_guards.sql + name
-- derivation. Do NOT base future edits on an older version.
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
  -- Same fallback chain the client uses for its display name (useMatch.ts).
  v_jwt_name  text := COALESCE(
                 NULLIF(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
                 NULLIF(auth.jwt() -> 'user_metadata' ->> 'name', ''),
                 NULLIF(split_part(COALESCE(auth.jwt() ->> 'email', ''), '@', 1), ''),
                 'Jugador App');
  v_name      text;
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
  IF NOT public.auth_is_validated() THEN
    RAISE EXCEPTION 'not_validated';
  END IF;

  -- Name: admins inscribe directory players by free-form name; regular users
  -- join under their own JWT name, and their guests must be "<name> (invitado…)".
  IF v_admin THEN
    v_name := left(COALESCE(NULLIF(p_user_name, ''), v_jwt_name), 80);
  ELSIF p_is_guest THEN
    IF p_user_name IS NULL OR position(v_jwt_name || ' (invitado' IN p_user_name) <> 1 THEN
      RAISE EXCEPTION 'invalid_guest_name';
    END IF;
    v_name := left(p_user_name, 80);
  ELSE
    v_name := left(v_jwt_name, 80);
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

  -- Paid matches: only admins may add a free participant here.
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
      v_name,
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
