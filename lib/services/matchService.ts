import { supabase } from '../supabase';

export const fetchMatchById = async (id: string, fromTable: (t: string) => string) => {
  const { data, error } = await supabase.from(fromTable('matches')).select('*').eq('id', id).single();
  if (error) throw error;
  return data;
};

export const updateMatchJoinedPlayers = async (id: string, newVal: number, fromTable: (t: string) => string) => {
  const { error } = await supabase.from(fromTable('matches')).update({ joined_players: newVal }).eq('id', id);
  if (error) throw error;
};

export const fetchLatestMatchJoinedPlayers = async (id: string, fromTable: (t: string) => string) => {
  const { data, error } = await supabase.from(fromTable('matches')).select('joined_players').eq('id', id).single();
  if (error) throw error;
  return data?.joined_players ?? 0;
};

export const deleteMatchTransaction = async (id: string, fromTable: (t: string) => string) => {
  await supabase.from(fromTable('match_participants')).delete().eq('match_id', id);
  const { error } = await supabase.from(fromTable('matches')).delete().eq('id', id);
  if (error) throw error;
};
