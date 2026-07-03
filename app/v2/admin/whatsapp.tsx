import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect, useMemo } from 'react';
import { supabase } from '../../../lib/supabase';
import AdminScreen from '../../../components/v2/admin/AdminScreen';
import { Field, AnimatedEntrance, C, FONTS, R, S } from '../../../components/v2/ui';

type Msg = { id: string; phone: string; direction: 'in' | 'out'; body: string | null; created_at: string };

export default function V2AdminWhatsapp() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [search, setSearch] = useState('');

  const fetchMessages = async () => {
    const { data } = await supabase.from('whatsapp_messages').select('id, phone, direction, body, created_at').order('created_at', { ascending: false }).limit(300);
    setMessages((data as Msg[]) ?? []);
    setLoading(false); setRefreshing(false);
  };
  useEffect(() => { fetchMessages(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return messages;
    return messages.filter((m) => m.phone?.toLowerCase().includes(q) || (m.body ?? '').toLowerCase().includes(q));
  }, [messages, search]);

  return (
    <AdminScreen title="WhatsApp" subtitle="Supervisión de conversaciones" onRefresh={() => { setRefreshing(true); fetchMessages(); }} scroll={false}>
      <View style={{ paddingHorizontal: S.lg, paddingTop: S.md }}>
        <Field icon="search" placeholder="Buscar por teléfono o texto…" value={search} onChangeText={setSearch} autoCapitalize="none" />
      </View>
      {loading ? (
        <ActivityIndicator color={C.brand} style={{ marginTop: 50 }} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: S.lg, paddingBottom: 60, gap: 8, maxWidth: 720, width: '100%', alignSelf: 'center' }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchMessages(); }} tintColor={C.brand} colors={[C.brand]} />}
          ListEmptyComponent={<Text style={styles.empty}>Sin mensajes.</Text>}
          renderItem={({ item, index }) => {
            const out = item.direction === 'out';
            return (
              <AnimatedEntrance index={Math.min(index, 8)}>
                <View style={[styles.row, { justifyContent: out ? 'flex-end' : 'flex-start' }]}>
                  <View style={[styles.bubble, out ? styles.bubbleOut : styles.bubbleIn]}>
                    <Text style={styles.meta}>{out ? '↗ bot' : `↘ ${item.phone}`} · {new Date(item.created_at).toLocaleString('es-ES')}</Text>
                    <Text style={[styles.body, out && { color: C.brandDeep }]}>{item.body || '(sin texto)'}</Text>
                  </View>
                </View>
              </AnimatedEntrance>
            );
          }}
        />
      )}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  empty: { textAlign: 'center', color: C.textFaint, marginTop: 40, fontFamily: FONTS.medium },
  row: { flexDirection: 'row' },
  bubble: { maxWidth: '85%', borderRadius: R.md, padding: 12, borderWidth: 1.5 },
  bubbleIn: { backgroundColor: C.surface, borderColor: C.ink, borderTopLeftRadius: 4 },
  bubbleOut: { backgroundColor: C.brandWash, borderColor: C.ink, borderTopRightRadius: 4 },
  meta: { fontSize: 11, color: C.textMuted, marginBottom: 4, fontFamily: FONTS.medium },
  body: { fontSize: 15, color: C.text, fontFamily: FONTS.medium },
});
