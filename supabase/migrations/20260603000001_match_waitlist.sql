-- Migration: match waitlist + automatic promotion
-- Date: 2026-06-03
--
-- Adds a waiting list to match_participants:
--   - The admin can inscribe players ABOVE max_players; the overflow rows are
--     flagged waitlist = true and ordered by created_at (FIFO).
--   - Capacity (max_players) now counts only ACTIVE rows (waitlist = false) plus
--     the manual joined_players counter. Waitlisted rows do not consume a slot.
--   - When an ACTIVE participant leaves (any delete path: self-leave, admin
--     removal, own-guest removal), an AFTER DELETE trigger promotes the oldest
--     waitlisted player into the match (waitlist -> false) and flags it with
--     pending_promotion_notice so the notify-promotion Edge Function can email
--     the admin and the promoted player.
--
-- The trigger locks the match row (SELECT ... FOR UPDATE) before promoting so two
-- concurrent leaves promote two DIFFERENT waitlisters (no double-promotion of the
-- same row, no missed slot) — same serialization pattern as join_match.

-- ── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.match_participants
  ADD COLUMN IF NOT EXISTS waitlist                 boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pending_promotion_notice boolean NOT NULL DEFAULT false;

-- FIFO lookup of the next waitlister per match.
CREATE INDEX IF NOT EXISTS match_participants_waitlist_idx
  ON public.match_participants (match_id, created_at)
  WHERE waitlist;

-- ── 2. join_match: count only active rows, admin overflow goes to the waitlist ─
-- Replaces 20260529000002_join_match_capacity.sql. Capacity check now ignores
-- waitlisted rows. When the match is full: an admin's insert goes to the
-- waitlist (waitlist = true); a regular user is still rejected with match_full.
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
  v_full      boolean;
  v_waitlist  boolean := false;
  v_row       public.match_participants;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Lock the match row so concurrent joins for this match serialize here.
  SELECT max_players, COALESCE(joined_players, 0)
    INTO v_max, v_joined
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

-- ── 3. Promotion trigger ──────────────────────────────────────────────────────
-- AFTER DELETE on match_participants. When the deleted row was ACTIVE and a free
-- active slot now exists, promote the oldest waitlisted player for that match and
-- flag it for notification. SECURITY DEFINER so the cascade/RLS context does not
-- block the UPDATE on a sibling row.
CREATE OR REPLACE FUNCTION public.promote_waitlist_after_leave()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_max    int;
  v_joined int;
  v_active int;
  v_next   uuid;
BEGIN
  -- Only a freed ACTIVE slot can trigger a promotion.
  IF OLD.waitlist THEN
    RETURN OLD;
  END IF;

  -- Serialize per-match so concurrent leaves promote distinct waitlisters.
  SELECT max_players, COALESCE(joined_players, 0)
    INTO v_max, v_joined
  FROM public.matches
  WHERE id = OLD.match_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN OLD; -- match gone (full deletion) — nothing to promote
  END IF;

  SELECT count(*) INTO v_active
  FROM public.match_participants
  WHERE match_id = OLD.match_id AND NOT waitlist;

  -- No free active slot → leave the waitlist as is.
  IF (v_active + v_joined) >= v_max THEN
    RETURN OLD;
  END IF;

  -- Oldest waitlister (FIFO).
  SELECT id INTO v_next
  FROM public.match_participants
  WHERE match_id = OLD.match_id AND waitlist
  ORDER BY created_at ASC
  LIMIT 1;

  IF v_next IS NULL THEN
    RETURN OLD; -- empty waitlist
  END IF;

  UPDATE public.match_participants
    SET waitlist = false,
        pending_promotion_notice = true
  WHERE id = v_next;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS match_participants_promote_waitlist ON public.match_participants;
CREATE TRIGGER match_participants_promote_waitlist
  AFTER DELETE ON public.match_participants
  FOR EACH ROW EXECUTE FUNCTION public.promote_waitlist_after_leave();
