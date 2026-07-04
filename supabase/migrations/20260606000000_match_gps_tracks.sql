-- Migration: Create match_gps_tracks table for storing GPS trace data
CREATE TABLE IF NOT EXISTS public.match_gps_tracks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES public.match_participants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  player_name TEXT NOT NULL,
  points JSONB NOT NULL, -- Array of points [{lat, lng, speed, sats, date, time}]
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT unique_match_participant UNIQUE (match_id, participant_id)
);

-- Enable RLS
ALTER TABLE public.match_gps_tracks ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Allow read access to all authenticated users"
  ON public.match_gps_tracks FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Allow insert access to authenticated users"
  ON public.match_gps_tracks FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Allow update access to authenticated users"
  ON public.match_gps_tracks FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow delete access to authenticated users"
  ON public.match_gps_tracks FOR DELETE
  TO authenticated
  USING (true);
