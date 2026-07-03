import { View, Text, StyleSheet, ScrollView, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Switch, Alert, useWindowDimensions, Platform, Modal, LayoutChangeEvent } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import { supabase } from '../../../lib/supabase';
import { computeIsAdmin } from '../../../lib/auth';
import { cacheMatchList } from '../../../lib/matchCache';
import { shareMultipleMatches, copyMultipleMatchUrls } from '../../../lib/share';
import { parseMatchDate, toISODate, getMatchTiming, barcelonaNow } from '../../../lib/date';
import {
  Card, Badge, Button, Skeleton, GradientHero, AnimatedEntrance, PressableScale,
  C, FONTS, GRADIENTS, R, S, SHADOW, webOnly,
} from '../../../components/v2/ui';

const MapView = lazy(() => import('../../../components/MapView'));
const MapFallback = () => (
  <View style={{ minHeight: 240, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surfaceAlt, borderRadius: R.lg }}>
    <ActivityIndicator size="large" color={C.brand} />
  </View>
);

const UPCOMING_LIMIT = 500;
const parseDateString = (d: string) => toISODate(parseMatchDate(d));

const availColor = (mList: any[]): string => {
  let best = 0;
  let color: string = C.availFree;
  mList.forEach((m) => {
    const free = m.max_players - m.computed_joined;
    const pct = (free / m.max_players) * 100;
    let c: string = C.availFull, p = 1;
    if (pct > 25) { c = C.availFree; p = 3; } else if (pct > 0) { c = C.availLow; p = 2; }
    if (p > best) { best = p; color = c; }
  });
  return color;
};

// ---------------------------------------------------------------- Match card
function MatchCardV2({ item, index, isAdmin, shareMode, shareSelected, onPress, onToggleShare }: any) {
  const { t } = useTranslation();
  const free = item.max_players - item.computed_joined;
  const pct = (free / item.max_players) * 100;
  const isFull = free <= 0;
  const { isStarted, isOver } = useMemo(() => getMatchTiming(item.dateISO, item.time), [item.dateISO, item.time]);

  const cap = isOver ? { label: t('matches.finished', 'Finalizado'), tone: 'neutral' as const }
    : isStarted ? { label: t('matches.in_progress', 'En curso'), tone: 'warning' as const }
    : { label: `${item.computed_joined}/${item.max_players}`, tone: isFull ? 'danger' as const : pct <= 25 ? 'warning' as const : 'success' as const };

  const joined = item.userStatus?.isJoined || item.userStatus?.guestCount > 0;

  return (
    <AnimatedEntrance index={index} style={{ flex: 1 }}>
      <Card
        onPress={() => (shareMode ? onToggleShare(item.id) : onPress(item.id))}
        onLongPress={() => onToggleShare(item.id)}
        selected={shareSelected}
        elevation="sm"
        padded={false}
        style={{ overflow: 'hidden' }}
      >
        {/* accent rail by availability */}
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: cap.tone === 'success' ? C.availFree : cap.tone === 'warning' ? C.availLow : cap.tone === 'danger' ? C.availFull : C.borderStrong }} />
        <View style={{ padding: S.lg, paddingLeft: S.lg + 4 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: S.sm }}>
            <Text style={styles.cardTitle} numberOfLines={1}>{item.title || item.venue}</Text>
            <Badge label={cap.label} tone={cap.tone} icon={isOver ? 'flag' : isStarted ? 'time' : 'people'} />
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 5 }}>
            <Ionicons name="location-outline" size={14} color={C.textFaint} />
            <Text style={styles.cardVenue} numberOfLines={1}>{item.venue}</Text>
          </View>

          {(item.is_female || item.is_mixed || item.is_private || item.is_advanced || (item.distance && item.distance !== 'Apto')) && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
              {item.is_female && <Badge size="sm" tone="brand" label={t('common.female')} />}
              {item.is_mixed && <Badge size="sm" tone="brand" label={t('common.mixed')} />}
              {item.is_private && <Badge size="sm" tone="neutral" label={t('common.private')} icon="lock-closed" />}
              {item.is_advanced && <Badge size="sm" tone="lime" label={t('common.advanced')} icon="trophy" />}
              {item.distance && item.distance !== 'Apto' && <Badge size="sm" tone="neutral" label={item.distance} />}
            </View>
          )}

          <View style={styles.cardDivider} />

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="time-outline" size={17} color={C.text} />
              <Text style={styles.cardTime}>{item.time}</Text>
              {joined && !shareMode && (
                <View style={styles.joinedPill}>
                  <Ionicons name="checkmark-circle" size={13} color={C.ink} />
                  <Text style={styles.joinedText}>{t('match_details.you_are_in', 'Apuntado')}</Text>
                </View>
              )}
            </View>
            <Text style={styles.cardPrice}>{Number(item.price).toFixed(2)}€</Text>
          </View>
        </View>

        {shareMode && (
          <View style={[styles.shareCheck, shareSelected && { backgroundColor: C.brand, borderColor: C.brand }]}>
            {shareSelected && <Ionicons name="checkmark" size={15} color="#fff" />}
          </View>
        )}
      </Card>
    </AnimatedEntrance>
  );
}

