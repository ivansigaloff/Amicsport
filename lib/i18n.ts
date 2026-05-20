import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import * as Localization from 'expo-localization';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import es from '../locales/es.json';
import en from '../locales/en.json';
import ca from '../locales/ca.json';

const resources = {
  es: { translation: es },
  en: { translation: en },
  ca: { translation: ca },
};

const LANGUAGE_KEY = '@app_language';

const initI18n = async () => {
  let savedLanguage = 'es';
  
  // Check if we are in a client environment (browser) or mobile
  if (Platform.OS !== 'web' || typeof window !== 'undefined') {
    try {
      const stored = await AsyncStorage.getItem(LANGUAGE_KEY);
      if (stored) {
        savedLanguage = stored;
      } else {
        savedLanguage = 'es';
      }
    } catch (e) {
      console.warn('i18n: Error loading saved language', e);
    }
  }

  i18n
    .use(initReactI18next)
    .init({
      resources,
      lng: savedLanguage,
      fallbackLng: 'es',
      interpolation: {
        escapeValue: false,
      },
      react: {
        useSuspense: false,
      }
    });
};

initI18n();

export default i18n;
