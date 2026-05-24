import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { shareMatch } from '../../lib/share';
import { getVenueImage } from '../../lib/venueImages';
import { COLORS, FONTS } from '../../constants/theme';

export default function MatchHeader({ match, formattedDate, asComponent, router, isAdmin, prefix, id }: any) {
  const { t } = useTranslation();
  if (!match) return null;

  return (
    <View style={styles.imageContainer}>
      <Image 
        source={getVenueImage(match.venue, match.image_url)} 
        style={styles.headerImage} 
        contentFit="cover"
        transition={500}
        cachePolicy="memory-disk"
      />
      <View style={styles.imageOverlay} />
      
      {!asComponent && (
        <View style={styles.fullScreenHeader}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={COLORS.TEXT_WHITE} />
          </TouchableOpacity>
          
          <View style={styles.fullScreenHeaderRight}>
            <TouchableOpacity onPress={() => shareMatch(match)} style={styles.headerIconButtonRound}>
              <Ionicons name="share-outline" size={22} color={COLORS.TEXT_WHITE} />
            </TouchableOpacity>
            {isAdmin && (
              <TouchableOpacity 
                onPress={() => router.push(`${prefix}/admin/crear-partido?editId=${id}` as any)} 
                style={[styles.headerIconButtonRound, {backgroundColor: COLORS.PRIMARY}]}
              >
                <Ionicons name="pencil" size={22} color={COLORS.TEXT_WHITE} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
      
      <View style={styles.headerInfo}>
        <View style={styles.typeBadgeContainer}>
          {match.distance && match.distance !== 'Apto' && (
            <View style={[styles.typeBadge, {backgroundColor: '#38BDF8'}]}><Text style={styles.typeBadgeText}>{match.distance}</Text></View>
          )}
          {match.is_private && <View style={[styles.typeBadge, {backgroundColor: COLORS.SECONDARY}]}><Text style={styles.typeBadgeText}>{t('common.private')}</Text></View>}
          {match.is_female && <View style={styles.typeBadge}><Text style={styles.typeBadgeText}>{t('common.female')}</Text></View>}
          {match.is_mixed && <View style={[styles.typeBadge, {backgroundColor: COLORS.WARNING}]}><Text style={styles.typeBadgeText}>{t('common.mixed')}</Text></View>}
          {match.is_advanced && <View style={[styles.typeBadge, {backgroundColor: COLORS.DANGER}]}><Text style={styles.typeBadgeText}>{t('common.advanced')}</Text></View>}
        </View>
        <Text style={styles.mainTitle}>{match.title ? match.title : match.venue}</Text>
        <View style={styles.headerDateRow}>
          <Ionicons name="calendar" size={16} color={COLORS.PRIMARY_LIGHT} />
          <Text style={styles.headerDateText}>{formattedDate} • {match.time}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  imageContainer: { width: '100%', height: 350, position: 'relative' },
  headerImage: { width: '100%', height: '100%' },
  imageOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.15)' },
  fullScreenHeader: { position: 'absolute', top: 50, left: 20, right: 20, flexDirection: 'row', justifyContent: 'space-between', zIndex: 10 },
  fullScreenHeaderRight: { flexDirection: 'row', gap: 12 },
  backButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  headerIconButtonRound: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  headerInfo: { position: 'absolute', bottom: 30, left: 20, right: 20 },
  typeBadgeContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  typeBadge: { backgroundColor: COLORS.PRIMARY, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  typeBadgeText: { color: COLORS.TEXT_WHITE, fontSize: 12, fontFamily: FONTS.BOLD },
  mainTitle: { color: COLORS.TEXT_WHITE, fontSize: 32, fontFamily: FONTS.EXTRA_BOLD, marginBottom: 8, textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 6 },
  headerDateRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerDateText: { color: COLORS.TEXT_WHITE, fontSize: 16, fontFamily: FONTS.SEMI_BOLD, textShadowColor: 'rgba(0,0,0,0.7)', textShadowOffset: { width: 0, height: 1 }, textShadowRadius: 4 }
});
