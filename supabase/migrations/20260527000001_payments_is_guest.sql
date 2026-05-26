-- Migration: payments_is_guest
-- Date: 2026-05-27
--
-- Adds is_guest flag to payments so host-paid guest slots can be
-- distinguished from the payer's own slot when creating participants.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS is_guest boolean NOT NULL DEFAULT false;
