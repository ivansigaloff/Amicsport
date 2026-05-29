import { View, Text, StyleSheet, FlatList, SectionList, TouchableOpacity, ActivityIndicator, RefreshControl, Switch, Alert, useWindowDimensions, Platform, Share, Modal, ScrollView } from 'react-native';
import { Image } from 'expo-image';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState, useMemo, useRef, useCallback, memo, lazy, Suspense } from 'react';
import { supabase } from '../../lib/supabase';
import { computeIsAdmin } from '../../lib/auth';
import { useEnv } from '../../hooks/use-env';
import MatchDetails from '../../components/MatchDetails';
import { cacheMatchList } from '../../lib/matchCache';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import { shareMultipleMatches, copyMultipleMatchUrls } from '../../lib/share';
import { parseMatchDate, toISODate, getMatchTiming } from '../../lib/date';
import i18n from '../../lib/i18n';
import { COLORS, SHADOWS, FONTS, SIZES } from '../../constants/theme';

// Google Maps (heavy JS API + per-venue geocoding) was a top contributor to the
// list feeling slow to appear. Code-split it so its bundle loads OFF the initial
// critical path, and mount it only after the list has painted (desktop) or on
// demand (mobile) — see `mapDeferReady` / `isMapExpanded` below.
const MapView = lazy(() => import('../../components/MapView'));
const MapFallback = () => (
  <View style={{ flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F8FAFC', borderRadius: 24 }}>
    <ActivityIndicator size="large" color="#556080" />
  </View>
);

// In-memory cache of the matches list. Avoids refetching on every screen
// remount (Expo Router can unmount/remount tab screens) and on tab focus.
// Pull-to-refresh and post-mutation calls (duplicate / bulk delete) bypass it.
const MATCHES_CACHE_TTL_MS = 5 * 60 * 1000;
let matchesCache: {
  matches: any[];
  participations: Record<string, { venue: string; time: string }[]>;
  ts: number;
} | null = null;

LocaleConfig.locales['es'] = {
  monthNames: ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
  monthNamesShort: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
  dayNames: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
  dayNamesShort: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
  today: 'Hoy'
};
LocaleConfig.locales['en'] = {
  monthNames: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  monthNamesShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  dayNames: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  dayNamesShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  today: 'Today'
};
LocaleConfig.locales['ca'] = {
  monthNames: ['Gener', 'Febrer', 'Març', 'Abril', 'Maig', 'Juny', 'Juliol', 'Agost', 'Setembre', 'Octubre', 'Novembre', 'Desembre'],
  monthNamesShort: ['Gen', 'Feb', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Oct', 'Nov', 'Des'],
  dayNames: ['Diumenge', 'Dilluns', 'Dimarts', 'Dimecres', 'Dijous', 'Divendres', 'Dissabte'],
  dayNamesShort: ['Diu', 'Dil', 'Dmt', 'Dmc', 'Dij', 'Div', 'Dis'],
  today: 'Avui'
};
LocaleConfig.defaultLocale = 'es';

const parseDateString = (dateStr: string) => {
  return toISODate(parseMatchDate(dateStr));
};

const addDaysToDateString = (dateStr: string, daysToAdd: number = 7) => {
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const parts = dateStr.toLowerCase().replace('.', '').split(' ');
  if (parts.length >= 3) {
    const day = parseInt(parts[1], 10);
    const monthStr = parts[2];
    const monthIdx = months.findIndex(m => monthStr.includes(m));
    if (monthIdx !== -1 && !isNaN(day)) {
      const d = new Date();
      d.setMonth(monthIdx);
      d.setDate(day);
      if (d < new Date(new Date().setMonth(new Date().getMonth() - 2))) {
         d.setFullYear(d.getFullYear() + 1);
      }
      d.setDate(d.getDate() + daysToAdd);
      return d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' });
    }
  }
  return dateStr;
};

const AVAIL_COLORS = { GREEN: '#10B981', YELLOW: '#F59E0B', RED: '#EF4444', INDIGO: '#FFB81C' };

/** Best availability color for a set of matches: green (>25% free) > yellow (>0) > red (full). */
const getAvailabilityColor = (mList: any[]) => {
  let bestPriority = 0;
  let bestColor = AVAIL_COLORS.INDIGO;
  mList.forEach(m => {
    const freeSlots = m.max_players - m.computed_joined;
    const freePct = (freeSlots / m.max_players) * 100;
    let color = AVAIL_COLORS.RED;
    let priority = 1;
    if (freePct > 25) { color = AVAIL_COLORS.GREEN; priority = 3; }
    else if (freePct > 0) { color = AVAIL_COLORS.YELLOW; priority = 2; }
    if (priority > bestPriority) { bestPriority = priority; bestColor = color; }
  });
  return bestColor;
};

const MatchCard = memo(({ item, fetchMatches, onSelectMatch, isDesktop, isSelected, isAdmin, isShareMode, isShareSelected, onToggleShareSelect }: { item: any, fetchMatches: any, onSelectMatch: (id: string) => void, isDesktop: boolean, isSelected: boolean, isAdmin: boolean, isShareMode: boolean, isShareSelected: boolean, onToggleShareSelect: (id: string) => void }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { fromTable, env } = useEnv();
  const [add7Days, setAdd7Days] = useState(true);
  const [duplicating, setDuplicating] = useState(false);
  
  const freeSlots = item.max_players - item.computed_joined;
  const freePct = (freeSlots / item.max_players) * 100;
  const isFull = freeSlots <= 0;

  const getStatusConfig = () => {
    if (isFull) return { text: t('common.full'), color: '#EF4444', bg: '#FEE2E2' };
    if (freePct <= 25) return { text: t('common.open'), color: '#F59E0B', bg: '#FEF3C7' };
    return { text: t('common.open'), color: '#10B981', bg: '#DCFCE7' };
  };

  const status = getStatusConfig();

  const handleDuplicate = async () => {
    setDuplicating(true);
    let newDate = item.date;
    if (add7Days) {
      newDate = addDaysToDateString(item.date, 7);
    }
    
    // image_url is not loaded in the list query (kept lean); fetch it on demand.
    const { data: src } = await supabase.from(fromTable('matches')).select('image_url').eq('id', item.id).single();
    const { error } = await supabase.from(fromTable('matches')).insert({
      title: item.title,
      venue: item.venue,
      location_url: item.location_url,
      date: newDate,
      match_date: toISODate(parseMatchDate(newDate)),
      time: item.time,
      price: item.price,
      max_players: item.max_players,
      joined_players: 0,
      level: item.level,
      image_url: src?.image_url ?? null,
      distance: item.distance,
      is_female: item.is_female,
      is_mixed: item.is_mixed,
      is_private: item.is_private,
      is_advanced: item.is_advanced,
      creator_email: (await supabase.auth.getUser()).data.user?.email || ''
    });

    if (!error) {
       Alert.alert(t('common.success'), `${t('matches.duplicate_success')} ${newDate}`);
       fetchMatches();
    } else {
       console.error('Error duplicating match:', error);
       Alert.alert(t('common.error'), `${t('matches.duplicate_error')}: ${error.message || 'Error desconocido'}`);
    }
    setDuplicating(false);
  };

  const { isStarted, isOver } = useMemo(
    () => getMatchTiming(item.dateISO, item.time),
    [item.dateISO, item.time]
  );

  return (
    <View style={[styles.card, isSelected && isDesktop && styles.cardSelected, isShareSelected && styles.cardShareSelected]}>
      <TouchableOpacity 
        activeOpacity={0.7}
        onPress={() => {
          if (isShareMode) {
            onToggleShareSelect(item.id);
          } else if (isDesktop) {
            onSelectMatch(item.id);
          } else {
            const prefix = env === 'dev' ? '/dev' : '';
            router.push(`${prefix}/match/${item.id}` as any);
          }
        }}
        onLongPress={() => {
          if (!isShareMode) {
            onToggleShareSelect(item.id);
          }
        }}
        style={styles.cardInternal}
      >
        <View style={styles.cardHeaderRow}>
          <Text style={styles.cardTitleLine} numberOfLines={1}>
            {item.title ? item.title : item.venue}
          </Text>
          <View style={[
            styles.slotsBadgeMinimal, 
            isStarted && !isOver && { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' },
            isOver && { backgroundColor: '#F1F5F9', borderColor: '#E2E8F0' }
          ]}>
            <Text style={[
              styles.slotsBadgeTextMinimal, 
              isStarted && !isOver && { color: '#B45309' },
              isOver && { color: '#64748B' }
            ]}>
              {isOver 
                ? (t('matches.finished') || 'Finalizado') 
                : (isStarted ? (t('matches.in_progress') || 'En curso') : `${item.computed_joined}/${item.max_players}`)
              }
            </Text>
          </View>
        </View>

        <View style={styles.cardStatusRow}>
          {item.distance && item.distance !== 'Apto' && (
            <View style={[styles.statusTagMinimal, {backgroundColor: '#F1F5F9', borderColor: '#E2E8F0'}]}>
              <Text style={[styles.statusTagTextMinimal, {color: '#64748B'}]}>{item.distance.toUpperCase()}</Text>
            </View>
          )}
          {item.is_private && (
            <View style={[styles.statusTagMinimal, {backgroundColor: '#F1F5F9', borderColor: '#E2E8F0'}]}>
              <Text style={styles.statusTagTextMinimal}>{t('common.private').toUpperCase()}</Text>
            </View>
          )}
          {item.is_female && (
            <View style={[styles.statusTagMinimal, {backgroundColor: '#F1F5F9', borderColor: '#E2E8F0'}]}>
              <Text style={[styles.statusTagTextMinimal, {color: '#64748B'}]}>{t('common.female').toUpperCase()}</Text>
            </View>
          )}
          {item.is_mixed && (
            <View style={[styles.statusTagMinimal, {backgroundColor: '#F1F5F9', borderColor: '#E2E8F0'}]}>
              <Text style={[styles.statusTagTextMinimal, {color: '#64748B'}]}>{t('common.mixed').toUpperCase()}</Text>
            </View>
          )}
          {item.is_advanced && (
            <View style={[styles.statusTagMinimal, {backgroundColor: '#F1F5F9', borderColor: '#E2E8F0'}]}>
              <Text style={[styles.statusTagTextMinimal, {color: '#64748B'}]}>{t('common.advanced').toUpperCase()}</Text>
            </View>
          )}
        </View>

        <View style={styles.cardDivider} />

        <View style={styles.cardFooterRowMinimal}>
          <View style={styles.timeContainerMinimal}>
            <Ionicons name="time-outline" size={18} color="#0F172A" />
            <Text style={styles.timeTextMinimal}>{item.time}</Text>
          </View>
          <Text style={styles.priceTextMinimal}>{Number(item.price).toFixed(2)}€</Text>
        </View>
      </TouchableOpacity>
      
      {isAdmin && !isShareMode && (
        <View style={styles.duplicateContainer}>
          <View style={styles.duplicateSwitchRow}>
            <Text style={styles.duplicateLabel}>{t('matches.duplicate_week')}</Text>
            <Switch 
              value={add7Days} 
              onValueChange={setAdd7Days} 
              trackColor={{ false: '#E2E8F0', true: '#94A3B8' }} 
              thumbColor={'#FFF'} 
            />
          </View>
          <TouchableOpacity 
            style={[styles.duplicateButton, duplicating && { opacity: 0.5 }]} 
            onPress={handleDuplicate}
            disabled={duplicating}
          >
            {duplicating ? <ActivityIndicator color="#FFF" /> : (
              <>
                <Ionicons name="copy-outline" size={16} color="#FFF" />
                <Text style={styles.duplicateButtonText}>{t('matches.duplicate_btn')}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
});

export default function MatchesScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [selectedDateFilter, setSelectedDateFilter] = useState<string | null>(null);
  const [selectedVenueFilter, setSelectedVenueFilter] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const { width } = useWindowDimensions();
  
  // Share mode state
  const [shareSelectedIds, setShareSelectedIds] = useState<Set<string>>(new Set());
  const isShareMode = shareSelectedIds.size > 0;

  // Expansion states
  const [isCalendarExpanded, setIsCalendarExpanded] = useState(false);
  // Mobile: map starts COLLAPSED so the list paints immediately. Mounting Google
  // Maps was a top cause of the list feeling slow; users open it via the toggle.
  const [isMapExpanded, setIsMapExpanded] = useState(false);
  // Desktop shows the map panel permanently; defer its mount until the list has
  // painted (see effect below) for the same reason.
  const [mapDeferReady, setMapDeferReady] = useState(false);

  // Advanced Filters
  const [isFilterModalVisible, setIsFilterModalVisible] = useState(false);
  const [filterFemale, setFilterFemale] = useState(false);
  const [filterMixed, setFilterMixed] = useState(false);
  const [filterPrivate, setFilterPrivate] = useState(false);
  const [filterAdvanced, setFilterAdvanced] = useState(false);
  const [filterMorning, setFilterMorning] = useState(false);
  const [filterEvening, setFilterEvening] = useState(false);
  const [showPastMatches, setShowPastMatches] = useState(false);
  // Mirror of showPastMatches readable inside the stable fetchMatches callback
  // (kept in a ref so fetchMatches identity stays stable for memoized children).
  const showPastRef = useRef(false);
  const [isLangModalVisible, setIsLangModalVisible] = useState(false);

  // Participation Indicator States
  const [userParticipationMap, setUserParticipationMap] = useState<Record<string, { venue: string, time: string }[]>>({});
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const horizontalScrollXRef = useRef(0);

  const changeLanguage = async (lng: string) => {
    await i18n.changeLanguage(lng);
    await AsyncStorage.setItem('@app_language', lng);
    LocaleConfig.defaultLocale = lng;
    setIsLangModalVisible(false);
  };

  useEffect(() => {
    // Al cargar, sincronizar LocaleConfig con el idioma actual de i18n
    if (i18n.language) {
      LocaleConfig.defaultLocale = i18n.language;
    }
  }, [i18n.language]);

  const dayList = useMemo(() => {
    const days = [];
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() + i);
      days.push({
        dateString: d.toISOString().split('T')[0],
        dayNum: d.getDate().toString(),
        isToday: i === 0,
        label: d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })
      });
    }
    return days;
  }, []);

  const horizontalListRef = useRef<FlatList>(null);
  const sectionListRef = useRef<SectionList>(null);
  const isSyncingFromClick = useRef(false);

  // Web Drag Scroll Logic
  const [isScrolling, setIsScrolling] = useState(false);
  const [dragStartX, setDragStartX] = useState(0);
  const [dragScrollLeft, setDragScrollLeft] = useState(0);

  const onMouseDown = (e: any) => {
    if (Platform.OS !== 'web') return;
    const node = (horizontalListRef.current as any)?.getScrollableNode();
    if (!node) return;
    setIsScrolling(true);
    setDragStartX(e.pageX);
    setDragScrollLeft(node.scrollLeft);
  };

  const onMouseUp = () => setIsScrolling(false);
  const onMouseLeave = () => setIsScrolling(false);

  const onMouseMove = (e: any) => {
    if (!isScrolling || Platform.OS !== 'web') return;
    const node = (horizontalListRef.current as any)?.getScrollableNode();
    if (!node) return;
    e.preventDefault();
    const x = e.pageX;
    const walk = (x - dragStartX) * 1.5;
    node.scrollLeft = dragScrollLeft - walk;
  };

  const toggleShareSelect = useCallback((id: string) => {
    setShareSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const cancelShareMode = () => setShareSelectedIds(new Set());

  const handleShareSelected = async () => {
    const selected = matches.filter(m => shareSelectedIds.has(m.id.toString()) || shareSelectedIds.has(m.id));
    if (selected.length === 0) return;
    await shareMultipleMatches(selected);
  };

  const handleCopySelected = async () => {
    const selected = matches.filter(m => shareSelectedIds.has(m.id.toString()) || shareSelectedIds.has(m.id));
    if (selected.length === 0) return;
    const ok = await copyMultipleMatchUrls(selected);
    if (Platform.OS === 'web') window.alert(ok ? t('matches.links_copied') : t('matches.copy_error'));
    else Alert.alert(ok ? `✅ ${t('matches.links_copied_count')}` : t('common.error'), ok ? `${selected.length} ${t('matches.links_copied_count')}` : t('matches.copy_error'));
  };

  const handleBulkDelete = async () => {
    const selected = matches.filter(m => shareSelectedIds.has(m.id.toString()) || shareSelectedIds.has(m.id));
    if (selected.length === 0) return;
    const confirmMsg = t('matches.delete_matches_msg', { count: selected.length });
    if (Platform.OS === 'web') {
      if (!window.confirm(confirmMsg)) return;
    } else {
      const confirmed = await new Promise<boolean>(resolve => {
        Alert.alert(t('matches.delete_matches_title'), confirmMsg, [
          { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(false) },
          { text: t('common.delete'), style: 'destructive', onPress: () => resolve(true) }
        ]);
      });
      if (!confirmed) return;
    }
    for (const m of selected) {
      await supabase.from(fromTable('match_participants')).delete().eq('match_id', m.id);
      await supabase.from(fromTable('matches')).delete().eq('id', m.id);
    }
    cancelShareMode();
    fetchMatches();
    if (Platform.OS === 'web') window.alert(`${selected.length} ${t('matches.matches_deleted')}`);
    else Alert.alert(t('common.delete'), `${selected.length} ${t('matches.matches_deleted')}`);
  };
  
  const { fromTable, env } = useEnv();
  
  const isDesktop = Platform.OS === 'web' && width > 1024; // Increased threshold for 3 columns
  const isSmallScreen = width < 500;

  const isMatchOver = (dateISO: string, timeStr: string) => getMatchTiming(dateISO, timeStr).isOver;

  const fetchMatches = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    // getSession() reads from local storage — no extra network round-trip.
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    const userName = user?.user_metadata?.full_name || user?.email || '';
    // user_metadata.full_name is user-controlled. Strip characters that have
    // special meaning in PostgREST .or() filters (separators + ilike wildcard)
    // so an attacker cannot inject extra filter clauses.
    const safeUserName = userName.replace(/[,.()%]/g, ' ').trim();

    // Fire matches + user-participations in parallel (was sequential: matches → auth → parts).
    // Only select columns used in the list; omit location_url, creator_email,
    // cancellation_hours, payment_deadline_hours (not needed here).
    const matchCols = 'id, title, venue, location_url, date, match_date, time, price, max_players, joined_players, level, distance, created_at, is_female, is_mixed, is_private, is_advanced, requires_payment';

    // Server-side window: by default only UPCOMING matches, ordered + capped, so the
    // payload stays bounded as history grows (was: fetch the entire table every load).
    // The admin "show past" toggle keeps the legacy fetch (rare, capped at 500).
    const includePast = showPastRef.current;
    let matchesQuery = supabase
      .from(fromTable('matches'))
      .select(`${matchCols}, ${fromTable('match_participants')}(count)`);
    if (includePast) {
      matchesQuery = matchesQuery.order('created_at', { ascending: false }).limit(500);
    } else {
      const today = new Date().toISOString().split('T')[0];
      matchesQuery = matchesQuery
        .gte('match_date', today)
        .order('match_date', { ascending: true })
        .order('time', { ascending: true })
        .limit(200);
    }
    const matchesPromise = matchesQuery;

    const partsPromise = user
      ? supabase
          .from(fromTable('match_participants'))
          .select(`match_id, user_id, user_name, ${fromTable('matches')}(id, date, match_date, venue, time)`)
          .or(`user_id.eq.${user.id},user_name.ilike.${safeUserName} (invitado%`)
      : Promise.resolve({ data: null });

    const [{ data }, { data: pData }] = await Promise.all([matchesPromise, partsPromise]);

    if (data) {
      const partTable = fromTable('match_participants');

      // Build participation maps from the parallel query result.
      const pMap: Record<string, { venue: string; time: string }[]> = {};
      const statusMap: Record<string, { isJoined: boolean; guestCount: number }> = {};
      if (pData && user) {
        for (const pEntry of pData as any[]) {
          const m = pEntry[fromTable('matches')];
          if (m?.match_date || m?.date) {
            const iso = m.match_date || parseDateString(m.date);
            if (iso) {
              if (!pMap[iso]) pMap[iso] = [];
              if (!pMap[iso].find(x => x.venue === m.venue && x.time === m.time))
                pMap[iso].push({ venue: m.venue, time: m.time });
            }
          }
          const mid = pEntry.match_id;
          if (!statusMap[mid]) statusMap[mid] = { isJoined: false, guestCount: 0 };
          if (pEntry.user_id === user.id) {
            statusMap[mid].isJoined = true;
          } else if (pEntry.user_name?.toLowerCase().includes(`${userName.toLowerCase()} (invitado`)) {
            statusMap[mid].guestCount += 1;
          }
        }
      }

      const processed = (data as any[])
        .filter(m => m?.id)
        .map(m => {
          const realCount = Array.isArray(m[partTable]) ? (m[partTable][0]?.count || 0) : 0;
          return {
            ...m,
            dateISO: m.match_date || parseDateString(m.date),
            computed_joined: (m.joined_players || 0) + realCount,
            userStatus: statusMap[m.id] || { isJoined: false, guestCount: 0 },
          };
        });

      processed.sort((a, b) => {
        if (!a.dateISO) return 1;
        if (!b.dateISO) return -1;
        if (a.dateISO !== b.dateISO) return a.dateISO.localeCompare(b.dateISO);
        return (a.time || '').localeCompare(b.time || '');
      });

      // Single setState — one render instead of two.
      setUserParticipationMap(pMap);
      setMatches(processed);
      cacheMatchList(processed); // seed the detail-screen cache for instant open
      // Only cache the default upcoming view; the past view is a transient admin query.
      if (!includePast) matchesCache = { matches: processed, participations: pMap, ts: Date.now() };
    }

    setLoading(false);
    setRefreshing(false);
  }, [fromTable]);

  useEffect(() => {
    // Use cached data if it is still fresh; otherwise fetch.
    if (matchesCache && Date.now() - matchesCache.ts < MATCHES_CACHE_TTL_MS) {
      setMatches(matchesCache.matches);
      cacheMatchList(matchesCache.matches);
      setUserParticipationMap(matchesCache.participations);
      setLoading(false);
    } else {
      fetchMatches();
    }
    // Set initial filter to today as requested
    setSelectedDateFilter(todayISO);
  }, []);

  // Defer mounting the desktop map until the browser is idle, so Google Maps'
  // heavy JS load runs AFTER the list has painted (not during first render).
  useEffect(() => {
    const w = typeof window !== 'undefined' ? (window as any) : null;
    if (w?.requestIdleCallback) {
      const id = w.requestIdleCallback(() => setMapDeferReady(true), { timeout: 1500 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = setTimeout(() => setMapDeferReady(true), 200);
    return () => clearTimeout(id);
  }, []);

  // Admin "show past" changes the server-side query window, so refetch when it
  // toggles. Skips the initial mount (handled by the effect above).
  const didTogglePastRef = useRef(false);
  useEffect(() => {
    showPastRef.current = showPastMatches;
    if (!didTogglePastRef.current) { didTogglePastRef.current = true; return; }
    fetchMatches();
  }, [showPastMatches, fetchMatches]);

  useEffect(() => {
    checkRole();
  }, [env]);

  const checkRole = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setIsAdmin(session?.user ? computeIsAdmin(session.user) : false);
  };

  const todayISO = new Date().toISOString().split('T')[0];
  // 1. Map upcoming matches to their date (memoized — only recomputed when matches change).
  const matchesByDateMap = useMemo(() => {
    const map: Record<string, any[]> = {};
    matches.forEach(m => {
      if (m.dateISO && m.dateISO >= todayISO) {
        if (!map[m.dateISO]) map[m.dateISO] = [];
        map[m.dateISO].push(m);
      }
    });
    return map;
  }, [matches, todayISO]);

  // 2. Calendar markings (memoized — depends on the date map + current selection).
  const markedDates = useMemo(() => {
    const marks: any = {};
    Object.keys(matchesByDateMap).forEach(dISO => {
      const dayMatches = matchesByDateMap[dISO];
      const isSelectedDay = selectedDateFilter === dISO;

      if (!selectedVenueFilter) {
        // GLOBAL MODE: Availability dot for all days
        marks[dISO] = {
          marked: true,
          dotColor: getAvailabilityColor(dayMatches),
          activeOpacity: 0.8,
          selected: isSelectedDay,
          selectedColor: AVAIL_COLORS.INDIGO
        };
      } else {
        // VENUE MODE: Ring for target venue, Indigo dot for others
        const normalizedSelected = selectedVenueFilter.trim().toLowerCase();
        const venueMatches = dayMatches.filter(m => m.venue.trim().toLowerCase() === normalizedSelected);

        if (venueMatches.length > 0) {
          // ENHANCED UI: Solid Circle for target venue
          const availabilityColor = getAvailabilityColor(venueMatches);
          marks[dISO] = {
            customStyles: {
              container: {
                backgroundColor: availabilityColor, // Solid circle
                borderRadius: 20,
                justifyContent: 'center',
                alignItems: 'center',
                borderWidth: isSelectedDay ? 2 : 0,
                borderColor: AVAIL_COLORS.INDIGO
              },
              text: {
                color: '#0F172A', // Keep original dark color
                fontWeight: '700'
              }
            }
          };
        } else {
          // Standard Indigo Dot for other venues
          marks[dISO] = {
            marked: true,
            dotColor: AVAIL_COLORS.INDIGO,
            activeOpacity: 0.8,
            selected: isSelectedDay,
            selectedColor: AVAIL_COLORS.INDIGO
          };
        }
      }
    });
    return marks;
  }, [matchesByDateMap, selectedDateFilter, selectedVenueFilter]);

  const handleSelectVenue = (venue: string | null) => {
    setSelectedVenueFilter(venue);
    if (venue) {
      setSelectedDateFilter(null);
      setSelectedMatchId(null);
    }
  };

  const clearAllFilters = () => {
    setSelectedVenueFilter(null);
    setSelectedMatchId(null);
    setShowPastMatches(false);
  };

  const filteredMatches = useMemo(() => matches.filter(m => {
    // 0. Past Matches Filter (Admins only)
    if (!showPastMatches && isMatchOver(m.dateISO, m.time)) return false;

    // 1. Venue Filter
    if (selectedVenueFilter && m.venue.trim().toLowerCase() !== selectedVenueFilter.trim().toLowerCase()) return false;

    // 2. Inclusive Category Filter (Female / Mixed)
    if (filterFemale || filterMixed) {
      const matchFemale = filterFemale && m.is_female;
      const matchMixed = filterMixed && m.is_mixed;
      if (!matchFemale && !matchMixed) return false;
    }

    // 3. Exclusive Category Filter (Private / Advanced)
    if (filterPrivate && !m.is_private) return false;
    if (filterAdvanced && !m.is_advanced) return false;

    // 4. Time Slot Filter
    if (m.time) {
      const hour = parseInt(m.time.split(':')[0], 10);
      if (filterMorning && filterEvening) {
        // Both selected: show all (no-op)
      } else if (filterMorning && hour >= 18) return false;
      else if (filterEvening && hour < 18) return false;
    }

    return true;
  }), [matches, showPastMatches, selectedVenueFilter, filterFemale, filterMixed, filterPrivate, filterAdvanced, filterMorning, filterEvening]);

  // Group matches into sections for SectionList
  const sections = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    filteredMatches.forEach(m => {
      if (m.dateISO) {
        if (!grouped[m.dateISO]) grouped[m.dateISO] = [];
        grouped[m.dateISO].push(m);
      }
    });
    
    return Object.keys(grouped).sort().map(dISO => {
      const isToday = dISO === new Date().toISOString().split('T')[0];
      const dObj = new Date(dISO + 'T00:00:00');
      const title = isToday ? t('common.today') : dObj.toLocaleDateString(i18n.language === 'en' ? 'en-US' : (i18n.language === 'ca' ? 'ca-ES' : 'es-ES'), { weekday: 'long', day: 'numeric', month: 'long' });
      return {
        title,
        dateISO: dISO,
        data: grouped[dISO]
      };
    });
  }, [filteredMatches, i18n.language]);

  // Sync scroll -> Date strip
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    if (isSyncingFromClick.current) return;
    
    if (viewableItems.length > 0) {
      const firstItem = viewableItems[0];
      if (firstItem.section) {
        const sectionDate = firstItem.section.dateISO;
        if (sectionDate && sectionDate !== selectedDateFilter) {
          setSelectedDateFilter(sectionDate);
        }
      }
    }
  }).current;

  const viewabilityConfig = useRef({
    itemVisiblePercentThreshold: 50
  }).current;

  const handleDateSelect = (dateISO: string) => {
    isSyncingFromClick.current = true;
    setSelectedDateFilter(dateISO);
    setSelectedVenueFilter(null);
    
    const sIndex = sections.findIndex(s => s.dateISO === dateISO);
    if (sIndex !== -1) {
      sectionListRef.current?.scrollToLocation({
        sectionIndex: sIndex,
        itemIndex: 0,
        animated: true,
        viewOffset: 0
      });
    }
    
    // Release sync lock after animation
    setTimeout(() => {
      isSyncingFromClick.current = false;
    }, 1000);
  };

  // Auto-scroll horizontal date strip when selection changes (from scroll or click)
  useEffect(() => {
    if (!isCalendarExpanded && selectedDateFilter) {
      const index = dayList.findIndex(d => d.dateString === selectedDateFilter);
      if (index !== -1) {
        setTimeout(() => {
          horizontalListRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
        }, 100);
      }
    }
  }, [selectedDateFilter, isCalendarExpanded]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={isDesktop ? styles.desktopContainer : styles.container}>
        <View style={isDesktop ? styles.desktopListPanel : { flex: 1 }}>
          {/* Main Title - Non-sticky */}
          <View style={styles.header}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <Text style={styles.title}>
                {env === 'dev' ? t('matches.title_dev') : t('matches.title')}
              </Text>
              <TouchableOpacity 
                onPress={() => setIsLangModalVisible(true)} 
                style={styles.langSelectorBtn}
              >
                <Text style={styles.langSelectorText}>{i18n.language.toUpperCase()}</Text>
                <Ionicons name="chevron-down" size={14} color="#0F172A" />
              </TouchableOpacity>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <TouchableOpacity onPress={() => setIsFilterModalVisible(true)}>
                <Ionicons name="options-outline" size={24} color={ (filterFemale || filterMixed || filterPrivate || filterAdvanced || filterMorning || filterEvening) ? '#10B981' : '#0F172A' } />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => fetchMatches(true)}>
                <Ionicons name="refresh-outline" size={24} color="#0F172A" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Sticky Horizontal Date Scroll */}
          {!isCalendarExpanded && (
            <View 
              style={styles.stickyDateContainer}
              // @ts-ignore - Web only handlers
              onMouseDown={onMouseDown}
              onMouseUp={onMouseUp}
              onMouseLeave={onMouseLeave}
              onMouseMove={onMouseMove}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', paddingRight: 10 }}>
                <FlatList
                  ref={horizontalListRef}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  data={dayList}
                  keyExtractor={item => item.dateString}
                  contentContainerStyle={styles.horizontalScrollContent}
                  scrollEnabled={Platform.OS !== 'web' || !isScrolling}
                  onScroll={(e) => { horizontalScrollXRef.current = e.nativeEvent.contentOffset.x; }}
                  scrollEventThrottle={16}
                  renderItem={({ item }) => {
                    const isSelected = selectedDateFilter === item.dateString;
                    const dayMatches = matchesByDateMap[item.dateString] || [];
                    const hasMatches = dayMatches.length > 0;
                    const availabilityColor = hasMatches ? getAvailabilityColor(dayMatches) : null;
                    const participations = userParticipationMap[item.dateString];

                    return (
                      <View style={{ position: 'relative', zIndex: 1, paddingVertical: 10 }}>
                        <TouchableOpacity 
                          style={[styles.dayBubble, isSelected && styles.dayBubbleSelected]}
                          onPress={() => handleDateSelect(item.dateString)}
                          // @ts-ignore
                          onMouseEnter={() => setHoveredDate(item.dateString)}
                          // @ts-ignore
                          onMouseLeave={() => setHoveredDate(null)}
                        >
                          <Text style={[styles.dayText, isSelected && styles.dayTextSelected]}>
                            {item.isToday ? t('common.today') : item.dayNum}
                          </Text>
                          {availabilityColor && (
                            <View style={[styles.availabilityDot, { backgroundColor: isSelected ? '#FFFFFF' : availabilityColor }]} />
                          )}

                          {participations && (
                            <View style={styles.joinedIndicator}>
                              <Ionicons name="football" size={16} color="#0F172A" />
                            </View>
                          )}
                        </TouchableOpacity>
                      </View>
                    );
                  }}
                />
                
                <TouchableOpacity onPress={() => setIsCalendarExpanded(true)} style={styles.expandInScroll}>
                   <Ionicons name="add-circle-outline" size={24} color="#0F172A" />
                </TouchableOpacity>

                {/* Floating Tooltip outside FlatList clipping context */}
                {hoveredDate && (
                  (() => {
                    const idx = dayList.findIndex(d => d.dateString === hoveredDate);
                    const participations = userParticipationMap[hoveredDate];
                    if (idx !== -1 && participations) {
                      const leftPos = (idx * 55) + 10 - horizontalScrollXRef.current;
                      // Don't show if scrolled out of view on the left
                      if (leftPos < -100 || leftPos > width - 40) return null;
                      
                      return (
                        <View style={[styles.tooltipContainer, { left: leftPos, bottom: 85, pointerEvents: 'none', zIndex: 20000, padding: 12 }]}>
                          <Text style={styles.tooltipTitle}>{t('matches.your_matches')}</Text>
                          {participations.map((p, idx) => (
                            <Text key={idx} style={styles.tooltipText}>• {p.venue} @ {p.time}</Text>
                          ))}
                          <View style={styles.tooltipArrow} />
                        </View>
                      );
                    }
                    return null;
                  })()
                )}
              </View>
            </View>
          )}

          {/* Full Calendar Overlay (when expanded) */}
          {isCalendarExpanded && (
            <View style={styles.calendarWrapper}>
              <View style={styles.sectionHeaderCompact}>
                <TouchableOpacity onPress={() => setIsCalendarExpanded(false)} style={styles.toggleBtn}>
                  <Ionicons name="remove-circle-outline" size={24} color="#FFB81C" />
                </TouchableOpacity>
              </View>
              <Calendar
                theme={{
                  backgroundColor: '#FFFFFF', calendarBackground: '#FFFFFF',
                  textSectionTitleColor: '#64748B', selectedDayBackgroundColor: '#0F172A',
                  selectedDayTextColor: '#FFFFFF', todayTextColor: '#0F172A',
                  dayTextColor: '#0F172A', textDisabledColor: '#CBD5E1',
                  dotColor: '#0F172A', selectedDotColor: '#FFFFFF',
                  arrowColor: '#0F172A', monthTextColor: '#0F172A',
                  indicatorColor: '#0F172A', textDayFontWeight: '500',
                  textMonthFontWeight: '700', textDayHeaderFontWeight: '600'
                }}
                markingType={'custom'}
                markedDates={markedDates}
                current={selectedDateFilter || undefined}
                onDayPress={(day: any) => {
                  handleDateSelect(day.dateString);
                  setIsCalendarExpanded(false);
                }}
              />
              {(selectedDateFilter || selectedVenueFilter) && (
                <TouchableOpacity style={styles.clearFilterButton} onPress={clearAllFilters}>
                  <Text style={styles.clearFilterText}>{t('matches.show_all_matches')}</Text>
                  <Ionicons name="close-circle" size={16} color="#0F172A" style={{ marginLeft: 6 }} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {loading && !refreshing ? (
            <ActivityIndicator size="large" color="#0F172A" style={{ marginTop: 50 }} />
          ) : (
            <SectionList
              ref={sectionListRef}
              sections={sections}
              keyExtractor={(item, index) => item?.id?.toString() || `match-${index}`}
              onViewableItemsChanged={onViewableItemsChanged}
              viewabilityConfig={viewabilityConfig}
              stickySectionHeadersEnabled={false}
              renderSectionHeader={({ section: { title } }) => (
                <View style={styles.dateSeparator}>
                  <Text style={styles.dateSeparatorText}>{title}</Text>
                </View>
              )}
              renderItem={({ item }) => (
                <MatchCard 
                  item={item} 
                  fetchMatches={fetchMatches} 
                  isDesktop={isDesktop} 
                  onSelectMatch={setSelectedMatchId} 
                  isSelected={selectedMatchId === item.id} 
                  isAdmin={isAdmin} 
                  isShareMode={isShareMode} 
                  isShareSelected={shareSelectedIds.has(item.id.toString()) || shareSelectedIds.has(item.id)} 
                  onToggleShareSelect={toggleShareSelect} 
                />
              )}
              ListHeaderComponent={
                <View>
                  {!isDesktop && (
                    <View style={{ marginTop: 0 }}>
                      <View style={[styles.sectionHeaderCompact, { marginBottom: 4 }]}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={styles.sectionTitleSmall}>{t('matches.map_title')}</Text>
                        </View>
                        <TouchableOpacity onPress={() => setIsMapExpanded(!isMapExpanded)} style={styles.toggleBtn}>
                          <Ionicons name={isMapExpanded ? 'remove-circle-outline' : 'add-circle-outline'} size={24} color="#0F172A" />
                        </TouchableOpacity>
                      </View>
                      {isMapExpanded && (
                        <View style={styles.mobileMapWrapper}>
                          <Suspense fallback={<MapFallback />}>
                            <MapView
                              matches={filteredMatches}
                              selectedVenue={selectedVenueFilter}
                              selectedMatchId={selectedMatchId}
                              onSelectVenue={handleSelectVenue}
                            />
                          </Suspense>
                        </View>
                      )}
                    </View>
                  )}

                  {isAdmin && (
                    <View style={styles.adminActionsContainer}>
                      <TouchableOpacity 
                        style={styles.adminActionBtn}
                        onPress={() => router.push((env === 'dev' ? '/dev' : '') + '/admin/crear-partido' as any)}
                      >
                        <Ionicons name="add-circle-outline" size={18} color="#0F172A" />
                        <Text style={styles.adminActionText}>{t('matches.create_match')}</Text>
                      </TouchableOpacity>
                      <TouchableOpacity 
                        style={[styles.adminActionBtn, { marginLeft: 12 }]}
                        onPress={() => router.push((env === 'dev' ? '/dev' : '') + '/admin/jugadores' as any)}
                      >
                        <Ionicons name="people-outline" size={18} color="#0F172A" />
                        <Text style={styles.adminActionText}>{t('matches.player_agenda')}</Text>
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              }
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchMatches(true)} tintColor="#0F172A" progressBackgroundColor="#FFFFFF" colors={['#0F172A']} />}
            />
          )}
        </View>

        {isDesktop && (
          <View style={styles.desktopDetailsPanel}>
            {selectedMatchId ? (
              <MatchDetails 
                matchId={selectedMatchId} 
                asComponent={true} 
                onDeleteSuccess={() => { setSelectedMatchId(null); fetchMatches(); }}
              />
            ) : (
              <View style={styles.emptyDetails}>
                <Ionicons name="football-outline" size={64} color="#0F172A" />
                <Text style={styles.emptyDetailsText}>{t('matches.select_match_placeholder')}</Text>
              </View>
            )}
          </View>
        )}

        {isDesktop && (
          <View style={styles.desktopMapPanel}>
            {mapDeferReady ? (
              <Suspense fallback={<MapFallback />}>
                <MapView
                  matches={filteredMatches}
                  selectedVenue={selectedVenueFilter}
                  selectedMatchId={selectedMatchId}
                  onSelectVenue={handleSelectVenue}
                />
              </Suspense>
            ) : (
              <MapFallback />
            )}
          </View>
        )}
      </View>

      {/* Floating Share Action Bar */}
      {isShareMode && (
        <View style={styles.shareBar}>
          <TouchableOpacity onPress={cancelShareMode} style={styles.shareBarCancel}>
            <Ionicons name="close" size={20} color="#64748B" />
          </TouchableOpacity>
          <Text style={styles.shareBarText}>{shareSelectedIds.size} {t('matches.selected')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={handleCopySelected} style={[styles.shareBarBtn, isSmallScreen && { paddingHorizontal: 12 }]}>
              <Ionicons name="link-outline" size={18} color="#FFF" />
              {!isSmallScreen && <Text style={styles.shareBarBtnText}>{t('matches.copy_link')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity onPress={handleShareSelected} style={[styles.shareBarBtn, { backgroundColor: '#10B981' }, isSmallScreen && { paddingHorizontal: 12 }]}>
              <Ionicons name="share-outline" size={18} color="#FFF" />
              {!isSmallScreen && <Text style={styles.shareBarBtnText}>{t('common.share')}</Text>}
            </TouchableOpacity>
            {isAdmin && (
              <TouchableOpacity onPress={handleBulkDelete} style={[styles.shareBarBtn, { backgroundColor: '#EF4444' }, isSmallScreen && { paddingHorizontal: 12 }]}>
                <Ionicons name="trash-outline" size={18} color="#FFF" />
                {!isSmallScreen && <Text style={styles.shareBarBtnText}>{t('common.delete')}</Text>}
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
      {/* Advanced Filter Modal */}
      <Modal visible={isFilterModalVisible} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { height: 'auto', paddingBottom: 40 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('matches.filters')}</Text>
              <TouchableOpacity onPress={() => setIsFilterModalVisible(false)}>
                <Ionicons name="close" size={28} color="#94A3B8" />
              </TouchableOpacity>
            </View>

            <ScrollView>
              {isAdmin && (
                <View style={[styles.filterRow, { borderBottomWidth: 1, borderBottomColor: '#F1F5F9', paddingBottom: 15, marginBottom: 15 }]}>
                  <View style={styles.filterLabelCol}>
                    <Ionicons name="time" size={20} color="#64748B" />
                    <Text style={[styles.filterLabelText, { color: '#0F172A', fontFamily: FONTS.BOLD }]}>{t('matches.show_past')}</Text>
                  </View>
                  <Switch value={showPastMatches} onValueChange={setShowPastMatches} trackColor={{ false: '#E2E8F0', true: '#94A3B8' }} />
                </View>
              )}
              <View style={styles.filterRow}>
                <View style={styles.filterLabelCol}>
                  <Ionicons name="female" size={20} color="#FFB81C" />
                  <Text style={styles.filterLabelText}>{t('common.female')}</Text>
                </View>
                <Switch value={filterFemale} onValueChange={setFilterFemale} trackColor={{ false: '#E2E8F0', true: '#FFB81C' }} />
              </View>

              <View style={styles.filterRow}>
                <View style={styles.filterLabelCol}>
                  <Ionicons name="male-female" size={20} color="#FFB81C" />
                  <Text style={styles.filterLabelText}>{t('common.mixed')}</Text>
                </View>
                <Switch value={filterMixed} onValueChange={setFilterMixed} trackColor={{ false: '#E2E8F0', true: '#FFB81C' }} />
              </View>

              <View style={styles.filterRow}>
                <View style={styles.filterLabelCol}>
                  <Ionicons name="lock-closed" size={20} color="#FFB81C" />
                  <Text style={styles.filterLabelText}>{t('common.private')}</Text>
                </View>
                <Switch value={filterPrivate} onValueChange={setFilterPrivate} trackColor={{ false: '#E2E8F0', true: '#FFB81C' }} />
              </View>

              <View style={styles.filterRow}>
                <View style={styles.filterLabelCol}>
                  <Ionicons name="trophy" size={20} color="#FFB81C" />
                  <Text style={styles.filterLabelText}>{t('common.advanced')}</Text>
                </View>
                <Switch value={filterAdvanced} onValueChange={setFilterAdvanced} trackColor={{ false: '#E2E8F0', true: '#FFB81C' }} />
              </View>

              <Text style={[styles.label, { marginTop: 20 }]}>{t('matches.timeslot')}</Text>
              <View style={styles.filterRow}>
                <View style={styles.filterLabelCol}>
                  <Ionicons name="sunny-outline" size={20} color="#FFB81C" />
                  <Text style={styles.filterLabelText}>{t('common.morning')} (00:00 - 18:00)</Text>
                </View>
                <Switch value={filterMorning} onValueChange={setFilterMorning} trackColor={{ false: '#E2E8F0', true: '#FFB81C' }} />
              </View>

              <View style={styles.filterRow}>
                <View style={styles.filterLabelCol}>
                  <Ionicons name="moon-outline" size={20} color="#FFB81C" />
                  <Text style={styles.filterLabelText}>{t('common.afternoon_night')} (18:00 - 00:00)</Text>
                </View>
                <Switch value={filterEvening} onValueChange={setFilterEvening} trackColor={{ false: '#E2E8F0', true: '#FFB81C' }} />
              </View>

              <TouchableOpacity 
                style={[styles.applyButton, { marginTop: 30 }]}
                onPress={() => setIsFilterModalVisible(false)}
              >
                <Text style={styles.applyButtonText}>{t('matches.apply_filters')}</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={{ marginTop: 15, alignItems: 'center' }}
                onPress={() => {
                  setFilterFemale(false);
                  setFilterMixed(false);
                  setFilterPrivate(false);
                  setFilterAdvanced(false);
                  setFilterMorning(false);
                  setFilterEvening(false);
                }}
              >
                <Text style={{ color: '#64748B', fontWeight: '600' }}>{t('matches.clear_filters')}</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Language Selector Modal */}
      <Modal visible={isLangModalVisible} transparent={true} animationType="fade">
        <TouchableOpacity 
          style={styles.modalOverlay} 
          activeOpacity={1} 
          onPress={() => setIsLangModalVisible(false)}
        >
          <View style={[styles.modalContent, { height: 'auto', paddingBottom: 40 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('menu.language_section')}</Text>
              <TouchableOpacity onPress={() => setIsLangModalVisible(false)}>
                <Ionicons name="close" size={28} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            
            <View style={{ gap: 12 }}>
              <TouchableOpacity style={styles.langOption} onPress={() => changeLanguage('es')}>
                <Text style={[styles.langOptionText, i18n.language === 'es' && styles.langOptionTextActive]}>Castellano (ES)</Text>
                {i18n.language === 'es' && <Ionicons name="checkmark" size={20} color="#FFB81C" />}
              </TouchableOpacity>
              <TouchableOpacity style={styles.langOption} onPress={() => changeLanguage('en')}>
                <Text style={[styles.langOptionText, i18n.language === 'en' && styles.langOptionTextActive]}>English (EN)</Text>
                {i18n.language === 'en' && <Ionicons name="checkmark" size={20} color="#FFB81C" />}
              </TouchableOpacity>
              <TouchableOpacity style={styles.langOption} onPress={() => changeLanguage('ca')}>
                <Text style={[styles.langOptionText, i18n.language === 'ca' && styles.langOptionTextActive]}>Català (CA)</Text>
                {i18n.language === 'ca' && <Ionicons name="checkmark" size={20} color="#FFB81C" />}
              </TouchableOpacity>
            </View>
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.BACKGROUND },
  container: { flex: 1, paddingHorizontal: 16, overflow: 'visible' },
  header: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingVertical: 16,
    paddingHorizontal: 4
  },
  title: { 
    fontSize: 22, 
    fontFamily: FONTS.EXTRA_BOLD, 
    color: COLORS.TEXT_MAIN,
    letterSpacing: -0.5
  },
  listContent: { paddingBottom: 100, overflow: 'visible' },
  
  // MATCH CARD MINIMAL
  card: {
    backgroundColor: '#FFFFFF',
    marginBottom: 16,
    borderRadius: 0,
    borderWidth: 1,
    borderColor: '#000000',
  },
  cardInternal: {
    padding: 0,
  },
  cardHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    paddingBottom: 4,
  },
  cardTitleLine: {
    fontSize: 18,
    fontFamily: FONTS.BOLD,
    color: '#0F172A',
    flex: 1,
  },
  slotsBadgeMinimal: {
    backgroundColor: '#F0FDF4',
    paddingHorizontal: 12,
    paddingVertical: 2,
    borderRadius: 15,
  },
  slotsBadgeTextMinimal: {
    color: '#16A34A',
    fontSize: 13,
    fontFamily: FONTS.MEDIUM,
  },
  cardStatusRow: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6
  },
  statusTagMinimal: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
    borderRadius: 4,
  },
  statusTagTextMinimal: {
    fontSize: 11,
    color: '#64748B',
    fontFamily: FONTS.BOLD,
  },
  cardDivider: {
    height: 1,
    backgroundColor: '#E2E8F0',
  },
  cardFooterRowMinimal: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    paddingVertical: 8,
  },
  timeContainerMinimal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeTextMinimal: {
    fontSize: 16,
    color: '#0F172A',
    fontFamily: FONTS.SEMI_BOLD,
  },
  priceTextMinimal: {
    fontSize: 16,
    color: '#64748B',
    fontFamily: FONTS.REGULAR,
  },
  
  footerRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingTop: 12, 
    borderTopWidth: 1, 
    borderTopColor: COLORS.BORDER_LIGHT,
    marginTop: 12
  },
  timeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6
  },
  timeText: { 
    color: COLORS.TEXT_MAIN, 
    fontSize: 15, 
    fontFamily: FONTS.BOLD
  },
  priceContainerCard: {
    backgroundColor: COLORS.SECONDARY,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8
  },
  priceText: { 
    color: COLORS.TEXT_WHITE, 
    fontSize: 14, 
    fontFamily: FONTS.EXTRA_BOLD 
  },
  
  // ADMIN ACTIONS
  adminActionsContainer: { 
    flexDirection: 'row', 
    paddingBottom: 20, 
    paddingTop: 8,
    gap: 12
  },
  adminActionBtn: { 
    flex: 1, 
    backgroundColor: COLORS.CARD_BG, 
    padding: 14, 
    borderRadius: SIZES.RADIUS_SMALL, 
    flexDirection: 'row', 
    justifyContent: 'center', 
    alignItems: 'center', 
    borderWidth: 1, 
    borderColor: COLORS.BORDER,
    ...SHADOWS.SMALL
  },
  adminActionText: { 
    color: COLORS.TEXT_MAIN, 
    marginLeft: 8, 
    fontFamily: FONTS.BOLD, 
    fontSize: 14 
  },
  
  // FILTERS & MODALS
  filterRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    paddingVertical: 14, 
    borderBottomWidth: 1, 
    borderBottomColor: COLORS.BORDER_LIGHT 
  },
  filterLabelCol: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  filterLabelText: { fontSize: 16, color: COLORS.TEXT_MAIN, fontFamily: FONTS.SEMI_BOLD },
  
  applyButton: { 
    backgroundColor: COLORS.PRIMARY, 
    padding: 18, 
    borderRadius: 16, 
    alignItems: 'center',
    ...SHADOWS.MEDIUM
  },
  applyButtonText: { color: COLORS.TEXT_WHITE, fontSize: 16, fontFamily: FONTS.EXTRA_BOLD },
  
  // MISC
  duplicateContainer: { 
    backgroundColor: COLORS.BACKGROUND, 
    padding: 16, 
    borderTopWidth: 1, 
    borderTopColor: COLORS.BORDER_LIGHT 
  },
  duplicateSwitchRow: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 12 
  },
  duplicateLabel: { color: COLORS.TEXT_MUTED, fontSize: 13, fontFamily: FONTS.BOLD },
  duplicateButton: { 
    backgroundColor: COLORS.SECONDARY, 
    padding: 14, 
    borderRadius: 12, 
    flexDirection: 'row', 
    justifyContent: 'center', 
    alignItems: 'center',
    ...SHADOWS.SMALL
  },
  duplicateButtonText: { color: COLORS.TEXT_WHITE, fontFamily: FONTS.BOLD, marginLeft: 8, fontSize: 14 },
  
  langSelectorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.CARD_BG,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    marginLeft: 10,
    borderWidth: 1,
    borderColor: COLORS.BORDER,
    ...SHADOWS.SMALL
  },
  langSelectorText: {
    fontSize: 12,
    fontFamily: FONTS.BOLD,
    color: COLORS.TEXT_MAIN,
    marginRight: 4,
  },
  
  modalOverlay: { flex: 1, backgroundColor: COLORS.MODAL_OVERLAY, justifyContent: 'flex-end' },
  modalContent: { 
    backgroundColor: COLORS.CARD_BG, 
    borderTopLeftRadius: SIZES.RADIUS_LARGE, 
    borderTopRightRadius: SIZES.RADIUS_LARGE, 
    padding: 24, 
    paddingBottom: 40 
  },
  modalHeader: { 
    flexDirection: 'row', 
    justifyContent: 'space-between', 
    alignItems: 'center', 
    marginBottom: 24, 
    paddingBottom: 16, 
    borderBottomWidth: 1, 
    borderBottomColor: COLORS.BORDER_LIGHT 
  },
  modalTitle: { fontSize: 22, fontFamily: FONTS.EXTRA_BOLD, color: COLORS.TEXT_MAIN },
  label: { 
    fontSize: 12, 
    fontFamily: FONTS.EXTRA_BOLD, 
    color: COLORS.TEXT_MUTED, 
    textTransform: 'uppercase', 
    letterSpacing: 1.5, 
    marginBottom: 12 
  },
  
  // DESKTOP PANELS
  desktopContainer: { flex: 1, flexDirection: 'row', backgroundColor: COLORS.BACKGROUND },
  desktopListPanel: { 
    width: 400, 
    borderRightWidth: 1, 
    borderRightColor: COLORS.BORDER, 
    paddingHorizontal: 20,
    backgroundColor: COLORS.BACKGROUND
  },
  desktopDetailsPanel: { 
    flex: 1, 
    backgroundColor: COLORS.CARD_BG,
    borderRightWidth: 1,
    borderRightColor: COLORS.BORDER,
    position: 'relative',
    overflow: 'hidden'
  },
  desktopMapPanel: { flex: 1, backgroundColor: COLORS.BACKGROUND },
  
  // MAP & CALENDAR
  mobileMapWrapper: { 
    height: 280, 
    marginBottom: 8, 
    borderRadius: SIZES.RADIUS_MEDIUM, 
    overflow: 'hidden', 
    borderWidth: 1, 
    borderColor: COLORS.BORDER,
    ...SHADOWS.SMALL
  },
  emptyDetails: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: COLORS.CARD_BG 
  },
  emptyDetailsText: { 
    color: COLORS.TEXT_LIGHT, 
    fontSize: 16, 
    marginTop: 16, 
    fontFamily: FONTS.SEMI_BOLD 
  },
  cardSelected: { 
    borderColor: COLORS.PRIMARY, 
    borderWidth: 2 
  },
  cardShareSelected: { 
    borderColor: COLORS.SUCCESS, 
    borderWidth: 2, 
    backgroundColor: '#F0FDF4' 
  },
  calendarWrapper: { 
    marginBottom: 20, 
    borderRadius: SIZES.RADIUS_MEDIUM, 
    overflow: 'hidden', 
    borderWidth: 1, 
    borderColor: COLORS.BORDER, 
    backgroundColor: COLORS.CARD_BG,
    ...SHADOWS.SMALL
  },
  clearFilterButton: { 
    backgroundColor: COLORS.SECONDARY, 
    paddingVertical: 12, 
    flexDirection: 'row', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  clearFilterText: { color: COLORS.TEXT_WHITE, fontFamily: FONTS.BOLD, fontSize: 14 },
  
  // STICKY DATE STRIP
  stickyDateContainer: {
    backgroundColor: COLORS.BACKGROUND,
    height: 70, 
    justifyContent: 'center',
    zIndex: 2000, 
    borderBottomWidth: 1,
    borderBottomColor: COLORS.BORDER_LIGHT,
    marginBottom: 10
  },
  dayBubble: { 
    width: 48, 
    height: 48, 
    borderRadius: 24, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: COLORS.CARD_BG, 
    marginRight: 10, 
    borderWidth: 1, 
    borderColor: COLORS.BORDER_LIGHT,
    ...SHADOWS.SMALL 
  },
  dayBubbleSelected: { 
    backgroundColor: '#0F172A', 
    borderColor: '#0F172A' 
  },
  dayText: { fontSize: 12, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MUTED },
  dayTextSelected: { color: COLORS.TEXT_WHITE },
  
  dateSeparator: { 
    paddingVertical: 8, 
    paddingHorizontal: 4, 
    backgroundColor: COLORS.BACKGROUND 
  },
  dateSeparatorText: { 
    fontSize: 14, 
    fontFamily: FONTS.BOLD, 
    color: COLORS.TEXT_MAIN, 
    textTransform: 'uppercase',
    letterSpacing: 1
  },
  
  availabilityDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 4 },
  joinedIndicator: { position: 'absolute', top: -2, right: -2, zIndex: 10 },
  
  joinedListBadge: { 
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7', 
    paddingHorizontal: 8, 
    paddingVertical: 4, 
    borderRadius: 8, 
    borderWidth: 1, 
    borderColor: '#BBF7D0',
    gap: 4
  },
  joinedListBadgeText: { 
    color: COLORS.SUCCESS, 
    fontSize: 11, 
    fontFamily: FONTS.BOLD 
  },
  
  shareBar: { 
    position: 'absolute', 
    bottom: 20, 
    left: 20, 
    right: 20, 
    flexDirection: 'row', 
    alignItems: 'center', 
    gap: 12, 
    backgroundColor: COLORS.CARD_BG, 
    padding: 12, 
    borderRadius: 20,
    ...SHADOWS.LARGE
  },
  shareBarText: { flex: 1, fontSize: 14, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MAIN, marginLeft: 8 },
  shareBarCancel: { padding: 4 },
  shareBarBtn: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: COLORS.PRIMARY, 
    paddingHorizontal: 16, 
    paddingVertical: 10, 
    borderRadius: 12, 
    gap: 8 
  },
  shareBarBtnText: { color: "#FFF", fontSize: 13, fontFamily: FONTS.BOLD },
  shareToggleBtn: { 
    width: 32, 
    height: 32, 
    borderRadius: 8, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: COLORS.BACKGROUND, 
    borderWidth: 1, 
    borderColor: COLORS.BORDER_LIGHT 
  },
  shareToggleBtnActive: {
    backgroundColor: COLORS.SUCCESS,
    borderColor: COLORS.SUCCESS
  },
  horizontalScrollContent: { paddingHorizontal: 4, alignItems: 'center' },
  expandInScroll: { paddingHorizontal: 8, height: 48, justifyContent: 'center', alignItems: 'center' },
  tooltipContainer: { position: 'absolute', backgroundColor: COLORS.SECONDARY, borderRadius: 8, maxWidth: 220 },
  tooltipTitle: { color: COLORS.TEXT_WHITE, fontSize: 12, fontFamily: FONTS.BOLD, marginBottom: 4 },
  tooltipText: { color: COLORS.TEXT_WHITE, fontSize: 11, fontFamily: FONTS.REGULAR, lineHeight: 16 },
  tooltipArrow: { position: 'absolute', bottom: -6, left: 20, width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: COLORS.SECONDARY },
  sectionHeaderCompact: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  sectionTitleSmall: { fontSize: 14, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MAIN },
  toggleBtn: { padding: 4 },
  langOption: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 4 },
  langOptionText: { fontSize: 16, fontFamily: FONTS.SEMI_BOLD, color: COLORS.TEXT_MAIN },
  langOptionTextActive: { color: COLORS.PRIMARY, fontFamily: FONTS.BOLD },
});
