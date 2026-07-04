-- Migration: Add real_start_time and real_end_time to matches
ALTER TABLE public.matches
ADD COLUMN IF NOT EXISTS real_start_time TEXT,
ADD COLUMN IF NOT EXISTS real_end_time TEXT;
