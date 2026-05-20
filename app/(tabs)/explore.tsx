import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Platform, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { useEffect, useState } from 'react';
import { useEnv } from '../../hooks/use-env';
import { COLORS, FONTS, SIZES, SHADOWS } from '../../constants/theme';

export default function ProfileScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [profileName, setProfileName] = useState(t('profile.loading'));
  const { fromTable } = useEnv();
  const [profileEmail, setProfileEmail] = useState('');

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const meta = user.user_metadata || {};
        setProfileName(meta.full_name || meta.name || user.email?.split('@')[0] || t('profile.no_name'));
        setProfileEmail(user.email || '');
      } else {
        setProfileName(t('profile.not_connected'));
      }
    }
    loadProfile();
  }, []);

  const handleLogout = async () => {
    const executeLogout = async () => {
      try {
        setProfileName(t('profile.logging_out'));
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        
        // Clear local cache if any and redirect
        router.replace('/login' as any);
      } catch (e: any) {
        console.log('Error al salir:', e);
        Alert.alert(t('common.error'), t('profile.logout_error') || e.message);
      }
    };

    if (Platform.OS === 'web') {
      const confirmar = window.confirm(t('profile.logout_confirm_msg'));
      if (confirmar) executeLogout();
    } else {
      Alert.alert(
        t('profile.logout_confirm_title'),
        t('profile.logout_confirm_msg'),
        [
          { text: t('profile.logout_cancel'), style: 'cancel' },
          { text: t('profile.logout_yes'), style: 'destructive', onPress: executeLogout }
        ]
      );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {profileName !== t('profile.loading') && profileName.length > 0 ? profileName.charAt(0).toUpperCase() : '?'}
            </Text>
          </View>
          <Text style={styles.name}>{profileName}</Text>
          <Text style={styles.level}>{t('profile.level_tbd')}</Text>
        </View>

        <View style={styles.statsContainer}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>12</Text>
            <Text style={styles.statLabel}>{t('profile.stats_matches')}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>8</Text>
            <Text style={styles.statLabel}>{t('profile.stats_goals')}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>4.8</Text>
            <Text style={styles.statLabel}>{t('profile.stats_rating')}</Text>
          </View>
        </View>

        <ScrollView style={styles.actionsContainer} showsVerticalScrollIndicator={false}>
          <TouchableOpacity 
            style={[styles.actionButton, styles.publishButton]} 
            onPress={() => router.push('/admin/crear-partido' as any)}
          >
            <View style={[styles.actionIconContainer, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
              <Ionicons name="add" size={24} color={COLORS.TEXT_WHITE} />
            </View>
            <Text style={[styles.actionText, styles.publishButtonText]}>{t('profile.action_publish')}</Text>
            <Ionicons name="chevron-forward" size={20} color={COLORS.TEXT_WHITE} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton}>
            <View style={styles.actionIconContainer}>
              <Ionicons name="settings-outline" size={22} color={COLORS.PRIMARY} />
            </View>
            <Text style={styles.actionText}>{t('profile.action_settings')}</Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.TEXT_LIGHT} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton}>
            <View style={styles.actionIconContainer}>
              <Ionicons name="card-outline" size={22} color={COLORS.PRIMARY} />
            </View>
            <Text style={styles.actionText}>{t('profile.action_payments')}</Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.TEXT_LIGHT} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton}>
            <View style={styles.actionIconContainer}>
              <Ionicons name="notifications-outline" size={22} color={COLORS.PRIMARY} />
            </View>
            <Text style={styles.actionText}>{t('profile.action_notifications')}</Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.TEXT_LIGHT} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton}>
            <View style={styles.actionIconContainer}>
              <Ionicons name="help-circle-outline" size={22} color={COLORS.PRIMARY} />
            </View>
            <Text style={styles.actionText}>{t('profile.action_support')}</Text>
            <Ionicons name="chevron-forward" size={18} color={COLORS.TEXT_LIGHT} />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionButton, styles.logoutButton]} onPress={handleLogout}>
            <View style={[styles.actionIconContainer, { backgroundColor: 'rgba(239, 68, 68, 0.1)' }]}>
              <Ionicons name="log-out-outline" size={22} color={COLORS.DANGER} />
            </View>
            <Text style={[styles.actionText, styles.logoutText]}>{t('profile.action_logout')}</Text>
          </TouchableOpacity>
          
        </ScrollView>
        <View style={{ paddingTop: 10, alignItems: 'center', paddingBottom: 20 }}>
          <Text style={{ color: COLORS.TEXT_MUTED, fontSize: 12, fontFamily: FONTS.MEDIUM, textAlign: 'center', lineHeight: 18 }}>
            Powered by Eurekiano Solutions © 2026{'\n'}eurekianosolutions@gmail.com
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.BACKGROUND },
  container: { flex: 1, padding: SIZES.PADDING },
  avatarContainer: { alignItems: 'center', marginVertical: 32 },
  avatar: { 
    width: 100, 
    height: 100, 
    borderRadius: 50, 
    backgroundColor: COLORS.CARD_BG, 
    justifyContent: 'center', 
    alignItems: 'center', 
    borderWidth: 4, 
    borderColor: COLORS.PRIMARY, 
    marginBottom: 16,
    ...SHADOWS.MEDIUM
  },
  avatarText: {
    color: COLORS.PRIMARY, 
    fontSize: 40, 
    fontFamily: FONTS.EXTRA_BOLD
  },
  name: { fontSize: 26, fontFamily: FONTS.EXTRA_BOLD, color: COLORS.TEXT_MAIN },
  level: { fontSize: 14, color: COLORS.TEXT_MUTED, marginTop: 4, fontFamily: FONTS.SEMI_BOLD },
  
  statsContainer: { 
    flexDirection: 'row', 
    justifyContent: 'space-around', 
    alignItems: 'center', 
    backgroundColor: COLORS.CARD_BG, 
    borderRadius: SIZES.RADIUS_MEDIUM, 
    padding: 24, 
    marginBottom: 32, 
    borderWidth: 1, 
    borderColor: COLORS.BORDER_LIGHT,
    ...SHADOWS.SMALL 
  },
  statBox: { alignItems: 'center', flex: 1 },
  divider: { width: 1, height: 40, backgroundColor: COLORS.BORDER_LIGHT },
  statNumber: { fontSize: 22, fontFamily: FONTS.EXTRA_BOLD, color: COLORS.TEXT_MAIN },
  statLabel: { fontSize: 11, color: COLORS.TEXT_LIGHT, marginTop: 6, fontFamily: FONTS.BOLD, textTransform: 'uppercase' },
  
  actionsContainer: { flex: 1 },
  actionButton: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: COLORS.CARD_BG, 
    padding: 16, 
    borderRadius: SIZES.RADIUS_SMALL, 
    marginBottom: 12, 
    borderWidth: 1, 
    borderColor: COLORS.BORDER_LIGHT,
    ...SHADOWS.SMALL
  },
  actionIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: COLORS.BACKGROUND,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16
  },
  actionText: { color: COLORS.TEXT_MAIN, fontSize: 15, fontFamily: FONTS.BOLD, flex: 1 },
  
  publishButton: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: COLORS.PRIMARY,
  },
  publishButtonText: {
    color: COLORS.TEXT_WHITE,
  },
  
  logoutButton: { 
    marginTop: 20, 
    backgroundColor: 'rgba(239, 68, 68, 0.05)', 
    borderColor: 'rgba(239, 68, 68, 0.1)',
  },
  logoutText: { color: COLORS.DANGER }
});
