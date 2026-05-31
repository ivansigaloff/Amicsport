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

// Maps the RPC's raw exception text to a user-facing message.
const mapJoinError = (message: string): string => {
  if (message.includes('match_full'))     return 'El partido está completo.';
  if (message.includes('already_joined')) return 'Ya estás apuntado a este partido.';
  if (message.includes('not_a_participant')) return 'Debes estar apuntado para añadir invitados.';
  if (message.includes('match_not_found')) return 'El partido ya no existe.';
  return message;
};

// Joins via the atomic join_match RPC (locks the match row + enforces capacity
// server-side). fromTable is kept in the signature for call-site compatibility
// but is unused — the RPC always targets the production tables.
export const joinMatch = async (matchId: string, _userId: string, userName: string, _fromTable: (t: string) => string): Promise<Participant> => {
  const { data, error } = await supabase.rpc('join_match', {
    p_match_id: matchId,
    p_user_name: userName,
    p_is_guest: false,
  });
  if (error) throw new Error(mapJoinError(error.message));
  return data as Participant;
};

export const leaveMatch = async (matchId: string, userId: string, fromTable: (t: string) => string) => {
  const { error } = await supabase.from(fromTable('match_participants')).delete().eq('match_id', matchId).eq('user_id', userId);
  if (error) throw error;
};

export const addGuestParticipant = async (matchId: string, guestName: string, _fromTable: (t: string) => string) => {
  const { data, error } = await supabase.rpc('join_match', {
    p_match_id: matchId,
    p_user_name: guestName,
    p_is_guest: true,
  });
  if (error) throw new Error(mapJoinError(error.message));
  return data as Participant;
};

// Admin-only field-management update (check-in / shirt color / paid). Allowed by
// the existing `participants_update_admin` RLS policy.
export const updateParticipant = async (
  participantId: string,
  patch: Partial<Pick<Participant, 'checked_in' | 'shirt_color' | 'paid'>>,
  fromTable: (t: string) => string
): Promise<void> => {
  const { error } = await supabase.from(fromTable('match_participants')).update(patch).eq('id', participantId);
  if (error) throw error;
};

export const removeParticipantById = async (participantId: string, fromTable: (t: string) => string) => {
  const { error } = await supabase.from(fromTable('match_participants')).delete().eq('id', participantId);
  if (error) throw error;
};

export const removeParticipantByName = async (matchId: string, userName: string, fromTable: (t: string) => string) => {
  const { error } = await supabase.from(fromTable('match_participants')).delete().eq('match_id', matchId).eq('user_name', userName);
  if (error) throw error;
};
