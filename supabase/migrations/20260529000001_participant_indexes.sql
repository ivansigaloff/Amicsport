-- Migration: participant_indexes
-- Date: 2026-05-29
--
-- Adds standalone indexes on match_participants.user_id and created_by.
-- The existing UNIQUE (match_id, user_id) cannot serve user_id-only filters
-- because composite indexes require a left-prefix match. created_by is the
-- new column added in the participant_creator migration; the participant
-- DELETE policy filters by it. Tables are tiny today so the impact is
-- minimal, but these indexes future-proof against growth.

CREATE INDEX IF NOT EXISTS match_participants_user_id_idx
  ON public.match_participants (user_id);

CREATE INDEX IF NOT EXISTS match_participants_created_by_idx
  ON public.match_participants (created_by);

CREATE INDEX IF NOT EXISTS match_participants_dev_user_id_idx
  ON public.match_participants_dev (user_id);

CREATE INDEX IF NOT EXISTS match_participants_dev_created_by_idx
  ON public.match_participants_dev (created_by);
