import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, SafeAreaView, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEnv } from '../../hooks/use-env';
import { COLORS, FONTS, SIZES, SHADOWS, SCREEN_BG } from '../../constants/theme';

export default function MenuScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const { env } = useEnv();
  const prefix = env === 'dev' ? '/dev' : '';

  const navigateTo = (path: string) => {
    router.push(`${prefix}/${path}` as any);
  };

  const changeLanguage = async (lng: string) => {
    await i18n.changeLanguage(lng);
    await AsyncStorage.setItem('@app_language', lng);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <Text style={styles.title}>{t('menu.title')}</Text>
      </View>
      <ScrollView bounces={true} style={styles.container} contentContainerStyle={styles.content}>
        
        <Text style={styles.sectionTitle}>{t('menu.language_section')}</Text>
        <View style={[styles.card, SHADOWS.SMALL]}>
          <View style={styles.languageContainer}>
            <TouchableOpacity 
              style={[styles.langButton, i18n.language === 'es' && styles.langButtonActive]} 
              onPress={() => changeLanguage('es')}
            >
              <Text style={[styles.langButtonText, i18n.language === 'es' && styles.langButtonTextActive]}>ES</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.langButton, i18n.language === 'en' && styles.langButtonActive]} 
              onPress={() => changeLanguage('en')}
            >
              <Text style={[styles.langButtonText, i18n.language === 'en' && styles.langButtonTextActive]}>EN</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.langButton, i18n.language === 'ca' && styles.langButtonActive]} 
              onPress={() => changeLanguage('ca')}
            >
              <Text style={[styles.langButtonText, i18n.language === 'ca' && styles.langButtonTextActive]}>CA</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={styles.sectionTitle}>{t('menu.legal_section')}</Text>
        
        <View style={[styles.card, SHADOWS.SMALL]}>
          <TouchableOpacity 
            style={styles.menuItem} 
            onPress={() => navigateTo('legal')}
          >
            <View style={styles.menuItemLeft}>
              <View style={[styles.iconContainer, { backgroundColor: COLORS.PRIMARY_LIGHT + '20' }]}>
                <Ionicons name="shield-checkmark" size={20} color={COLORS.PRIMARY} />
              </View>
              <Text style={styles.menuItemText}>{t('menu.legal_links')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.TEXT_LIGHT} />
          </TouchableOpacity>
        </View>

        <Text style={styles.sectionTitle}>{t('menu.support_section')}</Text>

        <View style={[styles.card, SHADOWS.SMALL]}>
          <TouchableOpacity 
            style={styles.menuItem}
            onPress={() => Platform.OS === 'web' ? window.alert(t('menu.soon')) : null}
          >
            <View style={styles.menuItemLeft}>
              <View style={[styles.iconContainer, { backgroundColor: COLORS.SUCCESS + '20' }]}>
                <Ionicons name="chatbubbles" size={20} color={COLORS.SUCCESS} />
              </View>
              <Text style={styles.menuItemText}>{t('menu.contact')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={COLORS.TEXT_LIGHT} />
          </TouchableOpacity>
        </View>
        
        <Text style={styles.versionText}>AmicSport v1.0.0</Text>
        <Text style={styles.brandingText}>{"Powered by Eurekiano Solutions \u00A9 2026\neurekianosolutions@gmail.com"}</Text>
        <Image 
          source={require('../../assets/images/bombilla_completa_nobg.png')} 
          style={styles.footerBulb} 
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: SCREEN_BG,
  },
  header: {
    paddingHorizontal: SIZES.PADDING,
    paddingTop: 24,
    paddingBottom: 16,
    backgroundColor: SCREEN_BG,
  },
  title: {
    fontSize: 28,
    fontFamily: FONTS.EXTRA_BOLD,
    color: COLORS.TEXT_MAIN,
  },
  container: {
    flex: 1,
  },
  content: {
    padding: SIZES.PADDING,
    paddingBottom: 40,
    maxWidth: 800,
    marginHorizontal: 'auto',
    width: '100%',
  },
  sectionTitle: {
    fontSize: 12,
    fontFamily: FONTS.BOLD,
    color: COLORS.TEXT_LIGHT,
    marginBottom: 12,
    marginTop: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  card: {
    backgroundColor: COLORS.CARD_BG,
    borderRadius: SIZES.RADIUS_MEDIUM,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: COLORS.BORDER_LIGHT,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  menuItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  menuItemText: {
    fontSize: 16,
    fontFamily: FONTS.SEMI_BOLD,
    color: COLORS.TEXT_MAIN,
  },
  versionText: {
    textAlign: 'center',
    color: COLORS.TEXT_MUTED,
    fontFamily: FONTS.MEDIUM,
    fontSize: 13,
    marginTop: 24,
  },
  brandingText: {
    textAlign: 'center',
    color: COLORS.TEXT_MUTED,
    fontFamily: FONTS.MEDIUM,
    fontSize: 12,
    marginTop: 8,
    lineHeight: 18,
  },
  footerBulb: {
    width: 110,
    height: 110,
    alignSelf: 'center',
    marginTop: 16,
    resizeMode: 'contain',
    opacity: 0.9,
  },
  languageContainer: {
    flexDirection: 'row',
    padding: 12,
    justifyContent: 'space-between',
    gap: 12,
  },
  langButton: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    backgroundColor: COLORS.BACKGROUND,
    justifyContent: 'center',
    alignItems: 'center',
  },
  langButtonActive: {
    backgroundColor: COLORS.PRIMARY,
  },
  langButtonText: {
    fontSize: 14,
    fontFamily: FONTS.BOLD,
    color: COLORS.TEXT_LIGHT,
  },
  langButtonTextActive: {
    color: COLORS.TEXT_WHITE,
  }
});
