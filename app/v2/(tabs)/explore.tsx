import { View, Text, StyleSheet, ScrollView, Alert, Platform } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { computeIsAdmin } from '../../../lib/auth';
import { PressableScale, AnimatedEntrance, Card, C, FONTS, GRADIENTS, R, S, SHADOW } from '../../../components/v2/ui';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function ActionRow({ icon, label, onPress, tone = 'default', index }: { icon: IconName; label: string; onPress: () => void; tone?: 'default' | 'brand' | 'danger'; index: number }) {
  const colors = tone === 'brand' ? { ic: C.brandDeep, icbg: C.brandWash, tx: C.text } : tone === 'danger' ? { ic: C.danger, icbg: C.dangerWash, tx: C.danger } : { ic: C.brandDeep, icbg: C.surfaceAlt, tx: C.text };
  return (
    <AnimatedEntrance index={index}>
      <PressableScale onPress={onPress} style={styles.row}>
        <View style={[styles.rowIcon, { backgroundColor: colors.icbg }]}><Ionicons name={icon} size={20} color={colors.ic} /></View>
        <Text style={[styles.rowLabel, { color: colors.tx }]}>{label}</Text>
        <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
      </PressableScale>
    </AnimatedEntrance>
  );
}

export default function V2Profile() {
  const { t } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState(t('profile.loading'));
  const [email, setEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [matchCount, setMatchCount] = useState<number | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const meta = user.user_metadata || {};
        setName(meta.full_name || meta.name || user.email?.split('@')[0] || t('profile.no_name'));
        setEmail(user.email || '');
        setIsAdmin(computeIsAdmin(user));
        const { count } = await supabase.from('match_participants').select('*', { count: 'exact', head: true }).eq('user_id', user.id);
        setMatchCount(count ?? 0);
      } else setName(t('profile.not_connected'));
    })();
  }, []);

  const comingSoon = () => Platform.OS === 'web' ? window.alert(t('menu.soon')) : Alert.alert(t('menu.soon'), '');

  const logout = async () => {
    const run = async () => { await supabase.auth.signOut(); router.replace('/v2/login' as any); };
    if (Platform.OS === 'web') { if (window.confirm(t('profile.logout_confirm_msg'))) run(); }
    else Alert.alert(t('profile.logout_confirm_title'), t('profile.logout_confirm_msg'), [{ text: t('profile.logout_cancel'), style: 'cancel' }, { text: t('profile.logout_yes'), style: 'destructive', onPress: run }]);
  };

  const initial = name && name !== t('profile.loading') ? name.charAt(0).toUpperCase() : '?';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['left', 'right']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 130 }}>
        <LinearGradient colors={GRADIENTS.inkBrand as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
          <AnimatedEntrance distance={16} style={{ alignItems: 'center' }}>
            <View style={styles.avatarRing}>
              <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
            </View>
            <Text style={styles.name}>{name}</Text>
            {!!email && <Text style={styles.email}>{email}</Text>}
            {isAdmin && <View style={styles.adminTag}><Ionicons name="shield-checkmark" size={12} color={C.ink} /><Text style={styles.adminTagText}>ADMIN</Text></View>}
          </AnimatedEntrance>
        </LinearGradient>

        <View style={styles.body}>
          <AnimatedEntrance delay={60}>
            <Card style={styles.statCard} elevation="md">
              <View style={styles.stat}>
                <Text style={styles.statNum}>{matchCount === null ? '—' : matchCount}</Text>
                <Text style={styles.statLabel}>{t('profile.stats_matches')}</Text>
              </View>
            </Card>
          </AnimatedEntrance>

          <View style={{ gap: 10, marginTop: S.lg }}>
            <ActionRow index={0} icon="add-circle" tone="brand" label={t('profile.action_publish')} onPress={() => router.push('/v2/admin/crear-partido' as any)} />
            <ActionRow index={1} icon="settings-outline" label={t('profile.action_settings')} onPress={comingSoon} />
            <ActionRow index={2} icon="card-outline" label={t('profile.action_payments')} onPress={comingSoon} />
            <ActionRow index={3} icon="notifications-outline" label={t('profile.action_notifications')} onPress={comingSoon} />
            <ActionRow index={4} icon="help-circle-outline" label={t('profile.action_support')} onPress={comingSoon} />
            {isAdmin && <ActionRow index={5} icon="receipt-outline" label="Gestión de Pagos" onPress={() => router.push('/v2/admin/pagos' as any)} />}
            {isAdmin && <ActionRow index={6} icon="options-outline" label="Ajustes de Reembolsos" onPress={() => router.push('/v2/admin/ajustes' as any)} />}
            {isAdmin && <ActionRow index={7} icon="logo-whatsapp" label="WhatsApp" onPress={() => router.push('/v2/admin/whatsapp' as any)} />}
            <View style={{ height: 6 }} />
            <ActionRow index={8} icon="log-out-outline" tone="danger" label={t('profile.action_logout')} onPress={logout} />
          </View>

          <Text style={styles.footer}>AmicSport · v2{'\n'}Powered by Eurekiano Solutions © 2026</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  hero: { paddingTop: Platform.OS === 'web' ? S.xxxl : 70, paddingBottom: S.xxxl, paddingHorizontal: S.xl, borderBottomLeftRadius: R.xl, borderBottomRightRadius: R.xl, overflow: 'hidden' },
  avatarRing: { padding: 4, backgroundColor: 'rgba(255,255,255,0.12)' },
  avatar: { width: 92, height: 92, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...SHADOW.md },
  avatarText: { color: C.text, fontSize: 40, fontFamily: FONTS.black },
  name: { color: '#fff', fontSize: 24, fontFamily: FONTS.black, marginTop: S.md, letterSpacing: -0.5 },
  email: { color: 'rgba(255,255,255,0.7)', fontSize: 13, fontFamily: FONTS.medium, marginTop: 2 },
  adminTag: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.accent, paddingHorizontal: 10, paddingVertical: 4, borderRadius: R.pill, marginTop: 10 },
  adminTagText: { color: C.onInk, fontFamily: FONTS.black, fontSize: 10, letterSpacing: 0.8 },
  body: { paddingHorizontal: S.lg, marginTop: -18 },
  statCard: { alignItems: 'center' },
  stat: { alignItems: 'center' },
  statNum: { fontSize: 30, fontFamily: FONTS.black, color: C.brandDeep },
  statLabel: { fontSize: 11, fontFamily: FONTS.bold, color: C.textFaint, textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4 },
  row: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, padding: 14, borderRadius: R.md, borderWidth: 1, borderColor: C.border, gap: 14, ...SHADOW.sm },
  rowIcon: { width: 40, height: 40, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontFamily: FONTS.bold, fontSize: 15 },
  footer: { textAlign: 'center', color: C.textFaint, fontFamily: FONTS.medium, fontSize: 12, marginTop: S.xxl, lineHeight: 18 },
});
