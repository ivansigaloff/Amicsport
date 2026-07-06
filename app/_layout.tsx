import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import 'react-native-reanimated';
import { useEffect, useState } from 'react';
import { useRouter, useSegments } from 'expo-router';
import Head from 'expo-router/head';
import { supabase } from '../lib/supabase';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { EnvironmentProvider } from '../hooks/use-env';
import Constants from 'expo-constants';
import CookieBanner from '../components/CookieBanner';
import ChalkCursor from '../components/v2/ChalkCursor';
import PitchStripes from '../components/v2/PitchStripes';
import '../lib/i18n';
import {
  useFonts,
  Montserrat_400Regular,
  Montserrat_500Medium,
  Montserrat_600SemiBold,
  Montserrat_700Bold,
  Montserrat_800ExtraBold
} from '@expo-google-fonts/montserrat';
// V2 «La Convocatoria»
import { Anton_400Regular } from '@expo-google-fonts/anton';
import {
  Archivo_400Regular,
  Archivo_500Medium,
  Archivo_600SemiBold,
  Archivo_700Bold,
  Archivo_800ExtraBold,
} from '@expo-google-fonts/archivo';
import { IBMPlexMono_400Regular, IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [session, setSession] = useState<any>(null);
  const [initialized, setInitialized] = useState(false);
  const segments = useSegments();
  const router = useRouter();

  const [fontsLoaded] = useFonts({
    Montserrat_400Regular,
    Montserrat_500Medium,
    Montserrat_600SemiBold,
    Montserrat_700Bold,
    Montserrat_800ExtraBold,
    Anton_400Regular,
    Archivo_400Regular,
    Archivo_500Medium,
    Archivo_600SemiBold,
    Archivo_700Bold,
    Archivo_800ExtraBold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
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

    // V2 redesign lives under /v2 and runs its own auth gate (app/v2/_layout).
    // Don't apply the v1 redirects there so the parallel version is reachable
    // and self-contained for testing. (v1 paths never start with 'v2'.)
    if (segments[0] === 'v2') return;

    const inAuthGroup = segments[0] === 'login';
    const isResetPage = segments[0] === 'reset-password';

    // Invite-only: a session without a validated role (app_metadata.role, set by
    // validate-invite) is NOT granted access — e.g. a signup whose invite code
    // failed. All legitimate users have a role, so this only blocks orphans.
    const validated = !!session?.user?.app_metadata?.role;

    if (!validated && !inAuthGroup && !isResetPage) {
      router.replace('/login');
    } else if (validated) {
      // La validación de subdirectorio fue eliminada ya que /Kickerzbcn es ahora producción.
      if (isResetPage) {
        return;
      }

      if (inAuthGroup) {
        router.replace('/(tabs)');
      }
    }
  }, [session, segments, initialized]);

  if (!initialized || !fontsLoaded) return null;

  return (
    <EnvironmentProvider>
      <ThemeProvider
        value={(() => {
          const base = colorScheme === 'dark' ? DarkTheme : DefaultTheme;
          // En web el fondo del navegador queda transparente para que se vea
          // la capa fija del campo (franjas + tiza) de PitchStripes.
          return Constants.platform?.web || typeof document !== 'undefined'
            ? { ...base, colors: { ...base.colors, background: 'transparent' } }
            : base;
        })()}
      >
        <Head>
          <link rel="canonical" href={`https://multigraf.info/Kickerzbcn/${segments.join('/')}`} />
        </Head>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="v2" options={{ headerShown: false }} />
          <Stack.Screen name="login" options={{ headerShown: false }} />
          <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
        </Stack>
        <CookieBanner />
        {/* estética global «La Convocatoria»: cursor de tiza + fondo de campo */}
        <ChalkCursor />
        <PitchStripes />
        <StatusBar style="auto" />
      </ThemeProvider>
    </EnvironmentProvider>
  );
}
