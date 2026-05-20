import { View, Text, TextInput, StyleSheet, TouchableOpacity, ImageBackground, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { validatePassword } from '../lib/share';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sessionValid, setSessionValid] = useState<boolean | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    // Damos un pequeño margen para que Supabase procese el hash del URL
    const checkSession = async () => {
      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession) {
        // Segundo intento tras un breve delay si falla el primero
        setTimeout(async () => {
          const { data: { session: retrySession } } = await supabase.auth.getSession();
          setSessionValid(!!retrySession);
        }, 1000);
      } else {
        setSessionValid(true);
      }
    };
    checkSession();
  }, []);

  const handleUpdatePassword = async () => {
    if (!password || !confirmPassword) {
      return Alert.alert('Aviso', 'Por favor, completa ambos campos.');
    }
    const validation = validatePassword(password);
    if (!validation.isValid) {
      return Alert.alert('Contraseña débil', validation.message);
    }
    if (password !== confirmPassword) {
      return Alert.alert('Aviso', 'Las contraseñas no coinciden.');
    }

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      Alert.alert('Error', error.message);
    } else {
      setSuccess(true);
      await supabase.auth.signOut();
    }
    setLoading(false);
  };

  if (success) {
    return (
      <ImageBackground 
        source={{ uri: 'https://images.unsplash.com/photo-1518605368461-1ee7e53028b1?q=80&w=800&auto=format&fit=crop' }} 
        style={styles.background}
      >
        <View style={styles.overlay}>
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.container}>
              <View style={styles.headerContainer}>
                <Ionicons name="checkmark-circle" size={80} color="#10B981" />
                <Text style={styles.title}>¡Todo listo!</Text>
                <Text style={styles.subtitle}>Tu contraseña ha sido actualizada correctamente. Ya puedes acceder con tus nuevas credenciales.</Text>
                <TouchableOpacity style={[styles.loginButton, { width: '100%', marginTop: 30 }]} onPress={() => router.replace('/login')}>
                  <Text style={styles.loginButtonText}>INICIAR SESIÓN</Text>
                </TouchableOpacity>
              </View>
            </View>
          </SafeAreaView>
        </View>
      </ImageBackground>
    );
  }

  if (sessionValid === false) {
    return (
      <ImageBackground 
        source={{ uri: 'https://images.unsplash.com/photo-1518605368461-1ee7e53028b1?q=80&w=800&auto=format&fit=crop' }} 
        style={styles.background}
      >
        <View style={styles.overlay}>
          <SafeAreaView style={styles.safeArea}>
            <View style={styles.container}>
              <View style={styles.headerContainer}>
                <Ionicons name="alert-circle" size={80} color="#EF4444" />
                <Text style={styles.title}>Enlace Caducado</Text>
                <Text style={styles.subtitle}>Este enlace de recuperación ya no es válido o ha expirado. Por favor, solicita uno nuevo.</Text>
                <TouchableOpacity style={[styles.loginButton, { width: '100%', marginTop: 30 }]} onPress={() => router.replace('/login')}>
                  <Text style={styles.loginButtonText}>VOLVER AL INICIO</Text>
                </TouchableOpacity>
              </View>
            </View>
          </SafeAreaView>
        </View>
      </ImageBackground>
    );
  }

  if (sessionValid === null) {
     return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><ActivityIndicator size="large" color="#556080" /></View>;
  }

  return (
    <ImageBackground 
      source={{ uri: 'https://images.unsplash.com/photo-1518605368461-1ee7e53028b1?q=80&w=800&auto=format&fit=crop' }} 
      style={styles.background}
    >
      <View style={styles.overlay}>
        <SafeAreaView style={styles.safeArea}>
          <TouchableOpacity style={styles.backButton} onPress={() => router.replace('/login')}>
            <Ionicons name="arrow-back" size={24} color="#556080" />
            <Text style={styles.backText}>Volver</Text>
          </TouchableOpacity>

          <View style={styles.container}>
            <View style={styles.headerContainer}>
              <View style={styles.logoContainer}>
                <Ionicons name="lock-open" size={40} color="#FFFFFF" />
              </View>
              <Text style={styles.title}>Nueva Contraseña</Text>
              <Text style={styles.subtitle}>Escribe tu nueva contraseña para acceder</Text>
            </View>

            <View style={styles.formContainer}>
              <View style={styles.inputGroup}>
                <Ionicons name="lock-closed-outline" size={20} color="#94A3B8" style={styles.inputIcon} />
                <TextInput 
                  style={styles.input}
                  placeholder="Nueva contraseña (8+ car, Mayús, Núm, Simb)"
                  placeholderTextColor="#64748B"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry={!showPassword}
                />
                <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                  <Ionicons name={showPassword ? "eye-outline" : "eye-off-outline"} size={20} color="#94A3B8" />
                </TouchableOpacity>
              </View>

              <View style={styles.inputGroup}>
                <Ionicons name="lock-closed-outline" size={20} color="#94A3B8" style={styles.inputIcon} />
                <TextInput 
                  style={styles.input}
                  placeholder="Confirmar contraseña"
                  placeholderTextColor="#64748B"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showPassword}
                />
              </View>

              <TouchableOpacity 
                style={[styles.loginButton, loading && { opacity: 0.7 }]} 
                onPress={handleUpdatePassword}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <Text style={styles.loginButtonText}>ACTUALIZAR CONTRASEÑA</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1, width: '100%', height: '100%' },
  overlay: { flex: 1, backgroundColor: 'rgba(255, 255, 255, 0.92)' },
  safeArea: { flex: 1 },
  backButton: { flexDirection: 'row', alignItems: 'center', padding: 20, marginTop: 10 },
  backText: { color: '#556080', fontSize: 16, fontWeight: '700', marginLeft: 8 },
  container: { flex: 1, padding: 32, justifyContent: 'center' },
  headerContainer: { alignItems: 'center', marginBottom: 40 },
  logoContainer: { width: 84, height: 84, borderRadius: 42, backgroundColor: '#556080', justifyContent: 'center', alignItems: 'center', marginBottom: 20, shadowColor: '#556080', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.3, shadowRadius: 12, elevation: 12 },
  title: { fontSize: 32, fontWeight: '900', color: '#0F172A', textAlign: 'center' },
  subtitle: { fontSize: 16, color: '#64748B', marginTop: 8, fontWeight: '600', textAlign: 'center' },
  formContainer: { width: '100%' },
  inputGroup: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFFFFF', borderRadius: 20, marginBottom: 20, paddingHorizontal: 20, borderWidth: 1, borderColor: '#F1F5F9', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.03, shadowRadius: 4, elevation: 2 },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, height: 60, color: '#0F172A', fontSize: 16, fontWeight: '500' },
  eyeIcon: { padding: 10 },
  loginButton: { backgroundColor: '#556080', height: 60, borderRadius: 30, justifyContent: 'center', alignItems: 'center', marginTop: 10, shadowColor: '#556080', shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 6 },
  loginButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: 1 }
});
