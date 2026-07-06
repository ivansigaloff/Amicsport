import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, Platform, Linking, Alert } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { shareMatch } from '../../../lib/share';
import { useMatch } from '../../../hooks/match/useMatch';
import { useMatchActions } from '../../../hooks/match/useMatchActions';
import { Button, Badge, PressableScale, AnimatedEntrance, C, FONTS, GRADIENTS, R, S, SHADOW, screenBg, webOnly } from '../../../components/v2/ui';
import GPSMatchViewer from '../../../components/v2/GPSMatchViewer';
// Componentes de gestión de v1 (ya restilados vía constants/theme): lista de
// participantes con vista compacta/normal, filtros, pagado, check-in,
// camisetas y dorsal del tracker; panel admin con inscribir desde agenda,
// sincronización GPS, horas reales y borrado.
import MatchParticipantsList from '../../../components/match/MatchParticipantsList';
import MatchAdminPanel from '../../../components/match/MatchAdminPanel';

const identity = (tbl: string) => tbl;
type IconName = React.ComponentProps<typeof Ionicons>['name'];

// ----------------------------------------------------------------- screen
export default function V2MatchDetail() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [refreshing, setRefreshing] = useState(false);
  const [compact, setCompact] = useState(true); // vista compacta/normal de la lista (admin)
  const [showGps, setShowGps] = useState(false); // rendimiento GPS plegado por defecto

  const matchData = useMatch(id, 'prod', identity);
  const { match, loading, fetchData, participantsList, isFull, isAdmin, userId, isStarted, isOver, cancellationDeadline, formattedDate, joined, myUserName, activeCount, waitlistCount } = matchData as any;
  const actions = useMatchActions(matchData as any, identity, '', 'prod', () => fetchData());
  const { toggleJoin, addGuest, removeParticipant, acting, initiatePayment, executeDelete } = actions;

  const onRefresh = async () => { setRefreshing(true); await fetchData(); setRefreshing(false); };

  const handleCancelSpot = async () => {
    actions.setActing(true);
    const myGuests = participantsList.filter((p: any) => !p.user_id && p.user_name?.startsWith(`${myUserName} (invitado`));
    if (myGuests.length > 0) await removeParticipant(myGuests[myGuests.length - 1]);
    else await toggleJoin();
    actions.setActing(false);
  };

  const openMaps = () => { if (!match?.location_url) return; if (Platform.OS === 'web') window.open(match.location_url, '_blank'); else Linking.openURL(match.location_url); };

  if (loading && !match) {
    return <View style={styles.center}><ActivityIndicator size="large" color={C.brand} /></View>;
  }
  if (!match) {
    return (
      <View style={styles.center}>
        <Ionicons name="alert-circle-outline" size={48} color={C.textFaint} />
        <Text style={styles.notFound}>{t('match_details.not_found')}</Text>
        <Button title={t('common.back')} variant="outline" onPress={() => router.replace('/v2' as any)} />
      </View>
    );
  }

  const joinedDisplay = (match.joined_players || 0) + activeCount;
  const spots = match.max_players - joinedDisplay;
  const pct = Math.min(100, Math.round((joinedDisplay / match.max_players) * 100));
  const isPaid = match.requires_payment && match.price > 0;

  return (
    <View style={{ flex: 1, backgroundColor: screenBg }}>
      <ScrollView
        showsVerticalScrollIndicator
        contentContainerStyle={{ paddingBottom: 150 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.brand} colors={[C.brand]} />}
      >
        {/* Hero */}
        <View style={styles.hero}>
          {match.image_url ? (
            <Image source={{ uri: match.image_url }} style={StyleSheet.absoluteFill as any} contentFit="cover" transition={250} />
          ) : (
            <LinearGradient colors={GRADIENTS.inkBrand as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill as any} />
          )}
          <LinearGradient colors={['rgba(12,31,20,0.15)', 'rgba(12,31,20,0.9)']} style={StyleSheet.absoluteFill as any} />

          <SafeAreaView edges={['top']} style={styles.heroBar}>
            <PressableScale onPress={() => router.back()} style={styles.circleBtn}><Ionicons name="arrow-back" size={20} color="#fff" /></PressableScale>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <PressableScale onPress={() => shareMatch(match)} style={styles.circleBtn}><Ionicons name="share-outline" size={19} color="#fff" /></PressableScale>
              {isAdmin && <PressableScale onPress={() => router.push(`/v2/admin/crear-partido?editId=${id}` as any)} style={styles.circleBtn}><Ionicons name="pencil" size={18} color="#fff" /></PressableScale>}
            </View>
          </SafeAreaView>

          <AnimatedEntrance distance={18} style={styles.heroContent}>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {isOver && <Badge tone="ink" label={t('matches.finished', 'Finalizado')} />}
              {isStarted && !isOver && <Badge tone="warning" label={t('matches.in_progress', 'En curso')} />}
              {match.is_female && <Badge tone="brand" label={t('common.female')} />}
              {match.is_advanced && <Badge tone="lime" label={t('common.advanced')} icon="trophy" />}
              {match.level && <Badge tone="neutral" label={match.level} />}
            </View>
            <Text style={styles.heroTitle}>{match.title || match.venue}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
              <Ionicons name="location" size={15} color="rgba(255,255,255,0.85)" />
              <Text style={styles.heroVenue}>{match.venue}</Text>
            </View>
          </AnimatedEntrance>
        </View>

        <View style={styles.body}>
          {/* Quick facts */}
          <AnimatedEntrance index={0} style={styles.facts}>
            <Fact icon="calendar-outline" label={formattedDate} />
            <View style={styles.factDivider} />
            <Fact icon="time-outline" label={match.time} />
            <View style={styles.factDivider} />
            <Fact icon="pricetag-outline" label={`${Number(match.price).toFixed(2)}€`} highlight />
          </AnimatedEntrance>

          {/* Capacity */}
          <AnimatedEntrance index={1}>
            <View style={styles.capCard}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <Text style={styles.capTitle}>{t('match_details.players', 'Jugadores')}</Text>
                <Text style={styles.capCount}>{joinedDisplay}<Text style={styles.capMax}> / {match.max_players}</Text></Text>
              </View>
              <View style={styles.capBarBg}>
                <View style={[styles.capBarFill, { width: `${pct}%`, backgroundColor: spots <= 0 ? C.availFull : pct >= 75 ? C.availLow : C.availFree }]} />
              </View>
              <Text style={styles.capNote}>
                {spots > 0 ? `${spots} ${t('match_details.spots_left', 'plazas libres')}` : (t('match_details.reservation_limit', 'Completo'))}
                {waitlistCount > 0 ? ` · ${waitlistCount} ${t('match_details.in_waitlist', 'en espera')}` : ''}
              </Text>
            </View>
          </AnimatedEntrance>

          {/* Location */}
          {match.location_url && (
            <AnimatedEntrance index={2}>
              <PressableScale onPress={openMaps} style={styles.locCard}>
                <View style={styles.locIcon}><Ionicons name="navigate" size={20} color={C.brandDeep} /></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.locTitle}>{match.venue}</Text>
                  <Text style={styles.locSub}>{t('match_details.how_to_get', 'Cómo llegar')}</Text>
                </View>
                <Ionicons name="open-outline" size={18} color={C.textFaint} />
              </PressableScale>
            </AnimatedEntrance>
          )}

          {/* Participants — lista completa de v1 (compacta/normal, filtros,
              pagado, check-in, camisetas, dorsal del tracker) */}
          <AnimatedEntrance index={3} style={{ marginTop: S.xl }}>
            <MatchParticipantsList
              match={match}
              participantsList={participantsList}
              isFull={isFull}
              isAdmin={isAdmin}
              userId={userId}
              removeParticipant={removeParticipant}
              removeDummyPlayer={actions.removeDummyPlayer}
              setCheckin={actions.setCheckin}
              setShirtColor={actions.setShirtColor}
              setPaid={actions.setPaid}
              setDeviceNumber={actions.setDeviceNumber}
              compact={compact}
              setCompact={setCompact}
            />
          </AnimatedEntrance>

          {/* GPS Track Viewer — plegado tras el botón «Ver rendimiento GPS» */}
          <AnimatedEntrance index={4} style={{ marginTop: S.xl }}>
            <Button
              title={showGps ? t('match_details.hide_gps', 'Ocultar rendimiento GPS') : t('match_details.view_gps', 'Ver rendimiento GPS')}
              icon={showGps ? 'chevron-up' : 'speedometer-outline'}
              variant="outline"
              size="md"
              full
              onPress={() => setShowGps((v) => !v)}
            />
            {showGps && <GPSMatchViewer matchId={id} />}
          </AnimatedEntrance>

          {/* Admin */}
          {isAdmin && (
            <AnimatedEntrance index={5} style={{ marginTop: S.xl, gap: 10 }}>
              <Text style={styles.sectionTitle}>{t('match_details.admin', 'Administración')}</Text>
              <Button title={t('common.edit', 'Editar')} icon="pencil" variant="ink" size="md" full onPress={() => router.push(`/v2/admin/crear-partido?editId=${id}` as any)} />
              {/* panel v1: inscribir desde agenda, sincronizar GPS, horas reales, eliminar */}
              <MatchAdminPanel
                match={match}
                isAdmin={isAdmin}
                isStarted={isStarted}
                participantsList={participantsList}
                setParticipantsList={(matchData as any).setParticipantsList}
                executeDelete={() => executeDelete(true, () => router.replace('/v2' as any))}
                fromTable={identity}
                showAlert={actions.showAlert}
                onMutate={() => fetchData()}
              />
            </AnimatedEntrance>
          )}
        </View>
      </ScrollView>

      {/* Action bar */}
      <View style={[styles.actionBar, { paddingBottom: Math.max(insets.bottom, 14) }, webOnly({ position: 'fixed' } as any)]}>
        <View>
          <Text style={styles.barPrice}>{Number(match.price).toFixed(2)}€</Text>
          <Text style={styles.barSub}>{t('match_details.price_per_player', 'por jugador')}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: S.lg, alignItems: 'flex-end' }}>
          {isOver ? (
            <Button title={t('match_details.match_finished', 'Finalizado')} variant="outline" disabled full size="lg" />
          ) : isStarted ? (
            <Button title={t('match_details.match_started', 'En curso')} variant="outline" disabled full size="lg" />
          ) : joined ? (
            <View style={{ flexDirection: 'row', gap: 8, width: '100%', justifyContent: 'flex-end' }}>
              <Button icon="person-add" variant="ink" size="lg" onPress={addGuest} disabled={acting || isFull} />
              <Button title={t('match_details.cancel_spot', 'Cancelar')} icon="close" variant="danger" size="lg" onPress={handleCancelSpot} loading={acting} />
            </View>
          ) : (
            <Button
              title={isFull ? (t('match_details.join_waitlist', 'Lista de espera')) : isPaid ? (t('match_details.pay_spot', 'Pagar plaza')) : (t('match_details.reserve_btn', 'Apuntarme'))}
              icon={isPaid ? 'card' : 'flash'}
              variant="brand"
              size="lg"
              full
              loading={acting}
              onPress={isPaid ? initiatePayment : toggleJoin}
            />
          )}
          {joined && cancellationDeadline && (
            <Text style={[styles.deadline, cancellationDeadline.isPast && { color: C.danger }]}>
              {cancellationDeadline.isPast ? (t('match_details.no_changes', 'Ya no puedes hacer cambios')) : `${t('match_details.changes_until', 'Cambios hasta')} ${cancellationDeadline.date} · ${cancellationDeadline.time}`}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

function Fact({ icon, label, highlight }: { icon: IconName; label: string; highlight?: boolean }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 5 }}>
      <Ionicons name={icon} size={18} color={highlight ? C.brandDeep : C.textMuted} />
      <Text style={[styles.factText, highlight && { color: C.brandDeep, fontFamily: FONTS.monoMedium }]} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: screenBg, padding: S.xl },
  notFound: { color: C.textMuted, fontFamily: FONTS.bold, fontSize: 16 },

  hero: { height: 280, justifyContent: 'flex-end' },
  heroBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: S.lg, paddingTop: Platform.OS === 'web' ? S.lg : 0 },
  circleBtn: { width: 40, height: 40, backgroundColor: 'rgba(13,32,21,0.5)', borderWidth: 1.5, borderColor: 'rgba(244,250,240,0.5)', alignItems: 'center', justifyContent: 'center', ...webOnly({ backdropFilter: 'blur(6px)' } as any) },
  heroContent: { padding: S.xl, paddingBottom: S.xxl },
  heroTitle: { color: '#fff', fontSize: 30, fontFamily: FONTS.black, letterSpacing: 0.5, textTransform: 'uppercase' },
  heroVenue: { color: 'rgba(255,255,255,0.85)', fontSize: 14, fontFamily: FONTS.medium },

  body: { paddingHorizontal: S.lg, marginTop: -18, maxWidth: 760, width: '100%', alignSelf: 'center' },
  facts: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: R.lg, paddingVertical: S.lg, borderWidth: 2, borderColor: C.ink, ...SHADOW.md },
  factDivider: { width: 1.5, height: 32, backgroundColor: C.border },
  factText: { fontFamily: FONTS.bold, fontSize: 13, color: C.text, textTransform: 'capitalize' },

  capCard: { backgroundColor: C.surface, borderRadius: R.lg, padding: S.lg, marginTop: S.md, borderWidth: 2, borderColor: C.ink, ...SHADOW.sm },
  capTitle: { fontFamily: FONTS.monoMedium, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: C.textMuted },
  capCount: { fontFamily: FONTS.black, fontSize: 22, letterSpacing: 0.5, color: C.text },
  capMax: { fontFamily: FONTS.bold, fontSize: 14, color: C.textFaint },
  capBarBg: { height: 12, backgroundColor: C.bgAlt, borderWidth: 1.5, borderColor: C.ink, overflow: 'hidden' },
  capBarFill: { height: '100%' },
  capNote: { marginTop: 8, fontFamily: FONTS.monoMedium, fontSize: 11.5, color: C.textMuted },

  locCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: R.lg, padding: S.lg, marginTop: S.md, borderWidth: 1.5, borderColor: C.ink, ...SHADOW.sm },
  locIcon: { width: 44, height: 44, borderRadius: R.sm, backgroundColor: C.brandWash, alignItems: 'center', justifyContent: 'center' },
  locTitle: { fontFamily: FONTS.bold, fontSize: 15, color: C.text },
  locSub: { fontFamily: FONTS.medium, fontSize: 12.5, color: C.textMuted, marginTop: 1 },

  sectionTitle: { fontFamily: FONTS.extraBold, fontSize: 18, color: C.text },
  sectionCount: { fontFamily: FONTS.monoMedium, fontSize: 12, color: C.textMuted, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.ink, paddingHorizontal: 9, paddingVertical: 2, borderRadius: R.pill, overflow: 'hidden' },
  emptyP: { fontFamily: FONTS.medium, fontSize: 14, color: C.textFaint, fontStyle: 'italic', paddingVertical: 10 },

  pRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: R.md, borderWidth: 1.5, ...SHADOW.sm },
  pAvatar: { width: 38, height: 38, borderWidth: 1.5, borderColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  pAvatarText: { fontFamily: FONTS.black, fontSize: 16, color: C.brandDeep },
  pName: { fontFamily: FONTS.bold, fontSize: 14.5 },
  pBtn: { width: 32, height: 32, backgroundColor: C.surfaceAlt, alignItems: 'center', justifyContent: 'center' },

  actionBar: { bottom: 0, left: 0, right: 0, position: 'absolute', backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', paddingHorizontal: S.xl, paddingTop: S.lg, borderTopWidth: 2, borderTopColor: C.ink, ...SHADOW.lg, zIndex: 100 },
  barPrice: { fontFamily: FONTS.monoMedium, fontSize: 22, color: C.text },
  barSub: { fontFamily: FONTS.regular, fontSize: 11, color: C.textMuted },
  deadline: { fontSize: 10.5, color: C.textFaint, marginTop: 5, textAlign: 'right', fontStyle: 'italic' },
});
