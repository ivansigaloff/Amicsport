import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { COLORS, SHADOWS, FONTS } from '../../constants/theme';

export default function MatchParticipantsList({ match, participantsList, isFull, isAdmin, userId, removeParticipant, removeDummyPlayer }: any) {
  const { t } = useTranslation();
  if (!match) return null;

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{t('match_details.joined_list_title')}</Text>
        <View style={[styles.countBadge, { backgroundColor: isFull ? COLORS.DANGER : COLORS.SUCCESS }]}>
          <Text style={styles.countBadgeText}>{participantsList.length + (match.joined_players || 0)}/{match.max_players}</Text>
        </View>
      </View>

      <View style={styles.participantsContainer}>
        {participantsList.map((p: any, index: number) => (
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
        {Array.from({ length: (match.joined_players || 0) }).map((_, i) => (
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

const styles = StyleSheet.create({
  section: { paddingHorizontal: 20, paddingTop: 24 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MAIN },
  countBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  countBadgeText: { color: COLORS.TEXT_WHITE, fontSize: 14, fontFamily: FONTS.BOLD },
  participantsContainer: { gap: 12 },
  participantItem: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.CARD_BG, padding: 12, borderRadius: 16 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.PRIMARY_LIGHT, justifyContent: 'center', alignItems: 'center' },
  avatarText: { fontSize: 18, fontFamily: FONTS.BOLD, color: COLORS.PRIMARY },
  participantName: { fontSize: 16, fontFamily: FONTS.SEMI_BOLD, color: COLORS.TEXT_MAIN },
  participantStatus: { fontSize: 12, fontFamily: FONTS.REGULAR, color: COLORS.SUCCESS },
  removeBtn: { padding: 8, backgroundColor: COLORS.DANGER_LIGHT, borderRadius: 8 }
});
