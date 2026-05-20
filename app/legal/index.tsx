import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useEnv } from '../../hooks/use-env';

export default function LegalIndexScreen() {
  const { t } = useTranslation();
  const router = useRouter();

  const { env } = useEnv();
  const prefix = env === 'dev' ? '/dev' : '';

  const navigateTo = (path: string) => {
    router.push(`${prefix}/legal/${path}` as any);
  };

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ 
        title: t('menu.legal_links'),
        headerShown: true,
        headerLeft: () => (
          <TouchableOpacity onPress={() => router.back()} style={{ marginLeft: 16 }}>
            <Ionicons name="arrow-back" size={24} color="#0F172A" />
          </TouchableOpacity>
        )
      }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <TouchableOpacity style={styles.menuItem} onPress={() => navigateTo('privacidad')}>
            <View style={styles.menuItemLeft}>
              <View style={[styles.iconContainer, { backgroundColor: '#E0E7FF' }]}>
                <Ionicons name="shield-checkmark" size={20} color="#4F46E5" />
              </View>
              <Text style={styles.menuItemText}>{t('privacy.title')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#CBD5E1" />
          </TouchableOpacity>

          <View style={styles.separator} />

          <TouchableOpacity style={styles.menuItem} onPress={() => navigateTo('terminos')}>
            <View style={styles.menuItemLeft}>
              <View style={[styles.iconContainer, { backgroundColor: '#FEF3C7' }]}>
                <Ionicons name="document-text" size={20} color="#D97706" />
              </View>
              <Text style={styles.menuItemText}>{t('terms.title')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color="#CBD5E1" />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  content: { padding: 24 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.03,
    shadowRadius: 8,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  menuItemText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1E293B',
  },
  separator: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginLeft: 76,
  },
});
