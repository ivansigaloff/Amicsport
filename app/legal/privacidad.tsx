import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

type Section = { heading: string; items: string[] };

export default function PrivacyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const sections = t('privacy.sections', { returnObjects: true }) as Section[];

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{
        title: t('privacy.title'),
        headerShown: true,
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 16 }}>
            <Ionicons name="arrow-back" size={24} color="#0F172A" />
          </TouchableOpacity>
        )
      }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{t('privacy.title')}</Text>
        <Text style={styles.updated}>{t('privacy.updated')}</Text>
        <Text style={styles.intro}>{t('privacy.intro')}</Text>
        {Array.isArray(sections) && sections.map((sec, i) => (
          <View key={i} style={styles.section}>
            <Text style={styles.heading}>{sec.heading}</Text>
            {sec.items.map((item, j) => (
              <Text key={j} style={styles.text}>{item}</Text>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { padding: 24, paddingBottom: 48 },
  title: { fontSize: 24, fontWeight: '900', color: '#0F172A', marginBottom: 4 },
  updated: { fontSize: 13, color: '#94A3B8', marginBottom: 16 },
  intro: { fontSize: 16, color: '#475569', lineHeight: 24, marginBottom: 20 },
  section: { marginBottom: 20 },
  heading: { fontSize: 17, fontWeight: '800', color: '#0F172A', marginBottom: 8 },
  text: { fontSize: 15, color: '#475569', lineHeight: 23, marginBottom: 8 },
});
