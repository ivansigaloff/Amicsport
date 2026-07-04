import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Card, SectionTitle, C, FONTS, S } from './ui';
import { Ionicons } from '@expo/vector-icons';

export default function GPSMatchViewer({ matchId }: { matchId: string }) {
  return (
    <Card style={styles.card}>
      <SectionTitle>Rendimiento GPS</SectionTitle>
      <View style={styles.content}>
        <Ionicons name="desktop-outline" size={40} color={C.textMuted} style={styles.icon} />
        <Text style={styles.title}>Visor Web Disponible</Text>
        <Text style={styles.text}>
          El análisis interactivo de rendimiento, reproducción de carreras y mapas de calor está optimizado y disponible exclusivamente en la versión Web de AmicSport.
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: S.xl,
    padding: S.lg,
  },
  content: {
    alignItems: 'center',
    paddingVertical: S.lg,
  },
  icon: {
    marginBottom: S.md,
  },
  title: {
    fontFamily: FONTS.bold,
    fontSize: 16,
    color: C.text,
    marginBottom: S.xs,
  },
  text: {
    fontFamily: FONTS.regular,
    fontSize: 13,
    color: C.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
