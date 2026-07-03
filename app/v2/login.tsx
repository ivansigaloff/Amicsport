import { View, Text, StyleSheet, TouchableOpacity, Alert, ActivityIndicator, ScrollView, Platform } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import Head from 'expo-router/head';
import { supabase } from '../../lib/supabase';
import { getBaseUrl, validatePassword } from '../../lib/share';
import { Button, Field, AnimatedEntrance, C, FONTS, GRADIENTS, R, S, SHADOW } from '../../components/v2/ui';

export default function V2Login() {
  const { t } = useTranslation();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [isLoginMode, setIsLoginMode] = useState(true);
  const [isResetMode, setIsResetMode] = useState(false);
  const [inviteCode, setInviteCode] = useState('');

  // --- Auth logic mirrors v1 (app/login.tsx); only the destination is /v2. ---
  const handleAuth = async () => {
    if (!email || !password) return Alert.alert(t('common.notice'), t('login.complete_fields_msg'));
    if (!isLoginMode) {
      const validation = validatePassword(password);
      if (!validation.isValid) return Alert.alert(t('login.weak_password'), validation.message);
    }
    setLoading(true);
    if (isLoginMode) {
      const { data: signInData, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        Alert.alert(t('login.error_access'), error.message);
      } else {
        const user = signInData.user;
        const hasNoRole = !user?.app_metadata?.role || user.app_metadata.role === 'participant';
        const pendingCode = user?.user_metadata?.pending_invite_code;
        if (hasNoRole && pendingCode) {
          try { await supabase.functions.invoke('validate-invite', { body: { code: pendingCode } }); } catch {}
        }
        router.replace('/v2' as any);
      }
    } else {
      if (!name.trim()) { setLoading(false); return Alert.alert(t('common.notice'), t('login.name_required')); }
      const code = inviteCode.trim();
      if (!code) { setLoading(false); return Alert.alert(t('login.access_denied'), t('login.invalid_invite')); }
      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email, password, options: { data: { full_name: name, pending_invite_code: code } },
      });
      if (signUpErr) { setLoading(false); return Alert.alert(t('login.error_register'), signUpErr.message); }
      if (!signUpData.session) {
        Alert.alert(t('login.account_created'), t('login.account_created_msg'));
        setIsLoginMode(true); setLoading(false); return;
      }
      const { data: validation, error: validateErr } = await supabase.functions.invoke('validate-invite', { body: { code } });
      if (validateErr || !validation?.ok) {
        await supabase.auth.signOut();
        const detail = (validateErr as any)?.message || validation?.error || 'invalid_invite';
        Alert.alert(t('login.access_denied'), `${t('login.invalid_invite')} (${detail})`);
        setIsLoginMode(true); setLoading(false); return;
      }
      Alert.alert(t('login.account_created'), t('login.account_created_msg'));
      setIsLoginMode(true);
    }
    setLoading(false);
  };

  const handleResetPassword = async () => {
    if (!email) return Alert.alert(t('common.notice'), t('login.email_required_msg'));
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${getBaseUrl()}/reset-password` });
    if (error) Alert.alert(t('common.error'), error.message);
    else { Alert.alert(t('login.reset_link_sent'), t('login.reset_link_msg')); setIsResetMode(false); }
    setLoading(false);
  };

  const subtitle = isResetMode ? t('login.subtitle_reset') : isLoginMode ? t('login.subtitle_login') : t('login.subtitle_signup');

  return (
    <View style={{ flex: 1 }}>
      <Head><title>AmicSport</title></Head>
      <LinearGradient colors={GRADIENTS.inkBrand as any} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill as any} />

      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          <AnimatedEntrance distance={18}>
            <View style={styles.brandHead}>
              <View style={styles.logo}>
                <Ionicons name="football" size={38} color={C.text} />
              </View>
              <Text style={styles.title}>AmicSport</Text>
              <Text style={styles.subtitle}>{subtitle}</Text>
            </View>
          </AnimatedEntrance>

          <AnimatedEntrance delay={90} distance={22}>
            <View style={styles.card}>
              {!isResetMode && (
                <View style={styles.segment}>
                  {[{ k: true, label: t('login.login_btn') }, { k: false, label: t('login.signup_btn') }].map((opt) => {
                    const active = isLoginMode === opt.k;
                    return (
                      <TouchableOpacity
                        key={String(opt.k)}
                        activeOpacity={0.8}
                        onPress={() => setIsLoginMode(opt.k)}
                        style={[styles.segmentBtn, active && styles.segmentBtnActive]}
                      >
                        <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              <View style={{ gap: 14 }}>
                {isResetMode ? (
                  <>
                    <Field icon="mail-outline" placeholder={t('login.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
                    <Button title={t('login.send_link')} onPress={handleResetPassword} loading={loading} full size="lg" />
                    <TouchableOpacity onPress={() => setIsResetMode(false)} style={{ alignSelf: 'center', padding: 6 }}>
                      <Text style={styles.link}>{t('login.back_to_login')}</Text>
                    </TouchableOpacity>
                  </>
                ) : (
                  <>
                    {!isLoginMode && (
                      <Field icon="person-outline" placeholder={t('login.name')} value={name} onChangeText={setName} autoCapitalize="words" />
                    )}
                    <Field icon="mail-outline" placeholder={t('login.email')} value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" />
                    <Field icon="lock-closed-outline" placeholder={t('login.password_placeholder')} value={password} onChangeText={setPassword} secureToggle />
                    {!isLoginMode && (
                      <Field icon="key-outline" placeholder={t('login.invite_code')} value={inviteCode} onChangeText={setInviteCode} autoCapitalize="characters" />
                    )}
                    {isLoginMode && (
                      <TouchableOpacity onPress={() => setIsResetMode(true)} style={{ alignSelf: 'flex-end' }}>
                        <Text style={styles.link}>{t('login.forgot_password')}</Text>
                      </TouchableOpacity>
                    )}
                    <Button title={isLoginMode ? t('login.login_btn') : t('login.signup_btn')} onPress={handleAuth} loading={loading} full size="lg" iconRight="arrow-forward" />
                  </>
                )}
              </View>
            </View>
          </AnimatedEntrance>

          <Text style={styles.footer}>Powered by Eurekiano Solutions © 2026</Text>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 1, justifyContent: 'center', padding: S.xxl, paddingBottom: S.huge },
  brandHead: { alignItems: 'center', marginBottom: S.xxl },
  logo: { width: 76, height: 76, backgroundColor: '#fff', borderWidth: 2, borderColor: C.ink, alignItems: 'center', justifyContent: 'center', marginBottom: S.lg, ...SHADOW.md },
  title: { fontSize: 36, fontFamily: FONTS.black, color: '#fff', letterSpacing: 1, textTransform: 'uppercase' },
  subtitle: { fontSize: 15, color: 'rgba(255,255,255,0.72)', marginTop: 6, fontFamily: FONTS.medium, textAlign: 'center' },
  card: { width: '100%', maxWidth: 440, alignSelf: 'center', backgroundColor: C.surface, borderRadius: R.xl, borderWidth: 2, borderColor: C.ink, padding: S.xxl, ...SHADOW.lg },
  segment: { flexDirection: 'row', backgroundColor: C.surfaceAlt, borderRadius: R.md, padding: 5, marginBottom: S.xl },
  segmentBtn: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: R.sm },
  segmentBtnActive: { backgroundColor: C.surface, borderWidth: 1.5, borderColor: C.ink, ...SHADOW.sm },
  segmentText: { fontFamily: FONTS.bold, fontSize: 14, color: C.textMuted },
  segmentTextActive: { color: C.brandDeep },
  link: { color: C.brandStrong, fontSize: 13.5, fontFamily: FONTS.bold, padding: 2 },
  footer: { textAlign: 'center', color: 'rgba(255,255,255,0.5)', fontSize: 12, fontFamily: FONTS.medium, marginTop: S.xxl },
});
