import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, Alert, ActivityIndicator, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { COLORS, SHADOWS, FONTS } from '../../constants/theme';

type SectionKey = 'unassigned' | 'white' | 'black';
type Tri = 'all' | 'yes' | 'no';
type Filters = { checkin: Tri; paid: Tri; white: boolean; black: boolean; unassigned: boolean; waitlist: boolean };

const DISABLED = COLORS.TEXT_LIGHT;

// Manual "paid" is only available while payments are in test mode (in production
// Monei is the source of truth). Flip via EXPO_PUBLIC_PAYMENTS_TEST_MODE=false.
const PAYMENTS_TEST_MODE = process.env.EXPO_PUBLIC_PAYMENTS_TEST_MODE !== 'false';

// Tooltip + a11y label. react-native-web (0.21) does not forward `title`, so set
// the native browser tooltip on the DOM node via ref on web; aria-label applies
// on every platform. Native gets no ref (no-op).
const tip = (label: string): any =>
  Platform.OS === 'web'
    ? { accessibilityLabel: label, ref: (el: any) => { try { if (el && el.setAttribute) el.setAttribute('title', label); } catch {} } }
    : { accessibilityLabel: label };

// Unassigned rows get light diagonal grey stripes. react-native-web doesn't
// support `backgroundImage` in StyleSheet, so set it on the DOM node via ref on
// web (and clear it when the row is no longer unassigned). No-op on native.
const UNASSIGNED_STRIPES = 'repeating-linear-gradient(45deg, rgba(100,116,139,0.14) 0, rgba(100,116,139,0.14) 6px, transparent 6px, transparent 12px)';
const stripeRef = (on: boolean): any =>
  Platform.OS === 'web'
    ? { ref: (el: any) => { try { if (el && el.style) el.style.backgroundImage = on ? UNASSIGNED_STRIPES : 'none'; } catch {} } }
    : {};

// Visual identity per color: tinted row background + left accent strip + text
// colors (the "negro" team uses a dark bg so text/icons flip to light).
const SECTION_STYLES: Record<SectionKey, { bg: string; accent: string; text: string; sub: string; divider: string }> = {
  unassigned: { bg: '#EFF2E4', accent: '#DDE3CE', text: COLORS.TEXT_MAIN, sub: COLORS.TEXT_MUTED, divider: 'rgba(13,32,21,0.06)' },
  white:      { bg: '#FFFFFF', accent: '#84957F', text: COLORS.TEXT_MAIN, sub: COLORS.TEXT_MUTED, divider: 'rgba(13,32,21,0.06)' },
  black:      { bg: '#1C3D28', accent: '#0D2015', text: '#FFFFFF', sub: '#84957F', divider: 'rgba(255,255,255,0.08)' },
};

const colorOf = (p: any): SectionKey => (p.shirt_color === 'white' ? 'white' : p.shirt_color === 'black' ? 'black' : 'unassigned');

// A header filter chip: icon + count. `tone` drives the highlight — 'sel'
// (selected color filter), 'on' (green = has attribute), 'neg' (red = lacks it),
// or 'off' (inactive).
function FilterChip({ icon, iconColor, count, tone = 'off', onPress, label }: any) {
  const toneStyle = tone === 'on' ? styles.fchipOn : tone === 'neg' ? styles.fchipNeg : tone === 'sel' ? styles.fchipActive : null;
  return (
    <TouchableOpacity onPress={onPress} style={[styles.fchip, toneStyle]} accessibilityRole="button" accessibilityState={{ selected: tone !== 'off' }} {...tip(label)}>
      <Ionicons name={icon} size={18} color={iconColor} />
      <Text style={styles.fchipCount}>{count}</Text>
    </TouchableOpacity>
  );
}

