import { View, Text, StyleSheet, ActivityIndicator, Alert, Modal, FlatList, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect } from 'react';
import { supabase } from '../../../lib/supabase';
import AdminScreen from '../../../components/v2/admin/AdminScreen';
import { Field, Button, PressableScale, AnimatedEntrance, C, FONTS, R, S, SHADOW } from '../../../components/v2/ui';

export default function V2AdminPlayers() {
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchPlayers = async () => {
    setLoading(true);
    const { data } = await supabase.from('admin_players').select('*').order('name', { ascending: true });
    if (data) setPlayers(data);
    setLoading(false);
  };
  useEffect(() => { fetchPlayers(); }, []);

  const addPlayer = async () => {
    if (!newName.trim()) return Alert.alert('Error', 'El nombre es obligatorio.');
    setSaving(true);
    const { data, error } = await supabase.from('admin_players').insert({ name: newName.trim() }).select().single();
    if (!error && data) {
      setPlayers((prev) => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName(''); setShowModal(false);
    } else Alert.alert('Aviso', error?.message || 'No se pudo añadir el jugador.');
    setSaving(false);
  };

  const deletePlayer = (id: string, name: string) => {
    const run = async () => {
      const { error } = await supabase.from('admin_players').delete().eq('id', id);
      if (!error) setPlayers((prev) => prev.filter((p) => p.id !== id));
      else (Platform.OS === 'web' ? window.alert('Error: ' + error.message) : Alert.alert('Error', error.message));
    };
    if (Platform.OS === 'web') { if (window.confirm(`¿Borrar a ${name} del directorio?`)) run(); }
    else Alert.alert('Eliminar', `¿Borrar a ${name}?`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Eliminar', style: 'destructive', onPress: run }]);
  };

  const addBtn = (
    <PressableScale onPress={() => setShowModal(true)} style={styles.addBtn}><Ionicons name="add" size={22} color="#fff" /></PressableScale>
  );

  return (
    <AdminScreen title="Jugadores" subtitle="Directorio de invitados" headerRight={addBtn} scroll={false}>
      {loading ? (
        <ActivityIndicator color={C.brand} style={{ marginTop: 50 }} />
      ) : (
        <FlatList
          data={players}
          keyExtractor={(i) => i.id.toString()}
          contentContainerStyle={{ padding: S.lg, paddingBottom: 60, gap: 10, maxWidth: 680, width: '100%', alignSelf: 'center' }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="book-outline" size={60} color={C.textFaint} />
              <Text style={styles.emptyText}>No tienes jugadores en tu directorio.</Text>
              <Button title="Añadir el primero" icon="add" variant="brand" onPress={() => setShowModal(true)} />
            </View>
          }
          renderItem={({ item, index }) => (
            <AnimatedEntrance index={Math.min(index, 8)}>
              <View style={styles.card}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{item.name.charAt(0).toUpperCase()}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.sub}>Jugador invitado</Text>
                </View>
                <PressableScale onPress={() => deletePlayer(item.id, item.name)} style={styles.delete}><Ionicons name="trash-outline" size={20} color={C.danger} /></PressableScale>
              </View>
            </AnimatedEntrance>
          )}
        />
      )}

      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <View style={styles.overlay}>
          <View style={styles.sheet}>
            <View style={styles.handle} />
            <View style={styles.sheetHeader}><Text style={styles.sheetTitle}>Nuevo jugador</Text><PressableScale onPress={() => setShowModal(false)}><Ionicons name="close" size={26} color={C.textFaint} /></PressableScale></View>
            <Field label="Nombre y apellido" icon="person-outline" value={newName} onChangeText={setNewName} placeholder="Ej. Martín López" autoCapitalize="words" autoFocus />
            <Button title="GUARDAR JUGADOR" onPress={addPlayer} loading={saving} full size="lg" icon="save" style={{ marginTop: S.lg }} />
          </View>
        </View>
      </Modal>
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  addBtn: { width: 40, height: 40, borderRadius: R.md, backgroundColor: C.brand, alignItems: 'center', justifyContent: 'center', ...SHADOW.brand },
  empty: { alignItems: 'center', marginTop: 80, gap: 16 },
  emptyText: { color: C.textMuted, fontSize: 15, fontFamily: FONTS.medium, textAlign: 'center', maxWidth: 260 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, padding: 14, borderRadius: R.lg, borderWidth: 1, borderColor: C.border, gap: 14, ...SHADOW.sm },
  avatar: { width: 50, height: 50, backgroundColor: C.brandWash, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: C.brandDeep, fontSize: 20, fontFamily: FONTS.black },
  name: { color: C.text, fontSize: 16, fontFamily: FONTS.bold },
  sub: { color: C.textMuted, fontSize: 13, marginTop: 2, fontFamily: FONTS.medium },
  delete: { padding: 10, backgroundColor: C.dangerWash, borderRadius: R.sm },
  overlay: { flex: 1, backgroundColor: C.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: C.surface, borderTopLeftRadius: R.xl, borderTopRightRadius: R.xl, padding: S.xl, paddingBottom: S.huge, ...(Platform.OS === 'web' ? { maxWidth: 520, width: '100%', alignSelf: 'center' } : {}) },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: C.borderStrong, alignSelf: 'center', marginBottom: S.lg },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: S.lg },
  sheetTitle: { fontFamily: FONTS.extraBold, fontSize: 20, color: C.text },
});
