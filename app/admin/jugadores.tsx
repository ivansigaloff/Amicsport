import { View, Text, StyleSheet, TextInput, TouchableOpacity, ActivityIndicator, Alert, Modal, FlatList, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useEnv } from '../../hooks/use-env';
import { computeIsAdmin } from '../../lib/auth';

export default function ManagePlayersScreen() {
  const router = useRouter();
  const [players, setPlayers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [playerToDelete, setPlayerToDelete] = useState<{id: string, name: string} | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const { fromTable, env } = useEnv();

  const fetchPlayers = async () => {
    setLoading(true);
    const { data: pData } = await supabase
      .from(fromTable('admin_players'))
      .select('*')
      .order('name', { ascending: true });
      
    if (pData) {
      setPlayers(pData);
    }
    setLoading(false);
  };

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const isAdmin = computeIsAdmin(user, env as 'prod' | 'dev');
      setAuthorized(isAdmin);
      if (isAdmin) await fetchPlayers();
      else setLoading(false);
    })();
  }, [env]);

  const handleAddPlayer = async () => {
    if (!newPlayerName.trim()) {
      return Alert.alert('Error', 'El nombre es obligatorio.');
    }
    setSaving(true);
    
    const { data, error } = await supabase
      .from(fromTable('admin_players'))
      .insert({ name: newPlayerName.trim() })
      .select()
      .single();
      
    if (!error && data) {
      setPlayers(prev => [...prev, data].sort((a,b) => a.name.localeCompare(b.name)));
      setNewPlayerName('');
      setShowModal(false);
      Alert.alert('¡Añadido!', 'El jugador ya está en tu directorio.');
    } else {
      Alert.alert('Aviso', 'Es posible que aún no hayas creado la tabla en Supabase.');
    }
    
    setSaving(false);
  };

  const executeDelete = async () => {
    if (!playerToDelete) return;
    const { error } = await supabase.from(fromTable('admin_players')).delete().eq('id', playerToDelete.id);
    if (!error) {
      setPlayers(prev => prev.filter(p => p.id !== playerToDelete.id));
      setShowDeleteConfirm(false);
      setPlayerToDelete(null);
    } else {
      if (Platform.OS === 'web') window.alert('Error: ' + error.message);
      else Alert.alert('Error', error.message);
    }
  };

  const handleDeletePlayer = async (id: string, name: string) => {
    if (Platform.OS === 'web') {
      setPlayerToDelete({ id, name });
      setShowDeleteConfirm(true);
    } else {
      Alert.alert('Eliminar', `¿Borrar a ${name} del directorio?`, [
        { text: 'Cancelar', style: 'cancel' },
        { 
          text: 'Eliminar', 
          style: 'destructive',
          onPress: async () => {
            const { error } = await supabase.from(fromTable('admin_players')).delete().eq('id', id);
            if (!error) {
              setPlayers(prev => prev.filter(p => p.id !== id));
            } else {
              Alert.alert('Error', error.message);
            }
          }
        }
      ]);
    }
  };

  // Admin-only route guard (RLS already protects the data; this blocks the UI).
  if (authorized === null || (authorized && loading)) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color="#0F172A" /></View>;
  }
  if (authorized === false) {
    return (
      <SafeAreaView style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 }}>
        <Ionicons name="lock-closed-outline" size={48} color="#94A3B8" />
        <Text style={{ color: '#64748B', fontSize: 16, textAlign: 'center' }}>Solo accesible para administradores</Text>
        <TouchableOpacity onPress={() => router.replace('/(tabs)' as any)}>
          <Text style={{ color: '#0F172A', fontWeight: '700' }}>Volver</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color="#0F172A" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Directorio de Jugadores</Text>
        <TouchableOpacity style={styles.addButton} onPress={() => setShowModal(true)}>
          <Ionicons name="add" size={24} color="#FFF" />
        </TouchableOpacity>
      </View>

      <View style={styles.container}>
        {loading ? (
          <ActivityIndicator color="#FF4757" style={{ marginTop: 50 }} />
        ) : (
          <FlatList
            data={players}
            keyExtractor={item => item.id.toString()}
            contentContainerStyle={{ paddingBottom: 40 }}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="book-outline" size={64} color="#CBD5E1" />
                <Text style={styles.emptyText}>No tienes jugadores manuales en tu directorio.</Text>
                <TouchableOpacity onPress={() => setShowModal(true)} style={styles.emptyBtn}>
                  <Text style={styles.emptyBtnText}>+ Añadir el primero</Text>
                </TouchableOpacity>
              </View>
            }
            renderItem={({ item }) => (
              <View style={styles.playerCard}>
                <View style={styles.playerAvatarLarge}>
                  <Text style={styles.initialText}>{item.name.charAt(0).toUpperCase()}</Text>
                </View>
                <View style={styles.playerInfo}>
                  <Text style={styles.playerName}>{item.name}</Text>
                  <Text style={styles.playerSub}>Jugador Invitado</Text>
                </View>
                <TouchableOpacity onPress={() => handleDeletePlayer(item.id, item.name)} style={styles.deleteBtn}>
                  <Ionicons name="trash-outline" size={22} color="#C05E5E" />
                </TouchableOpacity>
              </View>
            )}
          />
        )}
      </View>

      <Modal visible={showModal} transparent={true} animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Nuevo Jugador</Text>
              <TouchableOpacity onPress={() => setShowModal(false)}>
                <Ionicons name="close" size={28} color="#64748B" />
              </TouchableOpacity>
            </View>
            
            <View style={styles.formGroup}>
              <Text style={styles.label}>Nombre y Apellido</Text>
              <TextInput 
                style={styles.input} 
                value={newPlayerName} 
                onChangeText={setNewPlayerName} 
                placeholder="Ej. Martín López" 
                placeholderTextColor="#94A3B8" 
                autoCapitalize="words"
                autoFocus
              />
            </View>

            <TouchableOpacity 
              style={[styles.submitButton, saving && { opacity: 0.7 }]} 
              onPress={handleAddPlayer} 
              disabled={saving}
            >
              {saving ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.submitButtonText}>GUARDAR JUGADOR</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Custom Deletion Confirmation Modal for Web/Reliability */}
      <Modal visible={showDeleteConfirm} transparent={true} animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { height: 'auto', paddingBottom: 40 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Confirmar Borrado</Text>
              <TouchableOpacity onPress={() => { setShowDeleteConfirm(false); setPlayerToDelete(null); }}>
                <Ionicons name="close" size={28} color="#94A3B8" />
              </TouchableOpacity>
            </View>
            
            <Text style={{ fontSize: 16, color: '#64748B', lineHeight: 24, marginBottom: 32 }}>
              ¿Estás seguro de que quieres eliminar a <Text style={{fontWeight: '800', color: '#0F172A'}}>{playerToDelete?.name}</Text> de tu directorio de jugadores?
            </Text>

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <TouchableOpacity 
                style={{ flex: 1, backgroundColor: '#F1F5F9', padding: 16, borderRadius: 16, alignItems: 'center' }}
                onPress={() => { setShowDeleteConfirm(false); setPlayerToDelete(null); }}
              >
                <Text style={{ fontWeight: '700', color: '#64748B' }}>CANCELAR</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={{ flex: 1, backgroundColor: '#C05E5E', padding: 16, borderRadius: 16, alignItems: 'center' }}
                onPress={executeDelete}
              >
                <Text style={{ fontWeight: '800', color: '#FFFFFF' }}>BORRAR</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9', backgroundColor: '#FFFFFF' },
  backButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center' },
  addButton: { width: 44, height: 44, borderRadius: 12, backgroundColor: '#FFB81C', justifyContent: 'center', alignItems: 'center', shadowColor: '#FFB81C', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 6, elevation: 4 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  container: { flex: 1, padding: 24 },
  playerCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 16, borderRadius: 20, marginBottom: 16, borderWidth: 1, borderColor: '#F1F5F9', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8, elevation: 2 },
  playerAvatarLarge: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#F1F5F9', justifyContent: 'center', alignItems: 'center', marginRight: 16 },
  initialText: { color: '#FFB81C', fontSize: 20, fontWeight: '800' },
  playerInfo: { flex: 1 },
  playerName: { color: '#0F172A', fontSize: 17, fontWeight: '700' },
  playerSub: { color: '#64748B', fontSize: 14, marginTop: 4, fontWeight: '500' },
  deleteBtn: { padding: 10, backgroundColor: '#FEF2F2', borderRadius: 12 },
  emptyContainer: { alignItems: 'center', justifyContent: 'center', marginTop: 100 },
  emptyText: { color: '#64748B', fontSize: 16, marginTop: 16, marginBottom: 24, textAlign: 'center', fontWeight: '500', maxWidth: '80%' },
  emptyBtn: { paddingHorizontal: 24, paddingVertical: 14, backgroundColor: '#F1F5F9', borderRadius: 20, borderWidth: 1, borderColor: '#E0E7FF' },
  emptyBtnText: { color: '#FFB81C', fontWeight: '800' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(15, 23, 42, 0.7)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: '#FFFFFF', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: 50 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#F1F5F9' },
  modalTitle: { fontSize: 22, fontWeight: '900', color: '#0F172A' },
  formGroup: { marginBottom: 24 },
  label: { fontSize: 14, color: '#64748B', marginBottom: 10, fontWeight: '700' },
  input: { backgroundColor: '#F8FAFC', borderRadius: 16, borderWidth: 1, borderColor: '#F1F5F9', color: '#0F172A', fontSize: 16, padding: 18, fontWeight: '500' },
  submitButton: { backgroundColor: '#FFB81C', padding: 20, borderRadius: 20, alignItems: 'center', marginTop: 10, shadowColor: '#FFB81C', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8, elevation: 6 },
  submitButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: 0.5 },
});
