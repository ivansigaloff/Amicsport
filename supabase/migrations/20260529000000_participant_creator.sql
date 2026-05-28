-- Migration: participant_creator
-- Date: 2026-05-29
--
-- Prevents guest-row spam: previously any authenticated user could insert
-- (or delete) `match_participants` rows with `user_id IS NULL` against any
-- match. Now guest rows are tracked via `created_by` (auto-set from JWT in a
-- BEFORE INSERT trigger) and the INSERT/DELETE policies require the caller
-- to either be an admin, the row's own user, or a participant of that match
-- (for guest inserts) / the original creator of that guest row (for deletes).
--
-- Existing rows keep `created_by = NULL` (only affects NEW inserts/deletes).
-- Service-role inserts (Edge Functions) bypass RLS and leave created_by NULL
-- unless they explicitly set it; that is intentional.

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Column + trigger
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.match_participants     ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.match_participants_dev ADD COLUMN IF NOT EXISTS created_by uuid;

CREATE OR REPLACE FUNCTION public.set_participant_created_by()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    NEW.created_by = auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS match_participants_set_creator ON public.match_participants;
CREATE TRIGGER match_participants_set_creator
  BEFORE INSERT ON public.match_participants
  FOR EACH ROW EXECUTE FUNCTION public.set_participant_created_by();

DROP TRIGGER IF EXISTS match_participants_dev_set_creator ON public.match_participants_dev;
CREATE TRIGGER match_participants_dev_set_creator
  BEFORE INSERT ON public.match_participants_dev
  FOR EACH ROW EXECUTE FUNCTION public.set_participant_created_by();

-- ────────────────────────────────────────────────────────────────────────────
-- 2. Tighten prod INSERT/DELETE policies
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS participants_insert ON public.match_participants;
CREATE POLICY participants_insert ON public.match_participants
  FOR INSERT WITH CHECK (
    auth_is_admin()
    OR (auth.role() = 'authenticated' AND user_id = auth.uid())
    OR (
      auth.role() = 'authenticated' AND user_id IS NULL
      AND EXISTS (
        SELECT 1 FROM public.match_participants p
        WHERE p.match_id = match_participants.match_id
          AND p.user_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS participants_delete ON public.match_participants;
CREATE POLICY participants_delete ON public.match_participants
  FOR DELETE USING (
    auth_is_admin()
    OR user_id = auth.uid()
    OR (auth.role() = 'authenticated' AND user_id IS NULL AND created_by = auth.uid())
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 3. Mirror for dev tables (kept dormant per the single-environment cleanup)
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS participants_dev_insert ON public.match_participants_dev;
CREATE POLICY participants_dev_insert ON public.match_participants_dev
  FOR INSERT WITH CHECK (
    auth_is_dev() AND (
      auth_is_admin()
      OR user_id = auth.uid()
      OR (
        user_id IS NULL
        AND EXISTS (
          SELECT 1 FROM public.match_participants_dev p
          WHERE p.match_id = match_participants_dev.match_id
            AND p.user_id = auth.uid()
        )
      )
    )
  );

DROP POLICY IF EXISTS participants_dev_delete ON public.match_participants_dev;
CREATE POLICY participants_dev_delete ON public.match_participants_dev
  FOR DELETE USING (
    auth_is_dev() AND (
      auth_is_admin()
      OR user_id = auth.uid()
      OR (user_id IS NULL AND created_by = auth.uid())
    )
  );
