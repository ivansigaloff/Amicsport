import { Stack, useRouter, useSegments } from 'expo-router';
import { useEffect, useState } from 'react';
import { View, ActivityIndicator } from 'react-native';
import { supabase } from '../../lib/supabase';
import { C } from '../../components/v2/ui';

/**
 * V2 (redesign) navigation root. Self-contained auth gate so /v2 works as a
 * standalone, testable version in parallel with the live v1 app. The root
 * layout (app/_layout.tsx) delegates all /v2 routing here.
 */
export default function V2Layout() {
  const router = useRouter();
  const segments = useSegments();
  const [session, setSession] = useState<any>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setReady(true);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const sub = (segments as string[])[1]; // segments[0] === 'v2'
    const inAuth = sub === 'login' || sub === 'reset-password';
    const validated = !!session?.user?.app_metadata?.role;

    if (!validated && !inAuth) {
      router.replace('/v2/login' as any);
    } else if (validated && inAuth) {
      router.replace('/v2' as any);
    }
  }, [ready, session, segments]);

  if (!ready) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" color={C.brand} />
      </View>
    );
  }

  // El cursor de tiza y el fondo de campo se montan en el layout raíz
  // (app/_layout.tsx) — la estética es global desde que v1 comparte piel.
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.bg } }} />;
}
