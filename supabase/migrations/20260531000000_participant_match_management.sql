-- Migration: on-field match-management fields on participants
-- Date: 2026-05-31
--
-- Adds the columns the admin compact field view writes to:
--   checked_in  — player has arrived / been checked in (admin-driven for now).
--   shirt_color — team assignment, 'white' | 'black' | NULL (unassigned).
--   paid        — manual "has paid" flag, used only while payments are in test
--                 mode (in production the Monei/payments table is the source of
--                 truth and the UI hides this toggle).
--
-- Admin writes go through the existing RLS policy `participants_update_admin`
-- (FOR UPDATE USING/WITH CHECK auth_is_admin()) — no new policy needed.

ALTER TABLE public.match_participants
  ADD COLUMN IF NOT EXISTS checked_in  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS shirt_color text,
  ADD COLUMN IF NOT EXISTS paid        boolean NOT NULL DEFAULT false;

-- shirt_color is constrained to the two team colors (or NULL = unassigned).
DO $$ BEGIN
  ALTER TABLE public.match_participants
    ADD CONSTRAINT match_participants_shirt_color_chk
    CHECK (shirt_color IS NULL OR shirt_color IN ('white', 'black'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
