import { supabase } from '../supabase';
import { Match } from '../types';

/**
 * Sends a match-update email via the authenticated Edge Function. The EF
 * verifies the caller's JWT and looks up the match server-side, so neither
 * the recipient email nor the match details can be spoofed from the client.
 *
 * The legacy signature is preserved for call-site compatibility; only
 * matchId, type and playerName are sent — the rest is recomputed server-side.
 */
export const sendEmailNotification = async (
  _match: Match,
  type: 'join' | 'leave',
  playerName: string,
  _currentParticipants: number,
  matchId: string
) => {
  try {
    const { error } = await supabase.functions.invoke('send-match-notification', {
      body: { match_id: matchId, type, player_name: playerName },
    });
    if (error) console.warn('send-match-notification error:', error.message);
  } catch (e) {
    console.warn('Error sending email notification:', e);
  }
};
