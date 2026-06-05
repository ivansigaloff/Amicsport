-- Migration: confirm_paid_slot — payment-scoped idempotency for guests
-- Date: 2026-06-05
--
-- V3 (security analysis 2026-06-05): confirm_paid_slot deduplicated guest
-- participants by (match_id, user_name). Two DIFFERENT guest payments with the
-- SAME guest name on the SAME paid match would collide: the 2nd payment's
-- confirmation found the 1st guest's row and returned it as 'confirmed', so the
-- host was charged twice but only one slot was ever created.
--
-- Fix: link each participant row to the payment that created it
-- (match_participants.payment_id) and key the confirmation idempotency on THAT
-- exact payment instead of the display name. Registered-user dedup by user_id
-- (protected by UNIQUE(match_id, user_id)) is kept as a secondary guard for users
-- who joined the match by another path. The match-row lock still serializes the
-- three confirm paths (webhook / verify-payment / reconcile).

-- ── 1. Link column + backfill + index ──────────────────────────────────────
ALTER TABLE public.match_participants     ADD COLUMN IF NOT EXISTS payment_id uuid;
ALTER TABLE public.match_participants_dev ADD COLUMN IF NOT EXISTS payment_id uuid;

-- Backfill historical links so a re-confirm of an old payment stays idempotent.
UPDATE public.match_participants mp
  SET payment_id = p.id
  FROM public.payments p
  WHERE p.participant_id = mp.id AND mp.payment_id IS NULL AND p.env = 'prod';

UPDATE public.match_participants_dev mp
  SET payment_id = p.id
  FROM public.payments p
  WHERE p.participant_id = mp.id AND mp.payment_id IS NULL AND p.env = 'dev';

CREATE INDEX IF NOT EXISTS match_participants_payment_id_idx
  ON public.match_participants (payment_id) WHERE payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS match_participants_dev_payment_id_idx
  ON public.match_participants_dev (payment_id) WHERE payment_id IS NOT NULL;

-- ── 2. confirm_paid_slot: idempotency keyed on the payment ──────────────────
CREATE OR REPLACE FUNCTION public.confirm_paid_slot(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_pay   public.payments;
  v_max   int;
  v_join  int;
  v_count int;
  v_exist uuid;
  v_pid   uuid;
BEGIN
  SELECT * INTO v_pay FROM public.payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'payment_not_found');
  END IF;

  -- Lock the match row (env-aware): serialize every confirmation for this match.
  IF v_pay.env = 'dev' THEN
    SELECT max_players, COALESCE(joined_players, 0) INTO v_max, v_join
    FROM public.matches_dev WHERE id = v_pay.match_id FOR UPDATE;
  ELSE
    SELECT max_players, COALESCE(joined_players, 0) INTO v_max, v_join
    FROM public.matches WHERE id = v_pay.match_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'match_not_found');
  END IF;

  -- Idempotency under the lock, keyed on THIS payment (fixes the same-named-guest
  -- collision). Fresh read → sees a sibling confirm of the same payment that
  -- already committed, for guests AND registered users alike.
  IF v_pay.env = 'dev' THEN
    SELECT id INTO v_exist FROM public.match_participants_dev
      WHERE match_id = v_pay.match_id AND payment_id = v_pay.id LIMIT 1;
  ELSE
    SELECT id INTO v_exist FROM public.match_participants
      WHERE match_id = v_pay.match_id AND payment_id = v_pay.id LIMIT 1;
  END IF;
  IF v_exist IS NOT NULL THEN
    RETURN jsonb_build_object('outcome', 'confirmed', 'participant_id', v_exist);
  END IF;

  -- Secondary guard: a registered user already in the match via another path
  -- (e.g. joined free first). Guests have no such identity, so this is skipped.
  IF NOT v_pay.is_guest THEN
    IF v_pay.env = 'dev' THEN
      SELECT id INTO v_exist FROM public.match_participants_dev
        WHERE match_id = v_pay.match_id AND user_id = v_pay.user_id LIMIT 1;
    ELSE
      SELECT id INTO v_exist FROM public.match_participants
        WHERE match_id = v_pay.match_id AND user_id = v_pay.user_id LIMIT 1;
    END IF;
    IF v_exist IS NOT NULL THEN
      RETURN jsonb_build_object('outcome', 'confirmed', 'participant_id', v_exist);
    END IF;
  END IF;

  -- Capacity: real participants (env table) + manual external counter.
  IF v_pay.env = 'dev' THEN
    SELECT count(*) INTO v_count FROM public.match_participants_dev WHERE match_id = v_pay.match_id;
  ELSE
    SELECT count(*) INTO v_count FROM public.match_participants     WHERE match_id = v_pay.match_id;
  END IF;

  IF (v_count + v_join) >= v_max THEN
    -- Filled while this hold aged out → owe a refund. Queue it; never overbook.
    RETURN jsonb_build_object('outcome', 'queued_return');
  END IF;

  -- Room → create the participant, LINKED to this payment (created_by = paying host).
  BEGIN
    IF v_pay.env = 'dev' THEN
      INSERT INTO public.match_participants_dev (match_id, user_id, user_name, created_by, payment_id)
      VALUES (v_pay.match_id, CASE WHEN v_pay.is_guest THEN NULL ELSE v_pay.user_id END, v_pay.user_name, v_pay.user_id, v_pay.id)
      RETURNING id INTO v_pid;
    ELSE
      INSERT INTO public.match_participants (match_id, user_id, user_name, created_by, payment_id)
      VALUES (v_pay.match_id, CASE WHEN v_pay.is_guest THEN NULL ELSE v_pay.user_id END, v_pay.user_name, v_pay.user_id, v_pay.id)
      RETURNING id INTO v_pid;
    END IF;
  EXCEPTION WHEN unique_violation THEN
    -- A concurrent confirm for the same REGISTERED user won; reuse its row.
    IF v_pay.env = 'dev' THEN
      SELECT id INTO v_pid FROM public.match_participants_dev
        WHERE match_id = v_pay.match_id AND user_id = v_pay.user_id LIMIT 1;
    ELSE
      SELECT id INTO v_pid FROM public.match_participants
        WHERE match_id = v_pay.match_id AND user_id = v_pay.user_id LIMIT 1;
    END IF;
  END;

  RETURN jsonb_build_object('outcome', 'confirmed', 'participant_id', v_pid);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_paid_slot(uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_paid_slot(uuid) TO service_role;
