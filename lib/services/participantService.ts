import { supabase } from '../supabase';
import { Participant, AdminPlayer } from '../types';

export const fetchParticipants = async (matchId: string, fromTable: (t: string) => string): Promise<Participant[]> => {
  const { data, error } = await supabase.from(fromTable('match_participants')).select('*').eq('match_id', matchId);
  if (error) throw error;
  return (data || []) as Participant[];
};

export const fetchAdminDirectory = async (fromTable: (t: string) => string): Promise<AdminPlayer[]> => {
  const { data, error } = await supabase.from(fromTable('admin_players')).select('*').order('name', { ascending: true });
  if (error) throw error;
  return (data || []) as AdminPlayer[];
};

export const joinMatch = async (matchId: string, userId: string, userName: string, fromTable: (t: string) => string): Promise<Participant> => {
  const { data, error } = await supabase.from(fromTable('match_participants')).insert({
    match_id: matchId,
    user_id: userId,
    user_name: userName
  }).select().single();
  if (error) throw error;
  return data as Participant;
};

export const leaveMatch = async (matchId: string, userId: string, fromTable: (t: string) => string) => {
  const { error } = await supabase.from(fromTable('match_participants')).delete().eq('match_id', matchId).eq('user_id', userId);
  if (error) throw error;
};

export const addGuestParticipant = async (matchId: string, guestName: string, fromTable: (t: string) => string) => {
  const { data, error } = await supabase.from(fromTable('match_participants')).insert({
    match_id: matchId,
    user_name: guestName
  }).select().single();
  if (error) throw error;
  return data;
};

export const removeParticipantById = async (participantId: string, fromTable: (t: string) => string) => {
  const { error } = await supabase.from(fromTable('match_participants')).delete().eq('id', participantId);
  if (error) throw error;
};

export const removeParticipantByName = async (matchId: string, userName: string, fromTable: (t: string) => string) => {
  const { error } = await supabase.from(fromTable('match_participants')).delete().eq('match_id', matchId).eq('user_name', userName);
  if (error) throw error;
};
