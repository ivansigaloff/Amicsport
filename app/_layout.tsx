import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect, useState } from 'react';
import { Platform, Alert } from 'react-native';
import { useRouter, useSegments, useGlobalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { supabase } from '../lib/supabase';
import { getUserIsDev } from '../lib/auth';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { EnvironmentProvider } from '../hooks/use-env';
import Constants from 'expo-constants';
import CookieBanner from '../components/CookieBanner';
import '../lib/i18n';
import { 
  useFonts, 
  Montserrat_400Regular, 
  Montserrat_500Medium, 
  Montserrat_600SemiBold, 
  Montserrat_700Bold,
  Montserrat_800ExtraBold 
} from '@expo-google-fonts/montserrat';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [session, setSession] = useState<any>(null);
  const [initialized, setInitialized] = useState(false);
  const segments = useSegments();
  const router = useRouter();
  const { from } = useGlobalSearchParams<{ from: string }>();

  const [fontsLoaded] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    Montserrat_800ExtraBold,
  });

  useEffect(() => {
    // 1. Check current session
    supabase.auth.getSession().then(({ data: { session: currentSession } }) => {
      setSession(currentSession);
      setInitialized(true);
    });

    // 2. Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      setSession(newSession);
      
      if (event === 'PASSWORD_RECOVERY' && segments[0] !== 'reset-password') {
        router.replace('/reset-password' as any);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!initialized) return;

    const inAuthGroup = segments[0] === 'login';
    const inDevGroup = segments[0] === 'dev';
    const isResetPage = segments[0] === 'reset-password';

    if (!session && !inAuthGroup && !isResetPage) {
      // Redirect to login if not authenticated, pass the current env if we were in dev
      const isDev = (segments[0] as any) === 'dev';
      router.replace(isDev ? '/login?from=dev' : '/login');
    } else if (session) {
      const isDevUser = getUserIsDev(session.user);
      
      // La validación de subdirectorio fue eliminada ya que /Kickerzbcn es ahora producción.
      if (isResetPage) {
        return;
      }

      if (inAuthGroup) {
        // Now dev users also go to tabs by default unless they manually go to /dev
        router.replace('/(tabs)');
      } else if (inDevGroup && !isDevUser) {
        // Protect /dev from normal users
        router.replace('/(tabs)');
        setTimeout(() => {
          if (Platform.OS === 'web') {
             window.alert('Acceso Denegado: Tu cuenta no tiene permisos para el entorno de desarrollo.');
          } else {
             Alert.alert('Acceso Denegado', 'Tu cuenta no tiene permisos para el entorno de desarrollo.');
          }
        }, 100);
      }
    }
  }, [session, segments, initialized, from]);

  if (!initialized || !fontsLoaded) return null;

  return (
    <EnvironmentProvider>
      <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
        <Head>
          <link rel="canonical" href={`https://multigraf.info/Kickerzbcn/${segments.join('/')}`} />
        </Head>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="dev" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <CookieBanner />
        <StatusBar style="auto" />
      </ThemeProvider>
    </EnvironmentProvider>
  );
}
