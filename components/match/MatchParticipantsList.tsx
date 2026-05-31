import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { COLORS, SHADOWS, FONTS } from '../../constants/theme';

type Filter = 'all' | 'in' | 'out';
type SectionKey = 'unassigned' | 'white' | 'black';

const DISABLED = COLORS.TEXT_LIGHT;

// Visual identity per color section: tinted background + left accent strip +
// swatch + text colors (the "negro" team uses a dark bg so text flips to white).
const SECTION_STYLES: Record<SectionKey, {
  bg: string; accent: string; text: string; sub: string;
  swatch: string; swatchBorder?: string; divider: string;
}> = {
  unassigned: { bg: '#F1F5F9', accent: '#94A3B8', text: COLORS.TEXT_MAIN, sub: COLORS.TEXT_MUTED, swatch: '#CBD5E1', divider: 'rgba(15,23,42,0.06)' },
  white:      { bg: '#FFFFFF', accent: '#CBD5E1', text: COLORS.TEXT_MAIN, sub: COLORS.TEXT_MUTED, swatch: '#FFFFFF', swatchBorder: '#CBD5E1', divider: 'rgba(15,23,42,0.06)' },
  black:      { bg: '#1E293B', accent: '#0F172A', text: '#FFFFFF', sub: '#94A3B8', swatch: '#0F172A', swatchBorder: '#475569', divider: 'rgba(255,255,255,0.08)' },
};

// One compact player row. The management controls (check-in / shirt color /
// paid) are rendered but DISABLED in this phase — they are wired up next.
function PlayerRow({ p, sty, userId, t, onRemove }: any) {
  const checkedIn = !!p.checked_in;
  const paid = !!p.paid;
  const color = p.shirt_color;
  const isSelf = p.user_id === userId;
  return (
    <View style={[styles.playerRow, { borderBottomColor: sty.divider }]}>
      <TouchableOpacity disabled style={[styles.iconBtn, styles.disabledCtrl]}>
        <Ionicons name={checkedIn ? 'checkmark-circle' : 'ellipse-outline'} size={22} color={checkedIn ? COLORS.SUCCESS : DISABLED} />
      </TouchableOpacity>

      <View style={styles.miniAvatar}>
        <Text style={styles.miniAvatarText}>{p.user_name?.charAt(0).toUpperCase() || 'P'}</Text>
      </View>

      <Text style={[styles.playerName, { color: sty.text }]} numberOfLines={1}>
        {p.user_name}{isSelf ? ` (${t('match_details.self_joined')})` : ''}
      </Text>

      <View style={[styles.colorPick, styles.disabledCtrl]}>
        <TouchableOpacity disabled style={[styles.colorChip, styles.colorChipWhite, color === 'white' && styles.colorChipActive]}>
          <Text style={[styles.colorChipText, { color: '#0F172A' }]}>B</Text>
        </TouchableOpacity>
        <TouchableOpacity disabled style={[styles.colorChip, styles.colorChipBlack, color === 'black' && styles.colorChipActive]}>
          <Text style={[styles.colorChipText, { color: '#FFFFFF' }]}>N</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity disabled style={[styles.iconBtn, styles.disabledCtrl]}>
        <Ionicons name={paid ? 'cash' : 'cash-outline'} size={20} color={paid ? COLORS.SUCCESS : DISABLED} />
      </TouchableOpacity>

      {onRemove && (
        <TouchableOpacity onPress={onRemove} style={styles.iconBtn}>
          <Ionicons name="trash-outline" size={16} color={COLORS.DANGER} />
        </TouchableOpacity>
      )}
    </View>
  );
}

