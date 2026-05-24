import { Platform } from 'react-native';

export const sendEmailNotification = async (
  match: any, 
  type: 'join' | 'leave', 
  playerName: string, 
  currentParticipants: number, 
  matchId: string
) => {
  if (!match?.creator_email) return;
  
  const count = currentParticipants;
  const matchLink = `https://multigraf.info/Kickerzbcn/match/${matchId}`;

  try {
    const response = await fetch('https://multigraf.info/send_match_update.php', {
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
        playerCount: count,
        maxPlayers: match.max_players,
        matchLink
      })
    });
    const resData = await response.json();
    console.log('Notificación enviada:', resData);
    if (Platform.OS === 'web' && resData.status === 'ok') {
      console.log('Correo enviado correctamente al administrador.');
    }
  } catch (e) {
    console.log('Error sending email notification:', e);
  }
};
