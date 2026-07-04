import { View, Text, StyleSheet, ScrollView, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Switch, Alert, useWindowDimensions, Platform, Modal, LayoutChangeEvent, Animated, Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { useEffect, useState, useMemo, useRef, useCallback, lazy, Suspense } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Calendar, LocaleConfig } from 'react-native-calendars';
import { supabase } from '../../../lib/supabase';
import { computeIsAdmin } from '../../../lib/auth';
import { joinMatch } from '../../../lib/services/participantService';
import { createPayment } from '../../../lib/services/paymentService';
import { sendEmailNotification } from '../../../lib/services/notificationService';
import { cacheMatchList } from '../../../lib/matchCache';
import { shareMultipleMatches, copyMultipleMatchUrls } from '../../../lib/share';
import { parseMatchDate, toISODate, getMatchTiming, barcelonaNow } from '../../../lib/date';
import {
  Card, Badge, Button, Skeleton, GradientHero, AnimatedEntrance, PressableScale,
  C, FONTS, GRADIENTS, MOTION, R, S, SHADOW, webOnly,
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
// Ficha «convocatoria»: en la baraja del día una carta va destapada (ficha
// completa con alineación de puntos, sello y acciones) y el resto asoman como
// lomos con la info básica — hora, campo y plazas. Tap en un lomo destapa esa
// carta; el detalle solo se abre desde la carta destapada.
const AVAIL_TONE = (joinedCount: number, max: number) => {
  const free = max - joinedCount;
  if (free <= 0) return C.availFull;
  if ((free / max) * 100 <= 25) return C.availLow;
  return C.availFree;
};

// Alineación de puntos con el contador fluyendo justo detrás del último
// punto (misma fila con wrap: si no caben, saltan a una segunda línea sin
// salirse de la ficha).
function LineupDots({ joined, max, mine, count, countColor }: { joined: number; max: number; mine: number; count: string; countColor: string }) {
  const dots = [];
  for (let i = 0; i < Math.min(max, 22); i++) {
    const filled = i < joined;
    const isMine = filled && i >= joined - mine;
    dots.push(
      <View
        key={i}
        style={[styles.dot, filled ? (isMine ? styles.dotMine : styles.dotFilled) : styles.dotFree]}
      />
    );
  }
  return (
    <View style={styles.dotsRow}>
      {dots}
      <Text style={[styles.fichaCount, { color: countColor, marginLeft: 4 }]}>{count}</Text>
    </View>
  );
}

// Texto girado -90° para el lomo vertical (lee de abajo arriba, como el
// canto de un libro). Mide su contenedor para dimensionar el texto girado.
function VerticalText({ text, style }: { text: string; style?: any }) {
  const [h, setH] = useState(0);
  return (
    <View
      style={{ flex: 1, minHeight: 150, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}
      onLayout={(e) => setH(Math.round(e.nativeEvent.layout.height))}
    >
      {h > 0 && (
        // se rota un contenedor de medidas fijas (no el texto): RN-web capa el
        // Text con numberOfLines a maxWidth 100% del padre y lo truncaría
        <View key={h} style={{ width: h - 4, height: 24, transform: [{ rotate: '-90deg' }], alignItems: 'center', justifyContent: 'center' }}>
          <Text numberOfLines={1} style={style}>{text}</Text>
        </View>
      )}
    </View>
  );
}

function MatchCardV2({ item, index, expanded, expandedWidth, onExpand, onJoin, joining, shareMode, shareSelected, onPress, onToggleShare }: any) {
  const { t, i18n } = useTranslation();
  const free = item.max_players - item.computed_joined;
  const isFull = free <= 0;
  const { isStarted, isOver } = useMemo(() => getMatchTiming(item.dateISO, item.time), [item.dateISO, item.time]);

  const joined = item.userStatus?.isJoined || item.userStatus?.guestCount > 0;
  const mineCount = (item.userStatus?.isJoined ? 1 : 0) + (item.userStatus?.guestCount || 0);
  const availColor = AVAIL_TONE(item.computed_joined, item.max_players);
  const isPaid = item.requires_payment && item.price > 0;
  const canJoin = !joined && !isFull && !isStarted && !isOver;

  const fecha = useMemo(() => {
    const locale = i18n.language === 'en' ? 'en-US' : i18n.language === 'ca' ? 'ca-ES' : 'es-ES';
    try {
      return new Date(`${item.dateISO}T00:00:00`).toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'short' }).replace(/[.,]/g, '').toUpperCase();
    } catch { return ''; }
  }, [item.dateISO, i18n.language]);

  const handleTap = () => {
    if (shareMode) return onToggleShare(item.id);
    if (expanded) onPress(item.id);
    else onExpand();
  };

  // ------- lomo vertical (carta tapada en el abanico): hora arriba,
  // plazas debajo, campo girado y características al pie -------
  if (!expanded) {
    const countColor = isOver ? C.textFaint : availColor === C.availLow ? C.warning : availColor;
    return (
      <PressableScale onPress={handleTap} onLongPress={() => onToggleShare(item.id)} style={[styles.spine, shareSelected && styles.spineSelected]}>
        <Text style={styles.spineTime}>{item.time}</Text>
        <Text style={[styles.spineCount, { color: countColor }]}>
          {isOver ? 'FIN' : `${item.computed_joined}/${item.max_players}`}
        </Text>
        {joined && (
          <View style={styles.spineYou}>
            <Ionicons name="checkmark" size={11} color={C.ink} />
          </View>
        )}
        {/* dos columnas verticales: campo girado + iconos de características */}
        <View style={{ flex: 1, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'stretch' }}>
          <VerticalText text={item.venue} style={styles.spineTitle} />
          <View style={{ width: 20, alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            {item.is_female && <Ionicons name="female" size={14} color={C.textMuted} />}
            {item.is_mixed && <Ionicons name="people-outline" size={15} color={C.textMuted} />}
            {item.is_advanced && <Ionicons name="trophy-outline" size={14} color={C.textMuted} />}
            {item.is_private && <Ionicons name="lock-closed-outline" size={14} color={C.textMuted} />}
            {!!item.distance && item.distance !== 'Apto' && <Text style={styles.spineMeta}>{item.distance}</Text>}
          </View>
        </View>
        <Text style={styles.spinePrice}>{Number(item.price).toFixed(2).replace('.', ',')}€</Text>
        {shareMode && (
          <View style={[styles.shareCheckStrip, shareSelected && { backgroundColor: C.brand, borderColor: C.brand }]}>
            {shareSelected && <Ionicons name="checkmark" size={13} color="#fff" />}
          </View>
        )}
      </PressableScale>
    );
  }

  // ------- carta destapada: la ficha completa -------
  const estado = isOver ? { label: t('matches.finished', 'Finalizado'), tone: 'neutral' as const, icon: 'flag' }
    : isStarted ? { label: t('matches.in_progress', 'En curso'), tone: 'warning' as const, icon: 'time' }
    : isFull ? { label: t('matches.closed', 'Cerrado'), tone: 'danger' as const }
    : free === 1 ? { label: t('matches.last_spot', 'Última plaza'), tone: 'warning' as const }
    : (free / item.max_players) * 100 <= 25 ? { label: t('matches.last_spots', 'Últimas plazas'), tone: 'warning' as const }
    : { label: t('matches.open', 'Abierto'), tone: 'success' as const };

  // en el abanico móvil la ficha puede quedar estrecha: hora y paddings
  // reducidos para que «08:00» no parta en dos líneas
  const compactFicha = !!expandedWidth && expandedWidth < 260;
  return (
    <AnimatedEntrance index={Math.min(index, 4)} style={expandedWidth ? { width: expandedWidth } : undefined}>
      <Card
        onPress={handleTap}
        onLongPress={() => onToggleShare(item.id)}
        selected={shareSelected}
        elevation="md"
        padded={false}
      >
        <View style={{ padding: compactFicha ? S.md : S.lg, paddingBottom: S.md, minHeight: 272 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: S.sm }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.fichaHora, compactFicha && { fontSize: 26, lineHeight: 28 }]}>{item.time}</Text>
              <Text style={[styles.fichaFecha, compactFicha && { fontSize: 10.5, letterSpacing: 1 }]}>
                {fecha}{item.distance && item.distance !== 'Apto' ? ` · ${item.distance}` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 8 }}>
              <Badge label={estado.label} tone={estado.tone} icon={estado.icon as any} />
              <PressableScale onPress={() => onPress(item.id)} style={styles.verFicha}>
                <Text style={styles.verFichaText}>{compactFicha ? t('matches.see', 'Ver') : t('matches.see_card', 'Ver ficha')}</Text>
                <Ionicons name="arrow-forward" size={12} color={C.text} />
              </PressableScale>
            </View>
          </View>

          {isFull && !isOver && (
            <View style={styles.stamp} pointerEvents="none">
              <Text style={styles.stampText}>{t('matches.full_stamp', 'COMPLETO')}</Text>
            </View>
          )}

          {/* solo el nombre del campo — el título del partido vive en el detalle */}
          <Text style={styles.fichaTitle} numberOfLines={1}>{item.venue}</Text>

          {(joined || item.is_female || item.is_mixed || item.is_private || item.is_advanced) && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
              {joined && <Badge tone="ink" icon="checkmark" label={t('matches.you_are_titular', 'Eres titular')} />}
              {item.userStatus?.guestCount > 0 && <Badge tone="neutral" label={`+${item.userStatus.guestCount} ${t('match_details.guests', 'invitados')}`} />}
              {item.is_female && <Badge size="sm" tone="brand" label={t('common.female')} />}
              {item.is_mixed && <Badge size="sm" tone="brand" label={t('common.mixed')} />}
              {item.is_private && <Badge size="sm" tone="neutral" label={t('common.private')} icon="lock-closed" />}
              {item.is_advanced && <Badge size="sm" tone="lime" label={t('common.advanced')} icon="trophy" />}
            </View>
          )}

          <View style={{ flexGrow: 1 }} />
          <View style={styles.cardDivider} />

          <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: S.md }}>
            <View style={{ flex: 1 }}>
              <LineupDots
                joined={item.computed_joined}
                max={item.max_players}
                mine={mineCount}
                count={`${item.computed_joined}/${item.max_players}`}
                countColor={availColor === C.availLow ? C.warning : availColor}
              />
            </View>
            <Text style={styles.fichaPrice}>
              {Number(item.price).toFixed(2).replace('.', ',')}<Text style={styles.fichaEur}> EUR</Text>
            </Text>
          </View>

          {canJoin && (
            <Button
              title={isPaid ? t('match_details.pay_spot', 'Pagar plaza') : t('matches.join_now', 'Me apunto')}
              variant="brand"
              size="sm"
              loading={joining}
              onPress={() => onJoin(item)}
              full
              style={{ marginTop: S.sm + 2 }}
            />
          )}
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

  // baraja: qué carta va destapada en cada día + alta en curso desde la carta
  const [expandedByDay, setExpandedByDay] = useState<Record<string, string>>({});
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const meRef = useRef<{ id: string | null; name: string }>({ id: null, name: '' });

  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(new Animated.Value(0)).current;
  const sectionY = useRef<Record<string, number>>({});
  const contentTopY = useRef(0);

  const todayISO = new Date().toISOString().split('T')[0];
  const anyFilter = fFemale || fMixed || fPrivate || fAdvanced || fMorning || fEvening;

  const fetchMatches = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    const user = session?.user ?? null;
    const userName = user?.user_metadata?.full_name || user?.email || '';
    const safeUserName = userName.replace(/[,.()%]/g, ' ').trim();
    meRef.current = { id: user?.id ?? null, name: safeUserName };
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

  // Al volver a esta pantalla (p. ej. desde la ficha de un partido tras
  // apuntarse/desapuntarse) los datos se refrescan en silencio. El primer
  // focus coincide con el montaje, que ya hace fetch — se salta.
  const didFocus = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!didFocus.current) { didFocus.current = true; return; }
      fetchMatches(true);
    }, [fetchMatches])
  );

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
      // el año solo cuando no es el actual — evita que un partido lejano
      // (p. ej. seeds de test en 2027) parezca de este año
      const sameYear = d.getFullYear() === new Date().getFullYear();
      // solo la primera letra en mayúscula («Sábado, 4 de julio», no «4 De Julio»)
      const raw = isToday ? t('common.today') : d.toLocaleDateString(i18n.language === 'en' ? 'en-US' : i18n.language === 'ca' ? 'ca-ES' : 'es-ES', { weekday: 'long', day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }) });
      const title = raw.charAt(0).toUpperCase() + raw.slice(1);
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
    // el y de la sección es relativo al contenedor de contenido; se suma su
    // offset dentro del scroll para aterrizar en el día correcto
    const y = sectionY.current[iso];
    if (y != null) scrollRef.current?.scrollTo({ y: Math.max(contentTopY.current + y - 60, 0), animated: true });
  };

  const openMatch = (id: string) => router.push(`/v2/match/${id}` as any);

  // Alta directa desde la carta destapada. Gratis → RPC atómica join_match
  // (misma que el detalle, capacidad garantizada en servidor); de pago →
  // redirige a Monei igual que initiatePayment del detalle.
  const notify = (title: string, msg: string) => {
    if (Platform.OS === 'web') window.alert(`${title}\n${msg}`);
    else Alert.alert(title, msg);
  };
  const joinFromCard = async (m: any) => {
    const me = meRef.current;
    if (!me.id) return notify(t('match_details.login_required', 'Inicia sesión'), t('match_details.login_required_msg', 'Necesitas iniciar sesión para apuntarte.'));
    setJoiningId(m.id);
    try {
      if (m.requires_payment && m.price > 0) {
        const { redirectUrl } = await createPayment(m.id, 'prod');
        if (Platform.OS === 'web') { window.location.href = redirectUrl; return; }
        await Linking.openURL(redirectUrl);
      } else {
        await joinMatch(m.id, me.id, me.name, (tb: string) => tb);
        sendEmailNotification(m, 'join', me.name, m.computed_joined + 1, m.id);
        await fetchMatches(true);
        notify(t('match_details.joined_msg', '¡Apuntado!'), t('match_details.joined_success', 'Tu plaza está reservada.'));
      }
    } catch (err: any) {
      notify(t('common.error', 'Error'), err.message || t('common.connection_error', 'Error de conexión'));
    }
    setJoiningId(null);
  };
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
      <Animated.ScrollView
        ref={scrollRef as any}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[1]}
        contentContainerStyle={{ paddingBottom: 130 }}
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: MOTION.useNative })}
        scrollEventThrottle={16}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => fetchMatches(true)} tintColor={C.brand} colors={[C.brand]} />}
      >
        {/* Hero */}
        <GradientHero topInset={Platform.OS === 'web' ? S.xl : S.huge} colors={GRADIENTS.inkBrand} parallax={scrollY}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroKicker}>{t('common.today')} · {new Date().toLocaleDateString(i18n.language === 'en' ? 'en-US' : i18n.language === 'ca' ? 'ca-ES' : 'es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
              <Text style={styles.heroTitle}>{t('matches.title')}</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              {/* en móvil: sin mapa y sin refrescar (pull-to-refresh) */}
              {isDesktop && (
                <PressableScale onPress={() => setMapOpen((v) => !v)} style={[styles.heroIcon, mapOpen && styles.heroIconActive]}>
                  <Ionicons name="map-outline" size={18} color={mapOpen ? C.ink : '#fff'} />
                </PressableScale>
              )}
              <PressableScale onPress={() => setFilterOpen(true)} style={[styles.heroIcon, anyFilter && styles.heroIconActive]}>
                <Ionicons name="options-outline" size={18} color={anyFilter ? C.ink : '#fff'} />
              </PressableScale>
              <PressableScale onPress={() => setLangOpen(true)} style={styles.heroPill}>
                <Text style={styles.heroPillText}>{i18n.language.toUpperCase()}</Text>
                <Ionicons name="chevron-down" size={13} color="#fff" />
              </PressableScale>
              {isDesktop && (
                <PressableScale onPress={() => fetchMatches(true)} style={styles.heroIcon}><Ionicons name="refresh" size={19} color="#fff" /></PressableScale>
              )}
            </View>
          </View>
        </GradientHero>

        {/* Sticky date strip + calendario fijo al final */}
        <View style={styles.stickyBar}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={dayList}
            keyExtractor={(d) => d.dateString}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: S.lg, paddingVertical: 10, gap: 8 }}
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
          {/* siempre visible, no se desplaza con los días */}
          <View style={styles.stickyCal}>
            <PressableScale onPress={() => setCalendarOpen(true)} style={[styles.dayBubble, { backgroundColor: C.surfaceAlt, borderColor: C.border }]}>
              <Ionicons name="calendar-outline" size={20} color={C.brandDeep} />
            </PressableScale>
          </View>
        </View>

        <View
          style={{ paddingHorizontal: S.lg, maxWidth: 1320, width: '100%', alignSelf: 'center' }}
          onLayout={(e: LayoutChangeEvent) => { contentTopY.current = e.nativeEvent.layout.y; }}
        >
          {mapOpen && (
            <View style={{ marginTop: S.md, borderRadius: R.lg, overflow: 'hidden', height: 300, borderWidth: 2, borderColor: C.ink, ...SHADOW.sm }}>
              <Suspense fallback={<MapFallback />}>
                <MapView matches={filtered} selectedVenue={null} selectedMatchId={null} onSelectVenue={() => {}} />
              </Suspense>
            </View>
          )}

          {isAdmin && (
            <View style={{ flexDirection: 'row', gap: 10, marginTop: S.md }}>
              {/* flex 1 en ambos: siempre caben, repartiendo el ancho */}
              <Button title={t('matches.create_match')} icon="add" variant="brand" size="sm" onPress={() => router.push('/v2/admin/crear-partido' as any)} style={{ flex: 1 }} />
              <Button title={t('matches.player_agenda')} icon="people-outline" variant="outline" size="sm" onPress={() => router.push('/v2/admin/jugadores' as any)} style={{ flex: 1 }} />
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
                  {!isDesktop && sec.data.length > 3 && (
                    <Text style={styles.moreHint}>+{sec.data.length - 3} →</Text>
                  )}
                  <Text style={styles.sectionCount}>{sec.data.length}</Text>
                </View>
                {isDesktop ? (
                  /* PC: sin solape — todas las fichas enteras en fila */
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
                    {sec.data.map((m: any, i: number) => (
                      <MatchCardV2
                        key={m.id}
                        item={m}
                        index={Math.min(i, 6)}
                        expanded
                        expandedWidth={340}
                        onExpand={() => {}}
                        onJoin={joinFromCard}
                        joining={joiningId === m.id}
                        shareMode={shareMode}
                        shareSelected={shareIds.has(m.id.toString()) || shareIds.has(m.id)}
                        onPress={openMatch}
                        onToggleShare={toggleShare}
                      />
                    ))}
                  </View>
                ) : (
                  /* móvil: abanico horizontal — lomos verticales tapados y
                     la carta destapada ocupando el resto */
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ maxWidth: 720 }}
                    contentContainerStyle={{ alignItems: 'stretch', paddingBottom: 8, paddingRight: 8 }}
                  >
                    {sec.data.map((m: any, i: number) => {
                      const expandedId = expandedByDay[sec.iso] ?? String(sec.data[0].id);
                      const isExpanded = String(m.id) === expandedId;
                      // solape con z decreciente; la solapada lleva sombra manual:
                      // banda derecha completa (como la ficha) y banda inferior
                      // recortada para que abajo no se forme una línea continua
                      return (
                        <View key={m.id} style={{ zIndex: isExpanded ? 60 : sec.data.length - i, marginLeft: i === 0 ? 0 : -14, flexDirection: 'row', alignItems: 'stretch' }}>
                          {!isExpanded && (
                            <>
                              <View pointerEvents="none" style={{ position: 'absolute', right: -3, top: 3, bottom: -3, width: 3, backgroundColor: C.ink }} />
                              <View pointerEvents="none" style={{ position: 'absolute', left: 24, right: -3, bottom: -3, height: 3, backgroundColor: C.ink }} />
                            </>
                          )}
                          <MatchCardV2
                            item={m}
                            index={Math.min(i, 6)}
                            expanded={isExpanded}
                            expandedWidth={Math.max(210, Math.min(width - 2 * S.lg, 720) - Math.min(sec.data.length - 1, 2) * 82 - 8)}
                            onExpand={() => setExpandedByDay((prev) => ({ ...prev, [sec.iso]: String(m.id) }))}
                            onJoin={joinFromCard}
                            joining={joiningId === m.id}
                            shareMode={shareMode}
                            shareSelected={shareIds.has(m.id.toString()) || shareIds.has(m.id)}
                            onPress={openMatch}
                            onToggleShare={toggleShare}
                          />
                        </View>
                      );
                    })}
                  </ScrollView>
                )}
              </View>
            ))
          )}
        </View>
      </Animated.ScrollView>

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
  heroIconActive: { backgroundColor: C.accent, borderColor: C.ink },
  stickyCal: { paddingRight: S.lg, paddingVertical: 10, borderLeftWidth: 1.5, borderLeftColor: C.border, paddingLeft: 10, justifyContent: 'center' },

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
  sectionTitle: { fontFamily: FONTS.extraBold, fontSize: 17, color: C.text, flex: 1 },
  sectionCount: { fontFamily: FONTS.monoMedium, fontSize: 11.5, color: C.textMuted, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.ink, paddingHorizontal: 8, paddingVertical: 2, borderRadius: R.pill, overflow: 'hidden' },
  moreHint: { fontFamily: FONTS.monoMedium, fontSize: 11, color: C.textFaint, letterSpacing: 0.5, marginRight: 6 },

  cardDivider: { borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: C.border, marginVertical: 10 },
  shareCheck: { position: 'absolute', top: 10, right: 10, width: 24, height: 24, borderWidth: 2, borderColor: C.ink, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  // ---- lomo vertical (carta tapada en el abanico)
  // 14px del lado izquierdo quedan bajo la carta anterior: el ancho y el
  // paddingLeft lo compensan para que el contenido se vea entero. La sombra
  // va dibujada a mano en el render (derecha completa, inferior recortada).
  spine: {
    width: 96, alignItems: 'center',
    backgroundColor: C.surface, borderWidth: 2, borderColor: C.ink,
    paddingVertical: 8, paddingLeft: 20, paddingRight: 6, gap: 4,
  },
  spineSelected: { borderColor: C.accentStrong, shadowColor: C.accentStrong },
  spineTime: { fontFamily: FONTS.black, fontSize: 16, color: C.text, letterSpacing: 0.3 },
  spineCount: { fontFamily: FONTS.monoMedium, fontSize: 11.5, letterSpacing: 0.3 },
  spineTitle: { fontFamily: FONTS.bold, fontSize: 14.5, color: C.text, letterSpacing: 0.2 },
  spineMeta: { fontFamily: FONTS.monoMedium, fontSize: 10, color: C.textMuted, letterSpacing: 0.3 },
  spinePrice: { fontFamily: FONTS.monoMedium, fontSize: 11.5, color: C.text, marginTop: 2 },
  spineYou: { width: 18, height: 18, backgroundColor: C.accent, borderWidth: 1.5, borderColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  shareCheckStrip: { width: 20, height: 20, borderWidth: 2, borderColor: C.ink, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' },
  // ---- ficha (carta destapada)
  fichaHora: { fontFamily: FONTS.black, fontSize: 34, lineHeight: 36, color: C.text, letterSpacing: 0.5 },
  fichaFecha: { fontFamily: FONTS.monoMedium, fontSize: 11.5, letterSpacing: 1.6, color: C.textMuted, textTransform: 'uppercase', marginTop: 2 },
  fichaTitle: { fontFamily: FONTS.extraBold, fontSize: 17, color: C.text, letterSpacing: -0.3, marginTop: 8 },
  verFicha: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.ink,
    paddingHorizontal: 9, paddingVertical: 4, backgroundColor: 'transparent',
  },
  verFichaText: { fontFamily: FONTS.extraBold, fontSize: 10.5, color: C.text, letterSpacing: 0.8, textTransform: 'uppercase' },
  fichaCount: { fontFamily: FONTS.monoMedium, fontSize: 13.5, letterSpacing: 0.5 },
  fichaPrice: { fontFamily: FONTS.monoMedium, fontSize: 17, color: C.text },
  fichaEur: { fontSize: 10.5, color: C.textMuted, letterSpacing: 0.5 },
  // en la banda media derecha: no tapa ni la hora ni el badge/VER
  stamp: {
    position: 'absolute', right: 12, top: 96, zIndex: 5,
    borderWidth: 2.5, borderColor: C.danger, backgroundColor: C.surface,
    paddingHorizontal: 10, paddingVertical: 3,
    transform: [{ rotate: '-8deg' }],
  },
  stampText: { fontFamily: FONTS.black, fontSize: 15, color: C.danger, letterSpacing: 1.5, textTransform: 'uppercase' },
  // ---- puntitos de alineación
  dotsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 3, alignItems: 'center' },
  dot: { width: 9, height: 9, borderRadius: 4.5 },
  dotFilled: { backgroundColor: C.brand, borderWidth: 1, borderColor: C.brandDeep },
  dotMine: { backgroundColor: C.accent, borderWidth: 1.5, borderColor: C.ink },
  dotFree: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: C.textFaint },

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
