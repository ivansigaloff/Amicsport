-- Migration: drop_verify_policies_rpc
-- Date: 2026-06-01
--
-- Reverses the temporary 20260601000003_verify_policies_rpc.sql. get_match_policies
-- was scaffolding for one-off RLS verification; the verify-policies Edge Function
-- that called it has been removed. The RPC is service_role-only (unreachable now),
-- but drop it for hygiene.

DROP FUNCTION IF EXISTS public.get_match_policies();
