-- Migration: Add device_number column to match_participants table
ALTER TABLE public.match_participants
ADD COLUMN IF NOT EXISTS device_number INTEGER;
