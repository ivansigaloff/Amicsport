import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchMatchById } from '../../lib/services/matchService';
import { fetchParticipants } from '../../lib/services/participantService';
import { computeIsAdmin } from '../../lib/auth';
import { parseMatchDate, formatLocalizedDate } from '../../lib/date';
import i18n from '../../lib/i18n';

export const useMatch = (id: string, env: string, fromTable: (t: string) => string) => {
  const [match, setMatch] = useState<any>(null);
  const [participantsList, setParticipantsList] = useState<any[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [myUserName, setMyUserName] = useState<string>('');
  const [joined, setJoined] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = async () => {
    setLoading(true);
    try {
      const matchData = await fetchMatchById(id, fromTable);
      setMatch(matchData);

      const partsData = await fetchParticipants(id, fromTable);
      setParticipantsList(partsData);

      const { data: authData } = await supabase.auth.getUser();
      if (authData?.user) {
        const uid = authData.user.id;
        setUserId(uid);
        
        const meta = authData.user.user_metadata || {};
        const nameToSave = meta.full_name || meta.name || authData.user.email?.split('@')[0] || 'Jugador App';
        setMyUserName(nameToSave);

        setJoined(partsData.some((p: any) => p.user_id === uid));

        setIsAdmin(computeIsAdmin(authData.user, env as 'prod' | 'dev'));
      }
    } catch (err) {
      console.log('Error fetching match data:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (id) fetchData();
  }, [id, env]);

  // Derived Logic
  const availableSpots = match ? match.max_players - (match.joined_players + participantsList.length) : 0;
  const isFull = availableSpots <= 0;

  const bcnDate = (() => {
    const now = new Date();
    try {
      const parts = new Intl.DateTimeFormat('en-US', { 
        timeZone: 'Europe/Madrid', 
        year: 'numeric', month: '2-digit', day: '2-digit', 
        hour: '2-digit', minute: '2-digit', second: '2-digit', 
        hour12: false 
      }).formatToParts(now);
      const getP = (type: string) => parts.find(p => p.type === type)?.value;
      const d = new Date(`${getP('year')}-${getP('month')}-${getP('day')}T${getP('hour')}:${getP('minute')}:${getP('second')}`);
      if (!isNaN(d.getTime())) return d;
    } catch {}
    return now;
  })();

  const getMatchTimes = () => {
    if (!match?.date || !match?.time) return null;
    const matchDateObj = parseMatchDate(match.date);
    if (!matchDateObj) return null;
    const [h, m] = match.time.split(':').map(Number);
    const matchStartTime = new Date(matchDateObj);
    matchStartTime.setHours(h, m, 0, 0);
    return matchStartTime;
  };

  const matchStartTime = getMatchTimes();
  
  const isStarted = matchStartTime ? bcnDate >= matchStartTime : false;
  const isOver = matchStartTime ? bcnDate >= new Date(matchStartTime.getTime() + 2 * 60 * 60 * 1000) : false;

  const cancellationDeadline = (() => {
    if (!matchStartTime) return null;
    const limitHours = match.cancellation_hours || 12;
    const deadline = new Date(matchStartTime.getTime() - (limitHours * 60 * 60 * 1000));
    
    const isPast = bcnDate > deadline;
    const formattedDeadline = formatLocalizedDate(deadline, i18n.language);
    const timeStr = deadline.toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' });
    
    return { date: formattedDeadline, time: timeStr, isPast, limitHours };
  })();

  const formattedDate = (() => {
    if (!match) return '';
    const d = parseMatchDate(match.date);
    const f = d ? formatLocalizedDate(d, i18n.language) : match.date;
    return f.charAt(0).toUpperCase() + f.slice(1);
  })();

  return {
    match, setMatch,
    participantsList, setParticipantsList,
    userId, myUserName,
    joined, setJoined,
    isAdmin, loading,
    fetchData,
    isFull, isStarted, isOver, cancellationDeadline, formattedDate, bcnDate
  };
};
