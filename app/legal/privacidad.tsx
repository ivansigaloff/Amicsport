import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export default function PrivacyScreen() {
  const { t } = useTranslation();
  const router = useRouter();

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
        <Text style={styles.text}>{t('privacy.content')}</Text>
        <Text style={styles.text}>
           Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { padding: 24 },
  title: { fontSize: 24, fontWeight: '900', color: '#0F172A', marginBottom: 20 },
  text: { fontSize: 16, color: '#475569', lineHeight: 24, marginBottom: 16 },
});
