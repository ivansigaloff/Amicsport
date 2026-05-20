import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { supabase } from '../../../lib/supabase';
import { useEffect, useState } from 'react';
import { useEnv } from '../../../hooks/use-env';

export default function ProfileScreen() {
  const router = useRouter();
  const [profileName, setProfileName] = useState('Cargando...');
  const { fromTable } = useEnv();
  const [profileEmail, setProfileEmail] = useState('');

  useEffect(() => {
    async function loadProfile() {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const meta = user.user_metadata || {};
        setProfileName(meta.full_name || meta.name || user.email?.split('@')[0] || 'Usuario sin nombre');
        setProfileEmail(user.email || '');
      } else {
        setProfileName('No conectado');
      }
    }
    loadProfile();
  }, []);

  const handleLogout = async () => {
    const executeLogout = async () => {
      try {
        setProfileName('Cerrando sesión...');
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
        
        // Clear local cache if any and redirect
        router.replace('/login' as any);
      } catch (e: any) {
        console.log('Error al salir:', e);
        Alert.alert('Error', 'No se pudo cerrar la sesión: ' + e.message);
      }
    };

    if (Platform.OS === 'web') {
      const confirmar = window.confirm('¿Estás seguro de que quieres salir de la sesión?');
      if (confirmar) executeLogout();
    } else {
      Alert.alert(
        'Cerrar sesión',
        '¿Estás seguro de que quieres salir?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Sí, salir', style: 'destructive', onPress: executeLogout }
        ]
      );
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.avatarContainer}>
          <View style={styles.avatar}>
            <Text style={{color: '#556080', fontSize: 36, fontWeight: '900'}}>
              {profileName !== 'Cargando...' && profileName.length > 0 ? profileName.charAt(0).toUpperCase() : '?'}
            </Text>
          </View>
          <Text style={styles.name}>{profileName}</Text>
          <Text style={styles.level}>Nivel por determinar (DEV)</Text>
        </View>

        <View style={styles.statsContainer}>
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>12</Text>
            <Text style={styles.statLabel}>Partidos</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>8</Text>
            <Text style={styles.statLabel}>Goles</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.statBox}>
            <Text style={styles.statNumber}>4.8</Text>
            <Text style={styles.statLabel}>Val.</Text>
          </View>
        </View>

        <ScrollView style={styles.actionsContainer} showsVerticalScrollIndicator={false}>
          <TouchableOpacity 
            style={[styles.actionButton, { borderColor: '#556080', borderWidth: 1, backgroundColor: '#FFFFFF' }]} 
            onPress={() => router.push('/dev/admin/crear-partido' as any)}
          >
            <Ionicons name="add-circle" size={24} color="#556080" />
            <Text style={[styles.actionText, { color: '#556080', fontWeight: '800' }]}>Publicar un Partido</Text>
            <Ionicons name="chevron-forward" size={20} color="#556080" style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.actionButton}>
            <Ionicons name="settings-outline" size={24} color="#94A3B8" />
            <Text style={styles.actionText}>Ajustes de cuenta</Text>
            <Ionicons name="chevron-forward" size={20} color="#94A3B8" style={{ marginLeft: 'auto' }} />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionButton, styles.logoutButton]} onPress={handleLogout}>
            <Ionicons name="log-out-outline" size={24} color="#EF4444" />
            <Text style={[styles.actionText, styles.logoutText]}>Cerrar Sesión</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  container: { flex: 1, padding: 24 },
  avatarContainer: { alignItems: 'center', marginVertical: 40 },
  avatar: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#FFFFFF', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#556080', marginBottom: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 5 },
  name: { fontSize: 28, fontWeight: '900', color: '#0F172A' },
  level: { fontSize: 16, color: '#64748B', marginTop: 6, fontWeight: '600' },
  statsContainer: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 24, padding: 24, marginBottom: 40, borderWidth: 1, borderColor: '#F1F5F9', shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.03, shadowRadius: 8, elevation: 2 },
  statBox: { alignItems: 'center', flex: 1 },
  divider: { width: 1, height: 40, backgroundColor: '#F1F5F9' },
  statNumber: { fontSize: 24, fontWeight: '900', color: '#556080' },
  statLabel: { fontSize: 13, color: '#94A3B8', marginTop: 6, fontWeight: '700', textTransform: 'uppercase' },
  actionsContainer: { flex: 1 },
  actionButton: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', padding: 18, borderRadius: 20, marginBottom: 16, borderWidth: 1, borderColor: '#F1F5F9', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.02, shadowRadius: 4, elevation: 1 },
  actionText: { color: '#0F172A', fontSize: 16, marginLeft: 16, fontWeight: '700' },
  logoutButton: { marginTop: 20, backgroundColor: '#FEF2F2', borderColor: '#FEE2E2', borderWidth: 1 },
  logoutText: { color: '#C05E5E' }
});
