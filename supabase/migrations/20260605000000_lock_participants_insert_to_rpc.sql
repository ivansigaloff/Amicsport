-- Migration: lock match_participants direct INSERT to the join_match RPC
-- Date: 2026-06-05
--
-- V1 (security analysis 2026-06-05): the participants_insert RLS policy let any
-- validated authenticated user INSERT participant rows directly via PostgREST for
-- FREE matches — self-join (bypassing match_full) or UNLIMITED guest rows
-- (user_id IS NULL) — skipping join_match's capacity + waitlist enforcement
-- (overbooking / guest spam). Paid matches were already protected (the policy
-- blocked direct inserts when requires_payment), so there was no money impact;
-- this closes the free-match defence-in-depth gap.
--
-- Why this is safe (verified 2026-06-05): the client NEVER inserts
-- match_participants directly. Every join goes through join_match (and join_match_as
-- for WhatsApp), which are SECURITY DEFINER and enforce validation + payment +
-- capacity + waitlist under a row lock; being SECURITY DEFINER they BYPASS RLS, so
-- this policy never gated them. Removing the non-admin direct-insert branches
-- therefore breaks no flow. The admin branch is kept so admins may still insert
-- directly for manual ops / tooling (admins are a trusted role).
--
-- DEV tables are intentionally left untouched: the dev split is dormant and fully
-- gated to is_dev users, and join_match targets the PROD tables only, so the dev
-- sandbox still relies on its direct-insert policy. The V1 risk is a prod concern.

DROP POLICY IF EXISTS participants_insert ON public.match_participants;
CREATE POLICY participants_insert ON public.match_participants
  FOR INSERT WITH CHECK ( auth_is_admin() );

-- Verification (run after applying):
--   As a non-admin validated user, a direct
--     supabase.from('match_participants').insert({ match_id, user_id: <self> })
--   must now FAIL (RLS), while supabase.rpc('join_match', { ... }) still works.
