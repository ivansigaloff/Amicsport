import React from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { COLORS, SHADOWS, FONTS } from '../../constants/theme';
import { Match, CancellationDeadline } from '../../lib/types';

interface MatchActionBarProps {
  match: Match | null;
  isStarted: boolean;
  isOver: boolean;
  joined: boolean;
  acting: boolean;
  isFull: boolean;
  toggleJoin: () => void;
  addGuest: () => void;
  handleCancelSpot: () => void;
  cancellationDeadline: CancellationDeadline | null;
  asComponent?: boolean;
  initiatePayment?: () => void;
}

export default function MatchActionBar({ match, isStarted, isOver, joined, acting, isFull, toggleJoin, addGuest, handleCancelSpot, cancellationDeadline, asComponent, initiatePayment }: MatchActionBarProps) {
  const { t } = useTranslation();
  if (!match) return null;

  return (
    <View style={[
      styles.actionBar, 
      SHADOWS.LARGE as any,
      { position: (Platform.OS === 'web' && !asComponent) ? 'fixed' : 'absolute' } as any
    ]}>
      <View>
        <Text style={styles.actionBarPrice}>{Number(match.price).toFixed(2)}€</Text>
        <Text style={styles.actionBarSubtitle}>{t('match_details.price_per_player')}</Text>
      </View>
      <View style={styles.joinActionArea}>
        {(() => {
          if (isStarted) {
            return (
              <View style={[styles.reserveBtn, { backgroundColor: COLORS.BORDER, opacity: 0.8 }]}>
                <Ionicons name={isOver ? "checkbox-outline" : "time-outline"} size={20} color={COLORS.TEXT_LIGHT} />
                <Text style={[styles.reserveBtnText, { color: COLORS.TEXT_LIGHT }]}>
                  {isOver ? (t('match_details.match_finished') || 'Partido finalizado') : (t('match_details.match_started') || 'Partido en curso')}
                </Text>
              </View>
            );
          }

          if (joined) {
            const isPaidMatch = match.requires_payment && match.price > 0;
            return (
              <View style={{ width: '100%', alignItems: 'flex-end' }}>
                {isPaidMatch && (
                  <View style={styles.paidBadge}>
                    <Ionicons name="checkmark-circle" size={14} color="#059669" />
                    <Text style={styles.paidBadgeText}>Pago confirmado</Text>
                  </View>
                )}
                <View style={styles.actionRow}>
                  <TouchableOpacity
                    style={[styles.smallIconBtn, { backgroundColor: COLORS.PRIMARY }]}
                    onPress={addGuest}
                    disabled={acting || isFull}
                  >
                    <Ionicons name="person-add" size={24} color="#FFF" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.reserveBtn, styles.joinedBtn]}
                    onPress={handleCancelSpot}
                    disabled={acting}
                  >
                    {acting ? <ActivityIndicator color="#FFF" /> : (
                      <>
                        <Ionicons name="person-remove" size={24} color="#FFF" />
                        <Text style={[styles.reserveBtnText, { fontSize: 13 }]}>{t('match_details.cancel_spot')}</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
                {cancellationDeadline && (
                  <Text style={[styles.deadlineText, cancellationDeadline.isPast && { color: COLORS.DANGER }]}>
                    {cancellationDeadline.isPast
                      ? 'Ya no puedes realizar cambios en este partido'
                      : `Puedes hacer cambios hasta el ${cancellationDeadline.date} a las ${cancellationDeadline.time}`
                    }
                  </Text>
                )}
              </View>
            );
          }

          const isPaidMatch = match.requires_payment && match.price > 0;
          const joinAction = isPaidMatch && initiatePayment ? initiatePayment : toggleJoin;
          return (
            <TouchableOpacity
              style={[styles.reserveBtn, isFull && styles.fullBtn, acting && { opacity: 0.7 }]}
              onPress={joinAction}
              disabled={acting || isFull}
            >
              {acting ? <ActivityIndicator color="#FFF" /> : (
                <>
                  <Ionicons name={isPaidMatch ? 'card-outline' : 'flash'} size={28} color="#FFF" />
                  <Text style={styles.reserveBtnText}>
                    {isFull ? t('match_details.reservation_limit') : isPaidMatch ? 'PAGAR PLAZA' : t('match_details.reserve_btn')}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          );
        })()}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actionBar: { bottom: 0, left: 0, right: 0, backgroundColor: COLORS.CARD_BG, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingTop: 16, paddingBottom: Platform.OS === 'ios' ? 34 : 20, borderTopWidth: 1, borderTopColor: COLORS.BORDER_LIGHT, zIndex: 100 },
  actionBarPrice: { fontSize: 24, fontFamily: FONTS.EXTRA_BOLD, color: COLORS.TEXT_MAIN },
  actionBarSubtitle: { fontSize: 12, fontFamily: FONTS.REGULAR, color: COLORS.TEXT_MUTED },
  joinActionArea: { flex: 1, marginLeft: 20, alignItems: 'flex-end' },
  actionRow: { flexDirection: 'row', gap: 8, alignItems: 'center', width: '100%', justifyContent: 'flex-end' },
  reserveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.PRIMARY, paddingVertical: 14, paddingHorizontal: 24, borderRadius: 16, gap: 8 },
  fullBtn: { backgroundColor: COLORS.BORDER },
  joinedBtn: { backgroundColor: COLORS.DANGER, flex: 1, maxWidth: 160 },
  reserveBtnText: { color: '#FFF', fontSize: 16, fontFamily: FONTS.BOLD },
  smallIconBtn: { width: 48, height: 48, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  deadlineText: { fontSize: 10, color: COLORS.TEXT_LIGHT, marginTop: 4, textAlign: 'right', fontStyle: 'italic' },
  paidBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#D1FAE5', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 6, alignSelf: 'flex-end' },
  paidBadgeText: { fontSize: 11, fontFamily: FONTS.BOLD, color: '#059669' },
});
