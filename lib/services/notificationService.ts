import { Match } from '../types';
import { getMatchUrl } from '../share';

const NOTIFICATION_ENDPOINT = process.env.EXPO_PUBLIC_NOTIFICATION_URL;

export const sendEmailNotification = async (
  match: Match,
  type: 'join' | 'leave',
  playerName: string,
  currentParticipants: number,
  matchId: string
) => {
  if (!match?.creator_email || !NOTIFICATION_ENDPOINT) return;

  const matchLink = getMatchUrl(matchId);

  try {
    const response = await fetch(NOTIFICATION_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: match.creator_email,
        type,
        playerName,
        matchTitle: match.title || match.venue,
        matchVenue: match.venue,
        matchDate: match.date,
        matchTime: match.time,
        playerCount: currentParticipants,
        maxPlayers: match.max_players,
        matchLink
      })
    });
    const resData = await response.json();
    if (resData.status !== 'ok') {
      console.warn('Notification response:', resData);
    }
  } catch (e) {
    console.warn('Error sending email notification:', e);
  }
};
