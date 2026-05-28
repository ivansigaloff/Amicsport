import { View, Text, TextInput, StyleSheet, TouchableOpacity, ImageBackground, Alert, ActivityIndicator, ScrollView, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { useEnv } from '../hooks/use-env';
import { getBaseUrl, validatePassword } from '../lib/share';
import { COLORS, FONTS, SHADOWS, SIZES } from '../constants/theme';
import Head from 'expo-router/head';

export default function LoginScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [isResetMode, setIsResetMode] = useState(false);
  const [inviteCode, setInviteCode] = useState('');

  const handleAuth = async () => {
    if (!email || !password) return Alert.alert(t('common.notice'), t('login.complete_fields_msg'));
    
    if (!isLoginMode) {
      const validation = validatePassword(password);
      if (!validation.isValid) {
        return Alert.alert(t('login.weak_password'), validation.message); // message is already translated in share.ts or dynamic
      }
    }
    
    setLoading(true);
    
    if (isLoginMode) {
      // Iniciar Sesión
      const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        Alert.alert(t('login.error_access'), error.message);
      } else {
        // Si el usuario llegó por la vía de email-confirmation (sin role asignado
        // todavía) y trae un pending_invite_code, lo procesamos AHORA.
        const user = signInData.user;
        const hasNoRole = !user?.app_metadata?.role || user.app_metadata.role === 'participant';
        const pendingCode = user?.user_metadata?.pending_invite_code;
        if (hasNoRole && pendingCode) {
          try {
            await supabase.functions.invoke('validate-invite', { body: { code: pendingCode } });
            // Best-effort: si falla por código inválido, dejamos al usuario como participant.
          } catch { /* no-op */ }
        }

        router.replace('/(tabs)' as any);
      }
    } else {
      if (!name.trim()) {
        setLoading(false);
        return Alert.alert(t('common.notice'), t('login.name_required'));
      }

      const code = inviteCode.trim();
      if (!code) {
        setLoading(false);
        return Alert.alert(t('login.access_denied'), t('login.invalid_invite'));
      }

      // SECURITY: invite codes are validated server-side by the validate-invite
      // Edge Function. Role/is_dev never travel in user_metadata (user-controlled);
      // the function writes them to app_metadata via the service role key.
      // SignUp only carries display data (full_name) y un `pending_invite_code`
      // que la function consumirá tras la confirmación de email (ver más abajo).
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name, pending_invite_code: code } },
      });
      if (signUpErr) {
        setLoading(false);
        return Alert.alert(t('login.error_register'), signUpErr.message);
      }

      // Si Supabase está en modo "email confirmation required", la session será null
      // y no podremos llamar la function autenticados todavía. En ese caso pedimos
      // al usuario que confirme y reintente al loguearse (asignación diferida).
      if (!signUpData.session) {
        Alert.alert(t('login.account_created'), t('login.account_created_msg'));
        setIsLoginMode(true);
        setLoading(false);
        return;
      }

      const { data: validation, error: validateErr } = await supabase.functions.invoke('validate-invite', {
        body: { code },
      });
      if (validateErr || !validation?.ok) {
        // El usuario quedó creado sin role asignado → sin permisos de admin.
        // Borrarlo desde el cliente no es posible (necesita service role); le
        // pedimos contactar al admin para escalarlo manualmente.
        const detail = (validateErr as any)?.message || validation?.error || 'invalid_invite';
        Alert.alert(t('login.access_denied'), `${t('login.invalid_invite')} (${detail})`);
        setLoading(false);
        return;
      }

      Alert.alert(t('login.account_created'), t('login.account_created_msg'));
      setIsLoginMode(true);
    }
    
    setLoading(false);
  };

  const handleResetPassword = async () => {
    if (!email) return Alert.alert(t('common.notice'), t('login.email_required_msg'));
    setLoading(true);
    
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${getBaseUrl()}/reset-password`,
    });

    if (error) {
      Alert.alert(t('common.error'), error.message);
    } else {
      Alert.alert(t('login.reset_link_sent'), t('login.reset_link_msg'));
      setIsResetMode(false);
    }
    setLoading(false);
  };

  return (
    <View style={{ flex: 1 }}>
      <Head>
        <link rel="canonical" href="https://multigraf.info/Kickerzbcn/login" />
      </Head>
      <ImageBackground 
      source={{ uri: 'https://images.unsplash.com/photo-1518605368461-1ee7e53028b1?q=80&w=800&auto=format&fit=crop' }} 
      style={styles.background}
    >
      <View style={styles.overlay}>
        <SafeAreaView style={styles.safeArea}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={styles.headerContainer}>
              <View style={[styles.logoContainer, SHADOWS.MEDIUM]}>
                <Ionicons name="football" size={44} color={COLORS.TEXT_WHITE} />
              </View>
              <Text style={styles.title}>AmicSport</Text>
              <Text style={styles.subtitle}>
                {isResetMode ? t('login.subtitle_reset') : (isLoginMode ? t('login.subtitle_login') : t('login.subtitle_signup'))}
              </Text>
            </View>

            <View style={styles.formContainer}>
              
              {isResetMode ? (
                <>
                  <View style={[styles.inputGroup, SHADOWS.SMALL]}>
                    <Ionicons name="mail-outline" size={20} color={COLORS.TEXT_LIGHT} style={styles.inputIcon} />
                    <TextInput 
                      style={styles.input}
                      placeholder={t('login.email')}
                      placeholderTextColor={COLORS.TEXT_MUTED}
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </View>

                  <TouchableOpacity 
                    style={[styles.loginButton, SHADOWS.MEDIUM, loading && { opacity: 0.7 }]} 
                    onPress={handleResetPassword}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color={COLORS.TEXT_WHITE} />
                    ) : (
                      <Text style={styles.loginButtonText}>{t('login.send_link')}</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => setIsResetMode(false)} style={styles.registerContainer}>
                    <Text style={styles.registerLink}>{t('login.back_to_login')}</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  {!isLoginMode && (
                    <View style={[styles.inputGroup, SHADOWS.SMALL]}>
                      <Ionicons name="person-outline" size={20} color={COLORS.TEXT_LIGHT} style={styles.inputIcon} />
                      <TextInput 
                        style={styles.input}
                        placeholder={t('login.name')}
                        placeholderTextColor={COLORS.TEXT_MUTED}
                        value={name}
                        onChangeText={setName}
                        autoCapitalize="words"
                      />
                    </View>
                  )}

                  <View style={[styles.inputGroup, SHADOWS.SMALL]}>
                    <Ionicons name="mail-outline" size={20} color={COLORS.TEXT_LIGHT} style={styles.inputIcon} />
                    <TextInput 
                      style={styles.input}
                      placeholder={t('login.email')}
                      placeholderTextColor={COLORS.TEXT_MUTED}
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </View>

                  <View style={[styles.inputGroup, SHADOWS.SMALL]}>
                    <Ionicons name="lock-closed-outline" size={20} color={COLORS.TEXT_LIGHT} style={styles.inputIcon} />
                    <TextInput 
                      style={styles.input}
                      placeholder={t('login.password_placeholder')}
                      placeholderTextColor={COLORS.TEXT_MUTED}
                      value={password}
                      onChangeText={setPassword}
                      secureTextEntry={!showPassword}
                    />
                    <TouchableOpacity onPress={() => setShowPassword(!showPassword)} style={styles.eyeIcon}>
                      <Ionicons name={showPassword ? "eye-outline" : "eye-off-outline"} size={20} color={COLORS.TEXT_LIGHT} />
                    </TouchableOpacity>
                  </View>

                  {!isLoginMode && (
                    <View style={[styles.inputGroup, SHADOWS.SMALL, { borderColor: COLORS.PRIMARY_LIGHT, borderWidth: 1 }]}>
                      <Ionicons name="key-outline" size={20} color={COLORS.PRIMARY} style={styles.inputIcon} />
                      <TextInput 
                        style={styles.input}
                        placeholder={t('login.invite_code')}
                        placeholderTextColor={COLORS.TEXT_MUTED}
                        value={inviteCode}
                        onChangeText={setInviteCode}
                        autoCapitalize="characters"
                      />
                    </View>
                  )}

                  {isLoginMode && (
                    <TouchableOpacity style={styles.forgotPassword} onPress={() => setIsResetMode(true)}>
                      <Text style={styles.forgotPasswordText}>{t('login.forgot_password')}</Text>
                    </TouchableOpacity>
                  )}

                  <TouchableOpacity 
                    style={[styles.loginButton, SHADOWS.MEDIUM, loading && { opacity: 0.7 }, !isLoginMode && { marginTop: 24 }]} 
                    onPress={handleAuth}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color={COLORS.TEXT_WHITE} />
                    ) : (
                      <Text style={styles.loginButtonText}>{isLoginMode ? t('login.login_btn') : t('login.signup_btn')}</Text>
                    )}
                  </TouchableOpacity>

                  <View style={styles.registerContainer}>
                    <Text style={styles.registerText}>
                      {isLoginMode ? t('login.no_account') : t('login.has_account')}
                    </Text>
                    <TouchableOpacity onPress={() => setIsLoginMode(!isLoginMode)} disabled={loading}>
                      <Text style={styles.registerLink}>
                        {isLoginMode ? t('login.register') : t('login.login_link')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          </ScrollView>
          <View style={{ paddingVertical: 10, alignItems: 'center', paddingBottom: 20 }}>
            <Text style={{ color: COLORS.TEXT_MUTED, fontSize: 12, fontFamily: FONTS.MEDIUM, textAlign: 'center', lineHeight: 18 }}>
              Powered by Eurekiano Solutions © 2026{'\n'}eurekianosolutions@gmail.com
            </Text>
            <Image 
              source={require('../assets/images/bombilla_completa_nobg.png')} 
              style={{
                width: 110,
                height: 110,
                marginTop: 16,
                resizeMode: 'contain',
                opacity: 0.9,
              }} 
            />
          </View>
        </SafeAreaView>
      </View>
    </ImageBackground>
    </View>
  );
}

const styles = StyleSheet.create({
  background: { flex: 1, width: '100%', height: '100%' },
  overlay: { flex: 1, backgroundColor: 'rgba(255, 255, 255, 0.94)' },
  safeArea: { flex: 1 },
  scrollContent: { flexGrow: 1, padding: 32, justifyContent: 'center' },
  headerContainer: { alignItems: 'center', marginBottom: 48 },
  logoContainer: { 
    width: 80, 
    height: 80, 
    borderRadius: 24, 
    backgroundColor: COLORS.PRIMARY, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginBottom: 24 
  },
  title: { fontSize: 36, fontFamily: FONTS.EXTRA_BOLD, color: COLORS.TEXT_MAIN, letterSpacing: -1 },
  subtitle: { fontSize: 16, color: COLORS.TEXT_MUTED, marginTop: 8, fontFamily: FONTS.MEDIUM },
  formContainer: { width: '100%' },
  inputGroup: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: COLORS.CARD_BG, 
    borderRadius: 16, 
    marginBottom: 16, 
    paddingHorizontal: 16, 
    borderWidth: 1, 
    borderColor: COLORS.BORDER_LIGHT 
  },
  inputIcon: { marginRight: 12 },
  input: { flex: 1, height: 56, color: COLORS.TEXT_MAIN, fontSize: 16, fontFamily: FONTS.MEDIUM },
  eyeIcon: { padding: 10 },
  forgotPassword: { alignSelf: 'flex-end', marginBottom: 24 },
  forgotPasswordText: { color: COLORS.PRIMARY, fontSize: 14, fontFamily: FONTS.BOLD },
  loginButton: { 
    backgroundColor: COLORS.PRIMARY, 
    height: 56, 
    borderRadius: 16, 
    justifyContent: 'center', 
    alignItems: 'center', 
    marginBottom: 24 
  },
  loginButtonText: { color: COLORS.TEXT_WHITE, fontSize: 16, fontFamily: FONTS.BOLD },
  registerContainer: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  registerText: { color: COLORS.TEXT_MUTED, fontSize: 14, fontFamily: FONTS.MEDIUM },
  registerLink: { color: COLORS.PRIMARY, fontSize: 14, fontFamily: FONTS.BOLD }
});
