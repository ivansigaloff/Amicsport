-- Migration: verify_policies_rpc (temporary, for automated RLS policy verification)
-- Date: 2026-06-01
--
-- Creates a public RPC that returns the current RLS policies on match_participants
-- tables, so automated verification can check whether consolidate_rls_policies and
-- paid_join_guard are correctly applied. Can be dropped after verification.

CREATE OR REPLACE FUNCTION public.get_match_policies()
RETURNS TABLE(tablename text, policyname text, cmd text, qual text, with_check text)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT
    schemaname || '.' || tablename AS tablename,
    policyname, cmd, qual, with_check
  FROM pg_policies
  WHERE schemaname = 'public'
    AND tablename IN ('match_participants', 'match_participants_dev')
  ORDER BY tablename, cmd, policyname;
$$;

REVOKE ALL ON FUNCTION public.get_match_policies() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_match_policies() TO service_role;