function Counter({ swatch, swatchBorder, label, value }: any) {
  return (
    <View style={styles.counterItem}>
      <View style={[styles.swatch, { backgroundColor: swatch, borderColor: swatchBorder || 'transparent', borderWidth: swatchBorder ? 1 : 0 }]} />
      <Text style={styles.counterValue}>{value}</Text>
      <Text style={styles.counterLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

export default function MatchParticipantsList({ match, participantsList, isFull, isAdmin, userId, removeParticipant, removeDummyPlayer }: any) {
  const { t } = useTranslation();
  const [compact, setCompact] = useState(true);            // admins default to the compact field view
  const [filter, setFilter] = useState<Filter>('all');
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>({ unassigned: false, white: false, black: false });

  if (!match) return null;

  const list = participantsList || [];
  const dummyCount = match.joined_players || 0;
  const total = list.length + dummyCount;

  const whiteCount = list.filter((p: any) => p.shirt_color === 'white').length;
  const blackCount = list.filter((p: any) => p.shirt_color === 'black').length;
  const unassignedCount = list.filter((p: any) => !p.shirt_color).length + dummyCount;

  const useCompact = isAdmin && compact;

  const header = (
    <View style={styles.sectionHeader}>
      <Text style={styles.sectionTitle}>{t('match_details.joined_list_title')}</Text>
      <View style={styles.headerRight}>
        {isAdmin && (
          <TouchableOpacity onPress={() => setCompact((c) => !c)} style={styles.modeToggle} accessibilityRole="button">
            <Ionicons name={compact ? 'expand-outline' : 'contract-outline'} size={15} color={COLORS.TEXT_MUTED} />
            <Text style={styles.modeToggleText}>{compact ? t('match_details.manage.expanded') : t('match_details.manage.compact')}</Text>
          </TouchableOpacity>
        )}
        <View style={[styles.countBadge, { backgroundColor: isFull ? COLORS.DANGER : COLORS.SUCCESS }]}>
          <Text style={styles.countBadgeText}>{total}/{match.max_players}</Text>
        </View>
      </View>
    </View>
  );

  // Non-admin, or admin in expanded mode → keep the original simple list.
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
                <Text style={styles.participantStatus}>{p.user_id === userId ? t('match_details.self_joined') : t('match_details.confirmed_badge')}</Text>
              </View>
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
      </View>
    );
  }

  // ---- Compact admin field view ----
  const passesFilter = (p: any) => (filter === 'all' ? true : filter === 'in' ? !!p.checked_in : !p.checked_in);

  const sectionData: { key: SectionKey; label: string; count: number; rows: any[]; dummies: number }[] = [
    {
      key: 'unassigned',
      label: t('match_details.manage.section_unassigned'),
      count: unassignedCount,
      rows: list.filter((p: any) => !p.shirt_color && passesFilter(p)),
      dummies: filter === 'in' ? 0 : dummyCount, // external web players are never "checked in"
    },
    {
      key: 'white',
      label: t('match_details.manage.section_white'),
      count: whiteCount,
      rows: list.filter((p: any) => p.shirt_color === 'white' && passesFilter(p)),
      dummies: 0,
    },
    {
      key: 'black',
      label: t('match_details.manage.section_black'),
      count: blackCount,
      rows: list.filter((p: any) => p.shirt_color === 'black' && passesFilter(p)),
      dummies: 0,
    },
  ];

  const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: t('match_details.manage.filter_all') },
    { key: 'in', label: t('match_details.manage.filter_in') },
    { key: 'out', label: t('match_details.manage.filter_out') },
  ];

  return (
    <View style={styles.section}>
      {header}

      <View style={styles.counters}>
        <Counter swatch={SECTION_STYLES.white.swatch} swatchBorder={SECTION_STYLES.white.swatchBorder} label={t('match_details.manage.section_white')} value={whiteCount} />
        <Counter swatch={SECTION_STYLES.black.swatch} swatchBorder={SECTION_STYLES.black.swatchBorder} label={t('match_details.manage.section_black')} value={blackCount} />
        <Counter swatch={SECTION_STYLES.unassigned.swatch} label={t('match_details.manage.section_unassigned')} value={unassignedCount} />
      </View>

      <View style={styles.filterRow}>
        {FILTERS.map((f) => (
          <TouchableOpacity key={f.key} onPress={() => setFilter(f.key)} style={[styles.filterChip, filter === f.key && styles.filterChipActive]}>
            <Text style={[styles.filterChipText, filter === f.key && styles.filterChipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.sectionsWrap}>
        {sectionData.map((sec) => {
          const sty = SECTION_STYLES[sec.key];
          const isCollapsed = collapsed[sec.key];
          return (
            <View key={sec.key} style={[styles.colorSection, { backgroundColor: sty.bg, borderLeftColor: sty.accent }]}>
              <TouchableOpacity style={styles.colorHeader} onPress={() => setCollapsed((c) => ({ ...c, [sec.key]: !c[sec.key] }))} activeOpacity={0.7}>
                <View style={[styles.swatch, { backgroundColor: sty.swatch, borderColor: sty.swatchBorder || 'transparent', borderWidth: sty.swatchBorder ? 1 : 0 }]} />
                <Text style={[styles.colorLabel, { color: sty.text }]} numberOfLines={1}>{sec.label}</Text>
                <Text style={[styles.colorCount, { color: sty.sub }]}>{sec.count}</Text>
                <Ionicons name={isCollapsed ? 'chevron-down' : 'chevron-up'} size={16} color={sty.sub} />
              </TouchableOpacity>

              {!isCollapsed && sec.rows.map((p: any, idx: number) => (
                <PlayerRow
                  key={p.id || `${sec.key}-${idx}`}
                  p={p}
                  sty={sty}
                  userId={userId}
                  t={t}
                  onRemove={p.user_id !== userId ? () => removeParticipant(p) : undefined}
                />
              ))}

              {!isCollapsed && Array.from({ length: sec.dummies }).map((_, i) => (
                <View key={`d-${sec.key}-${i}`} style={[styles.playerRow, { borderBottomColor: sty.divider }]}>
                  <View style={styles.iconBtn} />
                  <View style={[styles.miniAvatar, { backgroundColor: COLORS.BORDER }]}>
                    <Ionicons name="person" size={14} color={COLORS.TEXT_LIGHT} />
                  </View>
                  <Text style={[styles.playerName, { color: sty.sub }]} numberOfLines={1}>{t('match_details.external_player')}</Text>
                  <TouchableOpacity onPress={removeDummyPlayer} style={styles.iconBtn}>
                    <Ionicons name="close" size={16} color={COLORS.DANGER} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 20, paddingTop: 24 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MAIN },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  modeToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10, backgroundColor: COLORS.BORDER_LIGHT },
  modeToggleText: { fontSize: 11, fontFamily: FONTS.SEMI_BOLD, color: COLORS.TEXT_MUTED },
  countBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  countBadgeText: { color: COLORS.TEXT_WHITE, fontSize: 14, fontFamily: FONTS.BOLD },

  // Original simple list
  participantsContainer: { gap: 12 },
  participantItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.CARD_BG, padding: 12, borderRadius: 16 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.PRIMARY_LIGHT, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 18, fontFamily: FONTS.BOLD, color: COLORS.PRIMARY },
  participantName: { fontSize: 16, fontFamily: FONTS.SEMI_BOLD, color: COLORS.TEXT_MAIN },
  participantStatus: { fontSize: 12, fontFamily: FONTS.REGULAR, color: COLORS.SUCCESS },
  removeBtn: { padding: 8, backgroundColor: COLORS.DANGER_LIGHT, borderRadius: 8 },

  // Compact admin view — counters
  counters: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  counterItem: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: COLORS.CARD_BG, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: COLORS.BORDER },
  counterValue: { fontSize: 16, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MAIN },
  counterLabel: { fontSize: 10, fontFamily: FONTS.MEDIUM, color: COLORS.TEXT_MUTED, flexShrink: 1 },

  // Compact admin view — check-in filter
  filterRow: { flexDirection: 'row', gap: 6, marginBottom: 12 },
  filterChip: { flex: 1, paddingVertical: 7, borderRadius: 10, backgroundColor: COLORS.BORDER_LIGHT, alignItems: 'center' },
  filterChipActive: { backgroundColor: COLORS.SECONDARY },
  filterChipText: { fontSize: 12, fontFamily: FONTS.SEMI_BOLD, color: COLORS.TEXT_MUTED },
  filterChipTextActive: { color: COLORS.TEXT_WHITE },

  // Compact admin view — color sections (continuous, no gap)
  sectionsWrap: { borderRadius: 14, overflow: 'hidden', borderWidth: 1, borderColor: COLORS.BORDER },
  colorSection: { borderLeftWidth: 4 },
  colorHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 9 },
  swatch: { width: 14, height: 14, borderRadius: 4 },
  colorLabel: { flex: 1, fontSize: 13, fontFamily: FONTS.BOLD, textTransform: 'uppercase', letterSpacing: 0.5 },
  colorCount: { fontSize: 13, fontFamily: FONTS.BOLD },

  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 7, borderBottomWidth: StyleSheet.hairlineWidth },
  miniAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: COLORS.PRIMARY_LIGHT, justifyContent: 'center', alignItems: 'center' },
  miniAvatarText: { fontSize: 13, fontFamily: FONTS.BOLD, color: COLORS.PRIMARY },
  playerName: { flex: 1, fontSize: 14, fontFamily: FONTS.SEMI_BOLD },
  iconBtn: { padding: 6, minWidth: 34, alignItems: 'center', justifyContent: 'center' },
  disabledCtrl: { opacity: 0.4 },
  colorPick: { flexDirection: 'row', gap: 4 },
  colorChip: { width: 26, height: 26, borderRadius: 8, justifyContent: 'center', alignItems: 'center', borderWidth: 1 },
  colorChipWhite: { backgroundColor: '#FFFFFF', borderColor: '#CBD5E1' },
  colorChipBlack: { backgroundColor: '#0F172A', borderColor: '#0F172A' },
  colorChipActive: { borderColor: COLORS.PRIMARY, borderWidth: 2 },
  colorChipText: { fontSize: 12, fontFamily: FONTS.BOLD },
});
