import { View, Text, ScrollView, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../../lib/supabase';
import { computeIsAdmin } from '../../../lib/auth';
import { PressableScale, C, FONTS, GRADIENTS, R, S, SHADOW, screenBg } from '../ui';

/**
 * Frame for every V2 admin screen: admin-only gate (UI guard — RLS still
 * enforces server-side), a clean header with back + optional actions, and a
 * themed body. Children render only once the viewer is confirmed admin.
 */
export default function AdminScreen({
  title,
  subtitle,
  headerRight,
  onRefresh,
  scroll = true,
  children,
  contentStyle,
}: {
  title: string;
  subtitle?: string;
  headerRight?: React.ReactNode;
  onRefresh?: () => void;
  scroll?: boolean;
  children: React.ReactNode;
  contentStyle?: any;
}) {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setAuthorized(computeIsAdmin(user));
    })();
  }, []);

  if (authorized === null) {
    return <View style={styles.center}><ActivityIndicator size="large" color={C.brand} /></View>;
  }
  if (!authorized) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={48} color={C.textFaint} />
          <Text style={styles.noAccess}>Solo para administradores</Text>
          <PressableScale onPress={() => router.replace('/v2' as any)} style={styles.backLink}>
            <Text style={styles.backLinkText}>Volver</Text>
          </PressableScale>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <View style={styles.header}>
        <PressableScale onPress={() => (router.canGoBack() ? router.back() : router.replace('/v2' as any))} style={styles.iconBtn}>
          <Ionicons name="arrow-back" size={20} color={C.text} />
        </PressableScale>
        <View style={{ flex: 1, marginLeft: S.md }}>
          <Text style={styles.title} numberOfLines={1}>{title}</Text>
          {!!subtitle && <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>}
        </View>
        {onRefresh && (
          <PressableScale onPress={onRefresh} style={styles.iconBtn}><Ionicons name="refresh" size={19} color={C.brandDeep} /></PressableScale>
        )}
        {headerRight}
      </View>
      <LinearGradient colors={GRADIENTS.brand as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.hairline} />
      {scroll ? (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[{ padding: S.lg, paddingBottom: 60 }, contentStyle]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: screenBg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: screenBg },
  noAccess: { color: C.textMuted, fontFamily: FONTS.semibold, fontSize: 16 },
  backLink: { paddingHorizontal: 18, paddingVertical: 10, borderRadius: R.md, backgroundColor: C.surface, borderWidth: 2, borderColor: C.ink, ...SHADOW.sm },
  backLinkText: { color: C.text, fontFamily: FONTS.bold },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: S.lg, paddingVertical: S.md, backgroundColor: C.surface },
  iconBtn: { width: 40, height: 40, borderRadius: R.md, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.ink, alignItems: 'center', justifyContent: 'center' },
  title: { fontFamily: FONTS.extraBold, fontSize: 19, color: C.text, letterSpacing: -0.4 },
  subtitle: { fontFamily: FONTS.medium, fontSize: 12.5, color: C.textMuted, marginTop: 1 },
  hairline: { height: 3, width: '100%' },
});
