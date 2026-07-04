import { supabase } from '../supabase';
import { GPSTrack } from '../types';

/**
 * Fetches all saved GPS tracks for a specific match.
 */
export const fetchGPSPlayTracks = async (
  matchId: string,
  fromTable: (t: string) => string
): Promise<GPSTrack[]> => {
  const { data, error } = await supabase
    .from(fromTable('match_gps_tracks'))
    .select('*')
    .eq('match_id', matchId);
    
  if (error) throw error;
  return (data || []) as GPSTrack[];
};

/**
 * Saves (inserts or updates) a GPS track for a player in a match.
 * Uses upsert on the unique constraint (match_id, participant_id).
 */
export const saveGPSTrack = async (
  track: Omit<GPSTrack, 'id' | 'created_at' | 'updated_at'>,
  fromTable: (t: string) => string
): Promise<GPSTrack> => {
  const { data, error } = await supabase
    .from(fromTable('match_gps_tracks'))
    .upsert(track, { onConflict: 'match_id,participant_id' })
    .select()
    .single();
    
  if (error) throw error;
  return data as GPSTrack;
};

/**
 * Deletes a GPS track by its ID.
 */
export const deleteGPSTrack = async (
  trackId: string,
  fromTable: (t: string) => string
): Promise<void> => {
  const { error } = await supabase
    .from(fromTable('match_gps_tracks'))
    .delete()
    .eq('id', trackId);
    
  if (error) throw error;
};

/**
 * Deletes a GPS track for a player in a match.
 */
export const deleteGPSTrackByParticipant = async (
  matchId: string,
  participantId: string,
  fromTable: (t: string) => string
): Promise<void> => {
  const { error } = await supabase
    .from(fromTable('match_gps_tracks'))
    .delete()
    .eq('match_id', matchId)
    .eq('participant_id', participantId);
    
  if (error) throw error;
};