// ------------------------------------------------------------------- Screen
export default function V2Matches() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const [participationMap, setParticipationMap] = useState<Record<string, { venue: string; time: string }[]>>({});

  const [fFemale, setFFemale] = useState(false);
  const [fMixed, setFMixed] = useState(false);
  const [fPrivate, setFPrivate] = useState(false);
  const [fAdvanced, setFAdvanced] = useState(false);
  const [fMorning, setFMorning] = useState(false);
  const [fEvening, setFEvening] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const showPastRef = useRef(false);

  const [shareIds, setShareIds] = useState<Set<string>>(new Set());
  const shareMode = shareIds.size > 0;

  const scrollRef = useRef<ScrollView>(null);
  const sectionY = useRef<Record<string, number>>({});

  const columns = width > 1280 ? 3 : width > 820 ? 2 : 1;
  const todayISO = new Date().toISOString().split('T')[0];
  const anyFilter = fFemale || fMixed || fPrivate || fAdvanced || fMorning || fEvening;

  const fetchMatches = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    const userName = user?.user_metadata?.full_name || user?.email || '';
    const safeUserName = userName.replace(/[,.()%]/g, ' ').trim();
    const matchCols = 'id, title, venue, location_url, date, match_date, time, price, max_players, joined_players, level, distance, created_at, is_female, is_mixed, is_private, is_advanced, requires_payment';
    const today = new Date().toISOString().split('T')[0];
    const includePast = showPastRef.current;

    let q = supabase.from('matches').select(`${matchCols}, match_participants(count)`);
    if (includePast) q = q.order('created_at', { ascending: false }).limit(500);
    else q = q.gte('match_date', today).order('match_date', { ascending: true }).order('time', { ascending: true }).limit(UPCOMING_LIMIT);

    const partsPromise = user
      ? supabase.from('match_participants')
          .select(`match_id, user_id, user_name, matches!inner(id, date, match_date, venue, time)`)
          .or(`user_id.eq.${user.id},user_name.ilike.${safeUserName} (invitado%`)
          .gte('matches.match_date', today)
      : Promise.resolve({ data: null });

    const [{ data }, { data: pData }] = await Promise.all([q, partsPromise]);

    if (data) {
      const pMap: Record<string, { venue: string; time: string }[]> = {};
      const statusMap: Record<string, { isJoined: boolean; guestCount: number }> = {};
      if (pData && user) {
        for (const p of pData as any[]) {
          const m = p.matches;
          if (m?.match_date || m?.date) {
            const iso = m.match_date || parseDateString(m.date);
            if (iso) { if (!pMap[iso]) pMap[iso] = []; if (!pMap[iso].find((x) => x.venue === m.venue && x.time === m.time)) pMap[iso].push({ venue: m.venue, time: m.time }); }
          }
          const mid = p.match_id;
          if (!statusMap[mid]) statusMap[mid] = { isJoined: false, guestCount: 0 };
          if (p.user_id === user.id) statusMap[mid].isJoined = true;
          else if (p.user_name?.toLowerCase().includes(`${userName.toLowerCase()} (invitado`)) statusMap[mid].guestCount += 1;
        }
      }
      const processed = (data as any[]).filter((m) => m?.id).map((m) => {
        const realCount = Array.isArray(m.match_participants) ? (m.match_participants[0]?.count || 0) : 0;
        return { ...m, dateISO: m.match_date || parseDateString(m.date), computed_joined: (m.joined_players || 0) + realCount, userStatus: statusMap[m.id] || { isJoined: false, guestCount: 0 } };
      });
      processed.sort((a, b) => (!a.dateISO ? 1 : !b.dateISO ? -1 : a.dateISO !== b.dateISO ? a.dateISO.localeCompare(b.dateISO) : (a.time || '').localeCompare(b.time || '')));
      setParticipationMap(pMap);
      setMatches(processed);
      cacheMatchList(processed);
    }
    setLoading(false); setRefreshing(false);
  }, []);

  useEffect(() => { fetchMatches(); setSelectedDate(todayISO); checkRole(); }, []);
  const didToggle = useRef(false);
  useEffect(() => { showPastRef.current = showPast; if (!didToggle.current) { didToggle.current = true; return; } fetchMatches(); }, [showPast, fetchMatches]);

  const checkRole = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setIsAdmin(session?.user ? computeIsAdmin(session.user) : false);
  };

  const dayList = useMemo(() => {
    const days = []; const today = new Date();
    for (let i = 0; i < 30; i++) { const d = new Date(today); d.setDate(today.getDate() + i); days.push({ dateString: d.toISOString().split('T')[0], dayNum: d.getDate().toString(), weekday: d.toLocaleDateString(i18n.language === 'en' ? 'en-US' : i18n.language === 'ca' ? 'ca-ES' : 'es-ES', { weekday: 'short' }), isToday: i === 0 }); }
    return days;
  }, [i18n.language]);

  const matchesByDate = useMemo(() => {
    const map: Record<string, any[]> = {};
    matches.forEach((m) => { if (m.dateISO && m.dateISO >= todayISO) { (map[m.dateISO] ||= []).push(m); } });
    return map;
  }, [matches, todayISO]);

  const isMatchOver = (iso: string, time: string, now?: Date) => getMatchTiming(iso, time, now).isOver;

  const filtered = useMemo(() => {
    const now = barcelonaNow();
    return matches.filter((m) => {
      if (!showPast && isMatchOver(m.dateISO, m.time, now)) return false;
      if (fFemale || fMixed) { if (!((fFemale && m.is_female) || (fMixed && m.is_mixed))) return false; }
      if (fPrivate && !m.is_private) return false;
      if (fAdvanced && !m.is_advanced) return false;
      if (m.time) { const h = parseInt(m.time.split(':')[0], 10); if (fMorning && fEvening) {} else if (fMorning && h >= 18) return false; else if (fEvening && h < 18) return false; }
      return true;
    });
  }, [matches, showPast, fFemale, fMixed, fPrivate, fAdvanced, fMorning, fEvening]);

  const sections = useMemo(() => {
    const grouped: Record<string, any[]> = {};
    filtered.forEach((m) => { if (m.dateISO) (grouped[m.dateISO] ||= []).push(m); });
    return Object.keys(grouped).sort().map((iso) => {
      const isToday = iso === todayISO;
      const d = new Date(iso + 'T00:00:00');
      const title = isToday ? t('common.today') : d.toLocaleDateString(i18n.language === 'en' ? 'en-US' : i18n.language === 'ca' ? 'ca-ES' : 'es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
      return { iso, title, data: grouped[iso] };
    });
  }, [filtered, i18n.language, todayISO, t]);

  const markedDates = useMemo(() => {
    const marks: any = {};
    Object.keys(matchesByDate).forEach((iso) => { marks[iso] = { marked: true, dotColor: availColor(matchesByDate[iso]), selected: selectedDate === iso, selectedColor: C.brand }; });
    return marks;
  }, [matchesByDate, selectedDate]);

  const onSelectDate = (iso: string) => {
    setSelectedDate(iso);
    const y = sectionY.current[iso];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(y - 8, 0), animated: true });
  };

  const openMatch = (id: string) => router.push(`/v2/match/${id}` as any);
  const toggleShare = useCallback((id: string) => setShareIds((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }), []);
  const cancelShare = () => setShareIds(new Set());

  const changeLanguage = async (lng: string) => { await i18n.changeLanguage(lng); await AsyncStorage.setItem('@app_language', lng); LocaleConfig.defaultLocale = lng; setLangOpen(false); };

  const shareSelected = matches.filter((m) => shareIds.has(m.id.toString()) || shareIds.has(m.id));
  const doShare = async () => { if (shareSelected.length) await shareMultipleMatches(shareSelected); };
  const doCopy = async () => { if (!shareSelected.length) return; const ok = await copyMultipleMatchUrls(shareSelected); if (Platform.OS === 'web') window.alert(ok ? t('matches.links_copied') : t('matches.copy_error')); };
  const doBulkDelete = async () => {
    if (!shareSelected.length) return;
    const msg = t('matches.delete_matches_msg', { count: shareSelected.length });
    if (Platform.OS === 'web' ? !window.confirm(msg) : !(await new Promise<boolean>((res) => Alert.alert(t('matches.delete_matches_title'), msg, [{ text: t('common.cancel'), style: 'cancel', onPress: () => res(false) }, { text: t('common.delete'), style: 'destructive', onPress: () => res(true) }])))) return;
    for (const m of shareSelected) { await supabase.from('match_participants').delete().eq('match_id', m.id); await supabase.from('matches').delete().eq('id', m.id); }
    cancelShare(); fetchMatches();
  };

  const isDesktop = Platform.OS === 'web' && width > 820;

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <ScrollView
        ref={scrollRef}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
        contentContainerStyle={{ paddingBottom: 130 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchMatches(true)} tintColor={C.brand} colors={[C.brand]} />}
      >
        {/* Hero */}
        <GradientHero topInset={Platform.OS === 'web' ? S.xl : S.huge} colors={GRADIENTS.inkBrand}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroKicker}>{t('common.today')} · {new Date().toLocaleDateString(i18n.language === 'en' ? 'en-US' : i18n.language === 'ca' ? 'ca-ES' : 'es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
              <Text style={styles.heroTitle}>{t('matches.title')}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <PressableScale onPress={() => setLangOpen(true)} style={styles.heroPill}>
                <Text style={styles.heroPillText}>{i18n.language.toUpperCase()}</Text>
                <Ionicons name="chevron-down" size={13} color="#fff" />
              </PressableScale>
              <PressableScale onPress={() => fetchMatches(true)} style={styles.heroIcon}><Ionicons name="refresh" size={19} color="#fff" /></PressableScale>
            </View>
          </View>
        </GradientHero>

        {/* Sticky date strip + filter */}
        <View style={styles.stickyBar}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={dayList}
            keyExtractor={(d) => d.dateString}
            contentContainerStyle={{ paddingHorizontal: S.lg, paddingVertical: 10, gap: 8 }}
            ListHeaderComponent={
              <PressableScale onPress={() => setCalendarOpen(true)} style={[styles.dayBubble, { backgroundColor: C.surfaceAlt, borderColor: C.border }]}>
                <Ionicons name="calendar-outline" size={20} color={C.brandDeep} />
              </PressableScale>
            }
            renderItem={({ item }) => {
              const sel = selectedDate === item.dateString;
              const dm = matchesByDate[item.dateString] || [];
              const color = dm.length ? availColor(dm) : null;
              const mine = participationMap[item.dateString];
              return (
                <PressableScale onPress={() => onSelectDate(item.dateString)} style={[styles.dayBubble, sel && styles.dayBubbleSel]}>
                  <Text style={[styles.dayWeekday, sel && { color: 'rgba(255,255,255,0.8)' }]}>{item.isToday ? t('common.today') : item.weekday}</Text>
                  <Text style={[styles.dayNum, sel && { color: '#fff' }]}>{item.dayNum}</Text>
                  {color && <View style={[styles.dayDot, { backgroundColor: sel ? '#fff' : color }]} />}
                  {mine && <View style={styles.dayMine}><Ionicons name="football" size={9} color={sel ? '#fff' : C.brandDeep} /></View>}
                </PressableScale>
              );
            }}
          />
          <View style={styles.stickyActions}>
            <PressableScale onPress={() => setMapOpen((v) => !v)} style={[styles.chipBtn, mapOpen && styles.chipBtnActive]}>
              <Ionicons name="map-outline" size={17} color={mapOpen ? '#fff' : C.text} />
            </PressableScale>
            <PressableScale onPress={() => setFilterOpen(true)} style={[styles.chipBtn, anyFilter && styles.chipBtnActive]}>
              <Ionicons name="options-outline" size={17} color={anyFilter ? '#fff' : C.text} />
            </PressableScale>
          </View>
        </View>

        <View style={{ paddingHorizontal: S.lg, maxWidth: 1320, width: '100%', alignSelf: 'center' }}>
          {mapOpen && (
            <View style={{ marginTop: S.md, borderRadius: R.lg, overflow: 'hidden', height: 300, borderWidth: 2, borderColor: C.ink, ...SHADOW.sm }}>
              <Suspense fallback={<MapFallback />}>
                <MapView matches={filtered} selectedVenue={null} selectedMatchId={null} onSelectVenue={() => {}} />
              </Suspense>
            </View>
          )}

          {isAdmin && (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: S.md }}>
              <Button title={t('matches.create_match')} icon="add" variant="brand" size="sm" onPress={() => router.push('/v2/admin/crear-partido' as any)} />
              <Button title={t('matches.player_agenda')} icon="people-outline" variant="outline" size="sm" onPress={() => router.push('/v2/admin/jugadores' as any)} />
            </View>
          )}

          {loading ? (
            <View style={{ gap: 12, marginTop: S.xl }}>
              {[0, 1, 2, 3].map((i) => (
                <Card key={i} elevation="sm"><Skeleton width="55%" height={18} /><Skeleton width="35%" height={12} style={{ marginTop: 10 }} /><View style={styles.cardDivider} /><Skeleton width="100%" height={16} /></Card>
              ))}
            </View>
          ) : sections.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="football-outline" size={54} color={C.textFaint} />
              <Text style={styles.emptyText}>{t('matches.no_matches', 'No hay partidos')}</Text>
            </View>
          ) : (
            sections.map((sec) => (
              <View key={sec.iso} onLayout={(e: LayoutChangeEvent) => { sectionY.current[sec.iso] = e.nativeEvent.layout.y; }}>
                <View style={styles.sectionHeader}>
                  <View style={styles.sectionLine} />
                  <Text style={styles.sectionTitle}>{sec.title}</Text>
                  <Text style={styles.sectionCount}>{sec.data.length}</Text>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                  {sec.data.map((m: any, i: number) => (
                    <View key={m.id} style={{ width: columns === 1 ? '100%' : `${100 / columns}%`, flexGrow: 1, flexBasis: columns === 1 ? '100%' : 280, maxWidth: columns === 1 ? '100%' : '48%' }}>
                      <MatchCardV2 item={m} index={Math.min(i, 6)} isAdmin={isAdmin} shareMode={shareMode} shareSelected={shareIds.has(m.id.toString()) || shareIds.has(m.id)} onPress={openMatch} onToggleShare={toggleShare} />
                    </View>
                  ))}
                </View>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      {/* Share action bar */}
      {shareMode && (
        <AnimatedEntrance style={styles.shareBar} distance={20}>
          <PressableScale onPress={cancelShare} style={styles.shareClose}><Ionicons name="close" size={20} color={C.textMuted} /></PressableScale>
          <Text style={styles.shareCount}>{shareIds.size} {t('matches.selected')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button icon="link-outline" size="sm" variant="ink" onPress={doCopy} />
            <Button icon="share-outline" size="sm" variant="brand" onPress={doShare} />
            {isAdmin && <Button icon="trash-outline" size="sm" variant="danger" onPress={doBulkDelete} />}
          </View>
        </AnimatedEntrance>
      )}

      {/* Calendar modal */}
      <Modal visible={calendarOpen} transparent animationType="fade" onRequestClose={() => setCalendarOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setCalendarOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Calendar
              theme={{ calendarBackground: C.surface, textSectionTitleColor: C.textMuted, selectedDayBackgroundColor: C.brand, selectedDayTextColor: '#fff', todayTextColor: C.brandDeep, dayTextColor: C.text, monthTextColor: C.text, arrowColor: C.brand, textMonthFontFamily: FONTS.bold, textDayFontFamily: FONTS.medium, textDayHeaderFontFamily: FONTS.semibold } as any}
              markedDates={markedDates}
              current={selectedDate || undefined}
              onDayPress={(d: any) => { onSelectDate(d.dateString); setCalendarOpen(false); }}
            />
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

      {/* Filter modal */}
      <Modal visible={filterOpen} transparent animationType="slide" onRequestClose={() => setFilterOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('matches.filters')}</Text>
            <ScrollView style={{ maxHeight: 460 }}>
              {isAdmin && <FilterRow icon="time" label={t('matches.show_past')} value={showPast} onChange={setShowPast} accent />}
              <FilterRow icon="female" label={t('common.female')} value={fFemale} onChange={setFFemale} />
              <FilterRow icon="male-female" label={t('common.mixed')} value={fMixed} onChange={setFMixed} />
              <FilterRow icon="lock-closed" label={t('common.private')} value={fPrivate} onChange={setFPrivate} />
              <FilterRow icon="trophy" label={t('common.advanced')} value={fAdvanced} onChange={setFAdvanced} />
              <FilterRow icon="sunny-outline" label={`${t('common.morning')} (00-18h)`} value={fMorning} onChange={setFMorning} />
              <FilterRow icon="moon-outline" label={`${t('common.afternoon_night')} (18-00h)`} value={fEvening} onChange={setFEvening} />
              <View style={{ flexDirection: 'row', gap: 10, marginTop: S.lg }}>
                <Button title={t('matches.clear_filters')} variant="outline" size="md" onPress={() => { setFFemale(false); setFMixed(false); setFPrivate(false); setFAdvanced(false); setFMorning(false); setFEvening(false); }} style={{ flex: 1 }} />
                <Button title={t('matches.apply_filters')} variant="brand" size="md" onPress={() => setFilterOpen(false)} style={{ flex: 1 }} />
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Language modal */}
      <Modal visible={langOpen} transparent animationType="fade" onRequestClose={() => setLangOpen(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setLangOpen(false)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('menu.language_section')}</Text>
            {[['es', 'Castellano'], ['en', 'English'], ['ca', 'Català']].map(([code, label]) => (
              <TouchableOpacity key={code} style={styles.langRow} onPress={() => changeLanguage(code)}>
                <Text style={[styles.langText, i18n.language === code && { color: C.brandDeep, fontFamily: FONTS.bold }]}>{label} ({code.toUpperCase()})</Text>
                {i18n.language === code && <Ionicons name="checkmark-circle" size={20} color={C.brand} />}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

function FilterRow({ icon, label, value, onChange, accent }: any) {
  return (
    <View style={styles.filterRow}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={[styles.filterIcon, accent && { backgroundColor: C.brandWash }]}><Ionicons name={icon} size={18} color={accent ? C.brandDeep : C.textMuted} /></View>
        <Text style={styles.filterLabel}>{label}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: C.border, true: C.brand }} thumbColor="#fff" />
    </View>
  );
}

const styles = StyleSheet.create({
  heroKicker: { color: C.chalkSoft, fontFamily: FONTS.monoMedium, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase' },
  heroTitle: { color: '#fff', fontFamily: FONTS.black, fontSize: 32, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 3 },
  heroPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1.5, borderColor: 'rgba(244,250,240,0.5)', paddingHorizontal: 12, paddingVertical: 8, borderRadius: R.pill },
  heroPillText: { color: '#fff', fontFamily: FONTS.monoMedium, fontSize: 12, letterSpacing: 0.5 },
  heroIcon: { width: 38, height: 38, borderRadius: R.pill, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1.5, borderColor: 'rgba(244,250,240,0.5)', alignItems: 'center', justifyContent: 'center' },

  stickyBar: { backgroundColor: C.bg, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 2, borderBottomColor: C.ink },
  stickyActions: { flexDirection: 'row', gap: 8, paddingRight: S.lg, paddingLeft: 4 },
  chipBtn: { width: 40, height: 40, borderRadius: R.md, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.ink, alignItems: 'center', justifyContent: 'center', ...SHADOW.sm },
  chipBtnActive: { backgroundColor: C.brand, borderColor: C.ink },

  dayBubble: { width: 52, height: 64, borderRadius: R.md, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.ink, alignItems: 'center', justifyContent: 'center', gap: 2, ...SHADOW.sm },
  dayBubbleSel: { backgroundColor: C.ink800, borderColor: C.ink },
  dayWeekday: { fontFamily: FONTS.monoMedium, fontSize: 9.5, letterSpacing: 0.5, color: C.textFaint, textTransform: 'uppercase' },
  dayNum: { fontFamily: FONTS.black, fontSize: 19, letterSpacing: 0.3, color: C.text },
  dayDot: { width: 6, height: 6, marginTop: 1 },
  dayMine: { position: 'absolute', top: 5, right: 5 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: S.xl, marginBottom: S.md },
  sectionLine: { width: 10, height: 14, backgroundColor: C.accent, borderWidth: 1.5, borderColor: C.ink },
  sectionTitle: { fontFamily: FONTS.extraBold, fontSize: 17, color: C.text, textTransform: 'capitalize', flex: 1 },
  sectionCount: { fontFamily: FONTS.monoMedium, fontSize: 11.5, color: C.textMuted, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.ink, paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.pill, overflow: 'hidden' },

  cardTitle: { flex: 1, fontFamily: FONTS.extraBold, fontSize: 16, color: C.text, letterSpacing: -0.3 },
  cardVenue: { color: C.textMuted, fontFamily: FONTS.medium, fontSize: 13, flex: 1 },
  cardDivider: { height: 1, backgroundColor: C.border, marginVertical: 12 },
  cardTime: { fontFamily: FONTS.black, fontSize: 17, letterSpacing: 0.5, color: C.text },
  cardPrice: { fontFamily: FONTS.monoMedium, fontSize: 16, color: C.brandDeep },
  joinedPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.accent, borderWidth: 1, borderColor: C.ink, paddingHorizontal: 8, paddingVertical: 3, borderRadius: R.pill, marginLeft: 4 },
  joinedText: { color: C.ink, fontFamily: FONTS.bold, fontSize: 10.5 },
  shareCheck: { position: 'absolute', top: 10, right: 10, width: 24, height: 24, borderWidth: 2, borderColor: C.ink, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },

  empty: { alignItems: 'center', paddingVertical: 70, gap: 12 },
  emptyText: { color: C.textMuted, fontFamily: FONTS.semibold, fontSize: 15 },

  shareBar: { position: 'absolute', bottom: 100, left: 16, right: 16, maxWidth: 460, alignSelf: 'center', backgroundColor: C.surface, borderRadius: R.pill, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 12, gap: 10, ...SHADOW.lg, borderWidth: 2, borderColor: C.ink },
  shareClose: { width: 36, height: 36, backgroundColor: C.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  shareCount: { fontFamily: FONTS.bold, fontSize: 14, color: C.text, flex: 1, textAlign: 'center' },

  modalOverlay: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, borderTopWidth: 2, borderLeftWidth: 2, borderRightWidth: 2, borderColor: C.ink, padding: S.xl, paddingBottom: S.huge, ...(Platform.OS === 'web' ? { maxWidth: 520, width: '100%', alignSelf: 'center' } : {}) },
  sheetHandle: { width: 40, height: 5, borderRadius: 3, backgroundColor: C.borderStrong, alignSelf: 'center', marginBottom: S.lg },
  sheetTitle: { fontFamily: FONTS.extraBold, fontSize: 20, color: C.text, marginBottom: S.lg },
  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10 },
  filterIcon: { width: 38, height: 38, borderRadius: R.sm, backgroundColor: C.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  filterLabel: { fontFamily: FONTS.semibold, fontSize: 15, color: C.text },
  langRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 15, borderBottomWidth: 1, borderBottomColor: C.border },
  langText: { fontFamily: FONTS.semibold, fontSize: 16, color: C.text },
});