// Platform-agnostic selector dropdown/sheet for tracker assignment.
function TrackerPicker({ value, onChange, availableOptions, p, t }: { value: number | null, onChange: (val: number | null) => void, availableOptions: number[], p: any, t: any }) {
  const options = [
    { label: 'Ninguno', value: null },
    ...availableOptions.map(id => ({ label: `GPS ${id}`, value: id }))
  ];

  // If the current value is not in the options (since it's assigned to this player,
  // it gets filtered out of availableOptions for others but must be visible here), we inject it.
  if (value !== null && !availableOptions.includes(value)) {
    options.splice(1, 0, { label: `GPS ${value}`, value });
  }

  if (Platform.OS === 'web') {
    return (
      <select
        value={value !== null ? String(value) : ''}
        onChange={(e) => {
          const val = e.target.value;
          onChange(val ? parseInt(val, 10) : null);
        }}
        style={{
          padding: '4px 8px',
          borderRadius: '8px',
          borderColor: '#DDE3CE',
          backgroundColor: '#FFFFFF',
          color: '#0D2015',
          fontFamily: 'Inter, sans-serif',
          fontSize: '13px',
          fontWeight: '600',
          cursor: 'pointer',
          outline: 'none',
          boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)'
        }}
      >
        {options.map(opt => (
          <option key={opt.value ?? 'none'} value={opt.value !== null ? String(opt.value) : ''}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  // On Native Mobile: render a styled pressable that triggers a native Alert select sheet
  const showNativeSelector = () => {
    const buttons = options.map(opt => ({
      text: opt.label,
      onPress: () => onChange(opt.value),
      style: opt.value === null ? 'destructive' : 'default' as any
    }));
    buttons.push({ text: 'Cancelar', onPress: () => {}, style: 'cancel' });

    Alert.alert(
      'Asignar GPS',
      `Selecciona un tracker para ${p.user_name}:`,
      buttons,
      { cancelable: true }
    );
  };

  return (
    <TouchableOpacity
      onPress={showNativeSelector}
      style={{
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 0,
        borderWidth: 1,
        borderColor: '#DDE3CE',
        backgroundColor: '#FFFFFF',
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4
      }}
    >
      <Text style={{ fontSize: 13, fontFamily: FONTS.BOLD, color: '#0D2015' }}>
        {value !== null ? `GPS ${value}` : 'Asignar'}
      </Text>
      <Ionicons name="chevron-down-outline" size={14} color="#4A6353" />
    </TouchableOpacity>
  );
}

// One compact player row, tinted by its color group. The management controls
// (check-in / shirt color / paid) are active for admins.
// «Nombre A.» con el sufijo de invitado reducido al mínimo
// («Ivan Sigaloff (invitado 2)» → «Ivan S. ·2», «... (invitado)» → «Ivan S. ·inv»).
const shortName = (full: string) => {
  if (!full) return full;
  const m = full.match(/^(.*?)\s*(\(.*\))?$/);
  const base = (m?.[1] || full).trim();
  const suffixRaw = m?.[2] || '';
  let suffix = '';
  if (suffixRaw) {
    const num = suffixRaw.match(/\d+/)?.[0];
    if (/invitado/i.test(suffixRaw)) suffix = num ? ` ·${num}` : ' ·inv';
    else suffix = ` ${suffixRaw}`;
  }
  const parts = base.split(/\s+/);
  const short = parts.length > 1 ? `${parts[0]} ${parts[1].charAt(0)}.` : base;
  return `${short}${suffix}`;
};

function PlayerRow({ p, sty, striped, userId, t, onRemove, setCheckin, setShirtColor, setPaid, isAdmin }: any) {
  const checkedIn = !!p.checked_in;
  const paid = !!p.paid;
  const color = p.shirt_color;
  const isSelf = p.user_id === userId;
  // La fila compacta es SIEMPRE de una línea: sin selector GPS (vive en la
  // vista ampliada) y con el nombre abreviado si la pantalla es estrecha.
  const { width } = useWindowDimensions();
  const narrow = width < 560;
  const rawName = `${p.user_name}${isSelf ? ` (${t('match_details.self_joined')})` : ''}`;
  const displayName = narrow ? shortName(rawName) : rawName;

  return (
    <View style={[styles.playerRow, { backgroundColor: sty.bg, borderLeftColor: sty.accent, borderBottomColor: sty.divider }]} {...stripeRef(striped)}>
      <TouchableOpacity onPress={() => setCheckin(p, !checkedIn)} style={styles.iconBtn} {...tip(t('match_details.manage.checkin'))}>
        <Ionicons name={checkedIn ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={checkedIn ? COLORS.SUCCESS : DISABLED} />
      </TouchableOpacity>

      <View style={styles.miniAvatar}>
        <Text style={styles.miniAvatarText}>{p.user_name?.charAt(0).toUpperCase() || 'P'}</Text>
      </View>

      <Text style={[styles.playerName, { color: sty.text }]} numberOfLines={1}>{displayName}</Text>

      <View style={styles.colorPick}>
        <TouchableOpacity onPress={() => setShirtColor(p, color === 'white' ? null : 'white')} style={[styles.colorChip, styles.colorChipWhite, color === 'white' && styles.colorChipActive]} {...tip(t('match_details.manage.section_white'))}>
          <Text style={[styles.colorChipText, { color: '#0D2015' }]}>B</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setShirtColor(p, color === 'black' ? null : 'black')} style={[styles.colorChip, styles.colorChipBlack, color === 'black' && styles.colorChipActive]} {...tip(t('match_details.manage.section_black'))}>
          <Text style={[styles.colorChipText, { color: '#FFFFFF' }]}>N</Text>
        </TouchableOpacity>
      </View>

      {PAYMENTS_TEST_MODE && (
        <TouchableOpacity onPress={() => setPaid(p, !paid)} style={styles.iconBtn} {...tip(t('match_details.manage.paid'))}>
          <Ionicons name={paid ? 'cash' : 'cash-outline'} size={20} color={paid ? COLORS.SUCCESS : DISABLED} />
        </TouchableOpacity>
      )}

      {onRemove && (
        <TouchableOpacity onPress={onRemove} style={styles.iconBtn} {...tip(t('match_details.manage.remove'))}>
          <Ionicons name="trash-outline" size={16} color={COLORS.DANGER} />
        </TouchableOpacity>
      )}
    </View>
  );
}

// Waiting list: numbered FIFO rows (created_at order), shown below the active
// players. Admins get a remove control; everyone sees their position.
function WaitlistSection({ waiting, isAdmin, userId, removeParticipant, t }: any) {
  if (!waiting || waiting.length === 0) return null;
  const ordered = [...waiting].sort((a: any, b: any) => (a.created_at || '').localeCompare(b.created_at || ''));
  return (
    <View style={styles.waitlistWrap}>
      <View style={styles.waitlistHeader}>
        <Ionicons name="time-outline" size={16} color={COLORS.TEXT_MUTED} />
        <Text style={styles.waitlistTitle}>{t('match_details.waitlist_title')}</Text>
        <View style={styles.waitlistCountBadge}>
          <Text style={styles.waitlistCountText}>{waiting.length}</Text>
        </View>
      </View>
      <View style={styles.sectionsWrap}>
        {ordered.map((p: any, idx: number) => {
          const isSelf = p.user_id === userId;
          return (
            <View key={p.id || idx} style={[styles.playerRow, styles.waitlistRow]}>
              <View style={styles.waitlistPos}><Text style={styles.waitlistPosText}>{idx + 1}</Text></View>
              <View style={styles.miniAvatar}>
                <Text style={styles.miniAvatarText}>{p.user_name?.charAt(0).toUpperCase() || 'P'}</Text>
              </View>
              <Text style={[styles.playerName, { color: COLORS.TEXT_MAIN }]} numberOfLines={1}>
                {p.user_name}{isSelf ? ` (${t('match_details.self_joined')})` : ''}
              </Text>
              {isAdmin && (
                <TouchableOpacity onPress={() => removeParticipant(p)} style={styles.iconBtn} {...tip(t('match_details.manage.remove'))}>
                  <Ionicons name="trash-outline" size={16} color={COLORS.DANGER} />
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

export default function MatchParticipantsList({ match, participantsList, isFull, isAdmin, userId, removeParticipant, removeDummyPlayer, setCheckin, setShirtColor, setPaid, setDeviceNumber, compact = true, setCompact }: any) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<Filters>({ checkin: 'all', paid: 'all', white: false, black: false, unassigned: false, waitlist: false });

  // State for discovered/scanned trackers
  const [scanning, setScanning] = useState(false);
  const [scannedTrackers, setScannedTrackers] = useState<number[]>([]);
  const [hasScannedRealTrackers, setHasScannedRealTrackers] = useState(false);

  if (!match) return null;

  // Split active players from the waiting list. `list` keeps meaning "active"
  // for all the counters/filtering below; waitlisted players are shown apart and
  // never count toward the capacity badge.
  const allRows = participantsList || [];
  const list = allRows.filter((p: any) => !p.waitlist);
  const waiting = allRows.filter((p: any) => p.waitlist);
  const waitlistCount = waiting.length;
  const dummyCount = match.joined_players || 0;
  const total = list.length + dummyCount;

  const checkinCount = list.filter((p: any) => p.checked_in).length;
  const paidCount = list.filter((p: any) => p.paid).length;
  const whiteCount = list.filter((p: any) => p.shirt_color === 'white').length;
  const blackCount = list.filter((p: any) => p.shirt_color === 'black').length;
  const unassignedCount = list.filter((p: any) => !p.shirt_color).length + dummyCount;

  const useCompact = isAdmin && compact;

  // Player counter badge
  const maxP = match.max_players || 0;
  const ratio = maxP > 0 ? total / maxP : 0;
  const badgeFull = maxP > 0 && total >= maxP;
  const badgeWarn = !badgeFull && ratio > 0.8;
  const badgeBg = badgeFull ? COLORS.DANGER_LIGHT : badgeWarn ? COLORS.WARNING_LIGHT : '#E1EDDA';
  const badgeFg = badgeFull ? COLORS.DANGER : badgeWarn ? '#8A6700' : COLORS.SUCCESS;

  const header = (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{t('match_details.joined_list_title')}</Text>
      <View style={styles.headerRight}>
        {isAdmin && setCompact && (
          <TouchableOpacity onPress={() => setCompact((c: boolean) => !c)} style={styles.modeToggle} accessibilityRole="button" {...tip(compact ? t('match_details.manage.expanded') : t('match_details.manage.compact'))}>
            <Ionicons name={compact ? 'expand-outline' : 'contract-outline'} size={15} color={COLORS.TEXT_MUTED} />
            <Text style={styles.modeToggleText}>{compact ? t('match_details.manage.expanded') : t('match_details.manage.compact')}</Text>
          </TouchableOpacity>
        )}
        <View style={[styles.countBadge, { backgroundColor: badgeBg }]}>
          <Text style={[styles.countBadgeText, { color: badgeFg }]}>{badgeFull ? t('match_details.manage.full') : `${total}/${maxP}`}</Text>
        </View>
      </View>
    </View>
  );

  // BLE Scan handler
  const startScan = async () => {
    if (scanning) return;
    setScanning(true);
    setScannedTrackers([]);
    setHasScannedRealTrackers(false);
    try {
      if (Platform.OS === 'web' && (navigator as any).bluetooth) {
        if ((navigator as any).bluetooth.requestLEScan) {
          const scan = await (navigator as any).bluetooth.requestLEScan({
            filters: [{ namePrefix: 'AmicSport_Tracker_' }, { namePrefix: 'AmicSport_' }]
          });
          
          const listener = (event: any) => {
            const name = event.device.name || "";
            const matchResult = name.match(/AmicSport_Tracker_(\d+)/) || name.match(/AmicSport_(\d+)/);
            if (matchResult) {
              const id = parseInt(matchResult[1], 10);
              setScannedTrackers((prev) => {
                if (prev.includes(id)) return prev;
                return [...prev, id].sort((a, b) => a - b);
              });
              setHasScannedRealTrackers(true);
            }
          };

          (navigator as any).bluetooth.addEventListener('advertisementreceived', listener);

          setTimeout(() => {
            (navigator as any).bluetooth.removeEventListener('advertisementreceived', listener);
            scan.stop();
            setScanning(false);
          }, 8000);
        } else {
          // Fallback if requestLEScan not enabled: trigger requestDevice to select one
          const device = await (navigator as any).bluetooth.requestDevice({
            filters: [{ namePrefix: 'AmicSport_Tracker_' }, { namePrefix: 'AmicSport_' }],
            optionalServices: ['6e400001-b5a3-f393-e0a9-e50e24dcca9e']
          });
          const name = device.name || "";
          const matchResult = name.match(/AmicSport_Tracker_(\d+)/) || name.match(/AmicSport_(\d+)/);
          if (matchResult) {
            const id = parseInt(matchResult[1], 10);
            setScannedTrackers((prev) => {
              if (prev.includes(id)) return prev;
              return [...prev, id].sort((a, b) => a - b);
            });
            setHasScannedRealTrackers(true);
          }
          setScanning(false);
        }
      } else {
        setScanning(false);
        if (Platform.OS === 'web') {
          alert("Tu navegador no soporta BLE Scanning. Se ha cargado la lista de trackers por defecto (1-20).");
        } else {
          Alert.alert("Escanear Trackers", "BLE Scanning requiere un cliente web compatible. Se ha cargado la lista de trackers por defecto (1-20).");
        }
      }
    } catch (err) {
      console.error(err);
      setScanning(false);
    }
  };

  // Compute available options: tracker pool minus already assigned IDs (except the player's own assigned ID)
  const assignedTrackers = (participantsList || [])
    .map((p: any) => p.device_number)
    .filter((num: any) => num != null) as number[];
  const realTrackers = Array.from(new Set([...scannedTrackers, ...assignedTrackers])).sort((a, b) => a - b);
  const hasRealTrackers = hasScannedRealTrackers || assignedTrackers.length > 0;

  const trackerPool = hasRealTrackers ? realTrackers : Array.from({ length: 20 }, (_, i) => i + 1);
  const assignedIds = list
    .map((p: any) => p.device_number)
    .filter((num: any) => num != null) as number[];
  const availableTrackerOptions = trackerPool.filter(id => !assignedIds.includes(id));

  // Non-admin, or admin in expanded mode → original simple list.
  if (!useCompact) {
    return (
      <View style={styles.section}>
        {header}
        <View style={styles.participantsContainer}>
          {list.map((p: any, index: number) => (
            <View key={p.id || index} style={[styles.participantItem, SHADOWS.SMALL as any]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarText}>{p.user_name?.charAt(0).toUpperCase() || 'P'}</Text>
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.participantName}>{p.user_name}</Text>
                <Text style={styles.participantStatus}>
                  {p.user_id === userId ? t('match_details.self_joined') : t('match_details.confirmed_badge')}
                  {p.device_number != null ? ` · GPS ${p.device_number}` : ''}
                </Text>
              </View>
              {isAdmin && setDeviceNumber && (
                <View style={{ marginRight: 8 }}>
                  <TrackerPicker
                    value={p.device_number ?? null}
                    onChange={(val: number | null) => setDeviceNumber(p, val)}
                    availableOptions={availableTrackerOptions}
                    p={p}
                    t={t}
                  />
                </View>
              )}
              {isAdmin && p.user_id !== userId && (
                <TouchableOpacity onPress={() => removeParticipant(p)} style={styles.removeBtn}>
                  <Ionicons name="trash-outline" size={18} color={COLORS.DANGER} />
                </TouchableOpacity>
              )}
            </View>
          ))}
          {Array.from({ length: dummyCount }).map((_, i) => (
            <View key={`dummy-${i}`} style={[styles.participantItem, SHADOWS.SMALL as any, { opacity: 0.8 }]}>
              <View style={[styles.avatar, { backgroundColor: COLORS.BORDER }]}>
                <Ionicons name="person" size={20} color={COLORS.TEXT_LIGHT} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={[styles.participantName, { color: COLORS.TEXT_MUTED }]}>{t('match_details.external_player')}</Text>
                <Text style={styles.participantStatus}>{t('match_details.verified_web')}</Text>
              </View>
              {isAdmin && (
                <TouchableOpacity onPress={removeDummyPlayer} style={styles.removeBtn}>
                  <Ionicons name="close" size={18} color={COLORS.DANGER} />
                </TouchableOpacity>
              )}
            </View>
          ))}
        </View>
        <WaitlistSection waiting={waiting} isAdmin={isAdmin} userId={userId} removeParticipant={removeParticipant} t={t} />
      </View>
    );
  }

  // ---- Compact admin field view ----
  const nextTri = (v: Tri): Tri => (v === 'all' ? 'yes' : v === 'yes' ? 'no' : 'all');
  const cycleTri = (key: 'checkin' | 'paid') => setFilters((s) => ({ ...s, [key]: nextTri(s[key]) }));
  const toggle = (key: 'white' | 'black' | 'unassigned') => setFilters((s) => {
    if (key === 'white') return { ...s, white: !s.white, black: false, unassigned: false };
    if (key === 'black') return { ...s, black: !s.black, white: false, unassigned: false };
    return { ...s, unassigned: !s.unassigned, white: false, black: false };
  });
  const toggleWaitlist = () => setFilters((s) => ({ ...s, waitlist: !s.waitlist }));

  const passes = (p: any) => {
    if (filters.checkin === 'yes' && !p.checked_in) return false;
    if (filters.checkin === 'no' && p.checked_in) return false;
    if (filters.paid === 'yes' && !p.paid) return false;
    if (filters.paid === 'no' && p.paid) return false;
    if (filters.white && p.shirt_color !== 'white') return false;
    if (filters.black && p.shirt_color !== 'black') return false;
    if (filters.unassigned && p.shirt_color) return false;
    return true;
  };
  const showDummies = filters.checkin !== 'yes' && filters.paid !== 'yes' && !filters.white && !filters.black;

  const visible = list.filter(passes);
  const ordered = [
    ...visible.filter((p: any) => colorOf(p) === 'unassigned'),
    ...visible.filter((p: any) => colorOf(p) === 'white'),
    ...visible.filter((p: any) => colorOf(p) === 'black'),
  ];

  const triTone = (s: Tri) => (s === 'yes' ? 'on' : s === 'no' ? 'neg' : 'off');
  const triColor = (s: Tri) => (s === 'yes' ? COLORS.SUCCESS : s === 'no' ? COLORS.DANGER : '#84957F');
  const checkinLabel = filters.checkin === 'yes' ? t('match_details.manage.filter_in') : filters.checkin === 'no' ? t('match_details.manage.filter_out') : t('match_details.manage.filter_all');
  const paidLabel = filters.paid === 'yes' ? t('match_details.manage.paid') : filters.paid === 'no' ? t('match_details.manage.not_paid') : t('match_details.manage.filter_all');

  return (
    <View style={styles.section}>
      {header}

      <View style={styles.fchipRow}>
        <FilterChip icon={filters.checkin === 'no' ? 'close-circle-outline' : 'checkmark-circle'} iconColor={triColor(filters.checkin)} count={checkinCount} tone={triTone(filters.checkin)} onPress={() => cycleTri('checkin')} label={checkinLabel} />
        {PAYMENTS_TEST_MODE && (
          <FilterChip icon={filters.paid === 'no' ? 'cash-outline' : 'cash'} iconColor={triColor(filters.paid)} count={paidCount} tone={triTone(filters.paid)} onPress={() => cycleTri('paid')} label={paidLabel} />
        )}
        <FilterChip icon="shirt-outline" iconColor="#2A5238" count={whiteCount} tone={filters.white ? 'sel' : 'off'} onPress={() => toggle('white')} label={t('match_details.manage.section_white')} />
        <FilterChip icon="shirt" iconColor="#0D2015" count={blackCount} tone={filters.black ? 'sel' : 'off'} onPress={() => toggle('black')} label={t('match_details.manage.section_black')} />
        <FilterChip icon="time-outline" iconColor="#84957F" count={waitlistCount} tone={filters.waitlist ? 'sel' : 'off'} onPress={toggleWaitlist} label={t('match_details.manage.waitlist')} />
      </View>

      {/* BLE Scanner activation bar */}
      {isAdmin && (
        <View style={styles.scanBar}>
          <Text style={styles.scanText}>
            {hasScannedRealTrackers
              ? `${scannedTrackers.length} trackers escaneados`
              : (assignedTrackers.length > 0
                  ? `${assignedTrackers.length} trackers asignados`
                  : "No se han escaneado trackers")}
          </Text>
          <TouchableOpacity
            onPress={startScan}
            disabled={scanning}
            style={[styles.scanBtn, scanning && { backgroundColor: COLORS.BORDER }]}
          >
            {scanning ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="scan-outline" size={16} color="#FFFFFF" />}
            <Text style={styles.scanBtnText}>
              {scanning ? "Escaneando..." : "Escanear Trackers"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {filters.waitlist ? (
        <WaitlistSection waiting={waiting} isAdmin={isAdmin} userId={userId} removeParticipant={removeParticipant} t={t} />
      ) : (
      <>
      <View style={styles.sectionsWrap}>
        {showDummies && Array.from({ length: dummyCount }).map((_, i) => {
          const sty = SECTION_STYLES.unassigned;
          return (
            <View key={`dummy-${i}`} style={[styles.playerRow, { backgroundColor: sty.bg, borderLeftColor: sty.accent, borderBottomColor: sty.divider }]} {...stripeRef(true)}>
              <View style={styles.iconBtn} />
              <View style={[styles.miniAvatar, { backgroundColor: COLORS.BORDER }]}>
                <Ionicons name="person" size={14} color={COLORS.TEXT_LIGHT} />
              </View>
              <Text style={[styles.playerName, { color: sty.sub }]} numberOfLines={1}>{t('match_details.external_player')}</Text>
              <TouchableOpacity onPress={removeDummyPlayer} style={styles.iconBtn} {...tip(t('match_details.manage.remove'))}>
                <Ionicons name="close" size={16} color={COLORS.DANGER} />
              </TouchableOpacity>
            </View>
          );
        })}

        {ordered.map((p: any, idx: number) => (
          <PlayerRow
            key={p.id || idx}
            p={p}
            sty={SECTION_STYLES[colorOf(p)]}
            striped={colorOf(p) === 'unassigned'}
            userId={userId}
            t={t}
            onRemove={p.user_id !== userId ? () => removeParticipant(p) : undefined}
            setCheckin={setCheckin}
            setShirtColor={setShirtColor}
            setPaid={setPaid}
            isAdmin={isAdmin}
          />
        ))}
      </View>
      <WaitlistSection waiting={waiting} isAdmin={isAdmin} userId={userId} removeParticipant={removeParticipant} t={t} />
      </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 20, paddingTop: 24 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MAIN },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modeToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 0, backgroundColor: COLORS.BORDER_LIGHT },
  modeToggleText: { fontSize: 11, fontFamily: FONTS.SEMI_BOLD, color: COLORS.TEXT_MUTED },
  countBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 0 },
  countBadgeText: { color: COLORS.TEXT_WHITE, fontSize: 14, fontFamily: FONTS.BOLD },

  // Original simple list
  participantsContainer: { gap: 12 },
  participantItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.CARD_BG, padding: 12, borderRadius: 0 },
  avatar: { width: 40, height: 40, borderRadius: 0, backgroundColor: COLORS.PRIMARY_LIGHT, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 18, fontFamily: FONTS.BOLD, color: COLORS.PRIMARY },
  participantName: { fontSize: 16, fontFamily: FONTS.SEMI_BOLD, color: COLORS.TEXT_MAIN },
  participantStatus: { fontSize: 12, fontFamily: FONTS.REGULAR, color: COLORS.SUCCESS },
  removeBtn: { padding: 8, backgroundColor: COLORS.DANGER_LIGHT, borderRadius: 0 },

  // Compact admin view — header filter chips (icon + count)
  fchipRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  fchip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: 9, borderRadius: 0, backgroundColor: COLORS.CARD_BG, borderWidth: 1.5, borderColor: COLORS.BORDER },
  fchipActive: { backgroundColor: COLORS.PRIMARY_LIGHT, borderColor: COLORS.PRIMARY },
  fchipOn: { backgroundColor: '#E1EDDA', borderColor: COLORS.SUCCESS },
  fchipNeg: { backgroundColor: COLORS.DANGER_LIGHT, borderColor: COLORS.DANGER },
  fchipCount: { fontSize: 15, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MAIN },

  // Scanner Bar style
  scanBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, backgroundColor: COLORS.CARD_BG, padding: 10, borderRadius: 0, borderWidth: 1, borderColor: COLORS.BORDER },
  scanText: { fontSize: 13, fontFamily: FONTS.SEMI_BOLD, color: COLORS.TEXT_MUTED },
  scanBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#17713A', paddingVertical: 6, paddingHorizontal: 12, borderRadius: 0, gap: 6 },
  scanBtnText: { fontSize: 13, fontFamily: FONTS.BOLD, color: '#FFFFFF' },

  // Compact admin view — continuous color-tinted rows (no section headers)
  sectionsWrap: { borderRadius: 0, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.BORDER },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 7, borderLeftWidth: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  miniAvatar: { width: 28, height: 28, borderRadius: 0, backgroundColor: COLORS.PRIMARY_LIGHT, justifyContent: 'center', alignItems: 'center' },
  miniAvatarText: { fontSize: 13, fontFamily: FONTS.BOLD, color: COLORS.PRIMARY },
  playerName: { flex: 1, fontSize: 14, fontFamily: FONTS.SEMI_BOLD },
  iconBtn: { padding: 5, minWidth: 30, alignItems: 'center', justifyContent: 'center' },
  disabledCtrl: { opacity: 0.4 },
  colorPick: { flexDirection: 'row', gap: 4 },
  colorChip: { width: 26, height: 26, borderRadius: 0, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  colorChipWhite: { backgroundColor: '#FFFFFF', borderColor: '#DDE3CE' },
  colorChipBlack: { backgroundColor: '#0D2015', borderColor: '#0D2015' },
  colorChipActive: { borderColor: COLORS.PRIMARY, borderWidth: 2 },
  colorChipText: { fontSize: 12, fontFamily: FONTS.BOLD },

  // Waiting list
  waitlistWrap: { marginTop: 16 },
  waitlistHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  waitlistTitle: { fontSize: 14, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MUTED, textTransform: 'uppercase', letterSpacing: 0.3 },
  waitlistCountBadge: { backgroundColor: COLORS.BORDER_LIGHT, borderRadius: 0, paddingHorizontal: 8, paddingVertical: 1 },
  waitlistCountText: { fontSize: 12, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MUTED },
  waitlistRow: { backgroundColor: '#FFFBEB', borderLeftColor: '#FFD54A', borderBottomColor: 'rgba(13,32,21,0.06)' },
  waitlistPos: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#FFD54A', justifyContent: 'center', alignItems: 'center' },
  waitlistPosText: { fontSize: 12, fontFamily: FONTS.BOLD, color: '#8A6700' },
});
