import { supabase } from '../supabase';
import { Match } from '../types';

export const fetchMatchById = async (id: string, fromTable: (t: string) => string): Promise<Match> => {
  const { data, error } = await supabase.from(fromTable('matches')).select('*').eq('id', id).single();
  if (error) throw error;
  return data as Match;
};

// Atomically adjusts the manual "external players" counter (joined_players) by
// delta and returns the new value (clamped at 0). Replaces a read-modify-write
// that could lose updates under concurrent admin edits. Admin-only, enforced
// inside the RPC.
export const adjustJoinedPlayers = async (id: string, delta: number, env: string = 'prod'): Promise<number> => {
  const { data, error } = await supabase.rpc('adjust_joined_players', {
    p_match_id: id, p_delta: delta, p_env: env,
  });
  if (error) throw error;
  return (data as number) ?? 0;
};

export const deleteMatchTransaction = async (id: string, fromTable: (t: string) => string) => {
  await supabase.from(fromTable('match_participants')).delete().eq('match_id', id);
  const { error } = await supabase.from(fromTable('matches')).delete().eq('id', id);
  if (error) throw error;
};
