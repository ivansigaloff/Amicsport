import { View, Text, StyleSheet, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { GradientHero, SectionTitle, PressableScale, AnimatedEntrance, C, FONTS, R, S, SHADOW } from '../../../components/v2/ui';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

function MenuItem({ icon, label, color, onPress }: { icon: IconName; label: string; color: string; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} style={styles.item}>
      <View style={[styles.itemIcon, { backgroundColor: color + '1A' }]}><Ionicons name={icon} size={20} color={color} /></View>
      <Text style={styles.itemLabel}>{label}</Text>
      <Ionicons name="chevron-forward" size={18} color={C.textFaint} />
    </PressableScale>
  );
}

export default function V2Menu() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const changeLanguage = async (lng: string) => { await i18n.changeLanguage(lng); await AsyncStorage.setItem('@app_language', lng); };
  const langs: [string, string][] = [['es', 'ES'], ['en', 'EN'], ['ca', 'CA']];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['left', 'right']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 130 }}>
        <GradientHero topInset={Platform.OS === 'web' ? S.xl : S.huge}>
          <Text style={styles.heroTitle}>{t('menu.title')}</Text>
        </GradientHero>

        <View style={{ paddingHorizontal: S.lg, marginTop: S.xl }}>
          <AnimatedEntrance index={0}>
            <SectionTitle>{t('menu.language_section')}</SectionTitle>
            <View style={styles.langWrap}>
              {langs.map(([code, label]) => {
                const active = i18n.language === code;
                return (
                  <PressableScale key={code} onPress={() => changeLanguage(code)} style={[styles.langBtn, active && styles.langBtnActive]}>
                    <Text style={[styles.langText, active && styles.langTextActive]}>{label}</Text>
                  </PressableScale>
                );
              })}
            </View>
          </AnimatedEntrance>

          <AnimatedEntrance index={1} style={{ marginTop: S.xl }}>
            <SectionTitle>{t('menu.legal_section')}</SectionTitle>
            <MenuItem icon="shield-checkmark" color={C.brand} label={t('menu.legal_links')} onPress={() => router.push('/legal' as any)} />
          </AnimatedEntrance>

          <AnimatedEntrance index={2} style={{ marginTop: S.xl }}>
            <SectionTitle>{t('menu.support_section')}</SectionTitle>
            <MenuItem icon="chatbubbles" color={C.info} label={t('menu.contact')} onPress={() => (Platform.OS === 'web' ? window.alert(t('menu.soon')) : null)} />
          </AnimatedEntrance>

          <Text style={styles.version}>AmicSport v2.0.0{'\n'}Powered by Eurekiano Solutions © 2026</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  heroTitle: { color: '#fff', fontSize: 30, fontFamily: FONTS.black, letterSpacing: 0.5, textTransform: 'uppercase' },
  langWrap: { flexDirection: 'row', gap: 10 },
  langBtn: { flex: 1, height: 50, borderRadius: R.md, backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.ink, alignItems: 'center', justifyContent: 'center', ...SHADOW.sm },
  langBtnActive: { backgroundColor: C.ink800, borderColor: C.ink },
  langText: { fontFamily: FONTS.black, fontSize: 15, letterSpacing: 0.5, color: C.textMuted },
  langTextActive: { color: '#fff' },
  item: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, padding: 14, borderRadius: R.md, borderWidth: 1.5, borderColor: C.ink, gap: 14, ...SHADOW.sm },
  itemIcon: { width: 40, height: 40, borderRadius: R.sm, alignItems: 'center', justifyContent: 'center' },
  itemLabel: { flex: 1, fontFamily: FONTS.bold, fontSize: 15, color: C.text },
  version: { textAlign: 'center', color: C.textFaint, fontFamily: FONTS.medium, fontSize: 12, marginTop: S.huge, lineHeight: 18 },
});
