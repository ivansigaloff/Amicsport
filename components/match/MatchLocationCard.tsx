import React from 'react';
import { View, Text, TouchableOpacity, Linking, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { COLORS, SHADOWS, FONTS } from '../../constants/theme';

export default function MatchLocationCard({ match }: any) {
  const { t } = useTranslation();
  if (!match) return null;

  return (
    <View style={styles.section}>
      <TouchableOpacity 
        style={[styles.venueCard, SHADOWS.SMALL as any]}
        onPress={() => match.location_url && Linking.openURL(match.location_url)}
      >
        <Ionicons name="map-outline" size={24} color={COLORS.PRIMARY} />
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.venueName}>{match.venue}</Text>
          <Text style={styles.venueAddress}>{t('match_details.distance_from_you')} 2.4 km</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={COLORS.TEXT_LIGHT} />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingHorizontal: 20, paddingTop: 24 },
  venueCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.CARD_BG, padding: 16, borderRadius: 16 },
  venueName: { fontSize: 16, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MAIN, marginBottom: 4 },
  venueAddress: { fontSize: 14, fontFamily: FONTS.REGULAR, color: COLORS.TEXT_MUTED }
});
