// Admin supervision panel for WhatsApp conversations. Reads whatsapp_messages
// (admin-only RLS). Isolated: not linked from any nav yet — reachable at
// /admin/whatsapp. Link it from the admin actions at integration time.
import { View, Text, StyleSheet, FlatList, TextInput, ActivityIndicator, TouchableOpacity, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../lib/supabase';
import { computeIsAdmin } from '../../lib/auth';

type Msg = {
  id: string;
  phone: string;
  direction: 'in' | 'out';
  body: string | null;
  created_at: string;
};

export default function WhatsappPanel() {
  const router = useRouter();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [search, setSearch] = useState('');

  const fetchMessages = async () => {
    const { data } = await supabase
      .from('whatsapp_messages')
      .select('id, phone, direction, body, created_at')
      .order('created_at', { ascending: false })
      .limit(300);
    setMessages((data as Msg[]) ?? []);
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const isAdmin = computeIsAdmin(user);
      setAuthorized(isAdmin);
      if (isAdmin) await fetchMessages();
      else setLoading(false);
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter(m =>
      m.phone?.toLowerCase().includes(q) || (m.body ?? '').toLowerCase().includes(q));
  }, [messages, search]);

  if (authorized === null || (authorized && loading)) {
    return <View style={styles.center}><ActivityIndicator color="#0F172A" /></View>;
  }
  if (authorized === false) {
    return (
      <SafeAreaView style={styles.centerPad}>
        <Ionicons name="lock-closed-outline" size={48} color="#94A3B8" />
        <Text style={styles.noAccess}>Solo accesible para administradores</Text>
        <TouchableOpacity onPress={() => router.replace('/(tabs)' as any)}>
          <Text style={styles.back}>Volver</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={{ marginRight: 12 }}>
          <Ionicons name="chevron-back" size={26} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.title}>Conversaciones WhatsApp</Text>
      </View>

      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color="#94A3B8" />
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por teléfono o texto…"
          placeholderTextColor="#94A3B8"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchMessages(); }} />}
        ListEmptyComponent={<Text style={styles.empty}>Sin mensajes.</Text>}
        renderItem={({ item }) => {
          const out = item.direction === 'out';
          return (
            <View style={[styles.row, out ? styles.rowOut : styles.rowIn]}>
              <View style={[styles.bubble, out ? styles.bubbleOut : styles.bubbleIn]}>
                <Text style={styles.meta}>
                  {out ? '↗ bot' : `↘ ${item.phone}`} · {new Date(item.created_at).toLocaleString('es-ES')}
                </Text>
                <Text style={styles.body}>{item.body || '(sin texto)'}</Text>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F8FAFC' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  centerPad: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
  noAccess: { color: '#64748B', fontSize: 16, textAlign: 'center' },
  back: { color: '#0F172A', fontWeight: '700' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 16, paddingBottom: 8 },
  title: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFF', borderColor: '#E2E8F0', borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, marginHorizontal: 12, marginBottom: 4, height: 44 },
  searchInput: { flex: 1, color: '#0F172A', fontSize: 15 },
  empty: { textAlign: 'center', color: '#94A3B8', marginTop: 40 },
  row: { marginBottom: 8, flexDirection: 'row' },
  rowIn: { justifyContent: 'flex-start' },
  rowOut: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '85%', borderRadius: 14, padding: 10, borderWidth: 1 },
  bubbleIn: { backgroundColor: '#FFFFFF', borderColor: '#E2E8F0' },
  bubbleOut: { backgroundColor: '#DCFCE7', borderColor: '#BBF7D0' },
  meta: { fontSize: 11, color: '#64748B', marginBottom: 3 },
  body: { fontSize: 15, color: '#0F172A' },
});
