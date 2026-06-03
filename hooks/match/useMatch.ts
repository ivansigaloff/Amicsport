import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { fetchMatchById } from '../../lib/services/matchService';
import { fetchParticipants } from '../../lib/services/participantService';
import { computeIsAdmin } from '../../lib/auth';
import { parseMatchDate, formatLocalizedDate, toISODate, barcelonaNow, getMatchTiming } from '../../lib/date';
import i18n from '../../lib/i18n';
import { Match, Participant, CancellationDeadline } from '../../lib/types';
import { getCachedMatch } from '../../lib/matchCache';

export const useMatch = (id: string, env: string, fromTable: (t: string) => string) => {
  const [match, setMatch] = useState<Match | null>(() => getCachedMatch(id));
  const [participantsList, setParticipantsList] = useState<Participant[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [myUserName, setMyUserName] = useState<string>('');
  const [joined, setJoined] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  // If the list already loaded this match, start NOT loading (seeded below) so the
  // detail paints instantly instead of showing a spinner for a fresh round-trip.
  const [loading, setLoading] = useState(() => !getCachedMatch(id));

  const fetchData = async () => {
    // Seed from the list cache for an instant paint, then revalidate silently.
    // (Also re-seeds when `id` changes, e.g. selecting another card on desktop.)
    const seed = getCachedMatch(id);
    if (seed) {
      setMatch(seed);
      setLoading(false);
    } else {
      setLoading(true);
    }
    try {
      // Run the three independent reads in parallel instead of sequentially.
      // getSession() reads from local storage — no network round-trip like getUser().
      const [matchData, partsData, { data: { session } }] = await Promise.all([
        fetchMatchById(id, fromTable),
        fetchParticipants(id, fromTable),
        supabase.auth.getSession(),
      ]);
      setMatch(matchData);
      setParticipantsList(partsData);

      const user = session?.user ?? null;
      if (user) {
        const uid = user.id;
        setUserId(uid);

        const meta = user.user_metadata || {};
        const nameToSave = meta.full_name || meta.name || user.email?.split('@')[0] || 'Jugador App';
        setMyUserName(nameToSave);

        setJoined(partsData.some((p) => p.user_id === uid));

        setIsAdmin(computeIsAdmin(user, env as 'prod' | 'dev'));
      }
    } catch (err) {
      console.log('Error fetching match data:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    if (id) fetchData();
  }, [id, env]);

  // Derived Logic — waitlisted participants do not occupy a slot, so capacity
  // counts only ACTIVE rows (waitlist !== true) + the manual external counter.
  const activeCount = participantsList.filter((p) => !p.waitlist).length;
  const waitlistCount = participantsList.length - activeCount;
  const availableSpots = match ? match.max_players - (match.joined_players + activeCount) : 0;
  const isFull = availableSpots <= 0;

  const bcnDate = barcelonaNow();

  const matchDateISO = match?.date ? toISODate(parseMatchDate(match.date)) : null;
  const { start: matchStartTime, isStarted, isOver } =
    matchDateISO && match?.time
      ? getMatchTiming(matchDateISO, match.time, bcnDate)
      : { start: null as Date | null, isStarted: false, isOver: false };

  const cancellationDeadline = ((): CancellationDeadline | null => {
    if (!matchStartTime || !match) return null;
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
    isFull, isStarted, isOver, cancellationDeadline, formattedDate, bcnDate,
    activeCount, waitlistCount
  };
};
