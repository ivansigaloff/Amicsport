import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Alert, Platform, ScrollView, KeyboardAvoidingView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { computeIsAdmin } from '../../lib/auth';
import { useEnv } from '../../hooks/use-env';
import { getRefundLimits, updateRefundLimits } from '../../lib/services/settingsService';
import { COLORS, FONTS, SIZES, SHADOWS } from '../../constants/theme';

// Admin-only screen to configure the daily refund limits (app_settings).
// Mirrors app/admin/pagos.tsx conventions: hardcoded Spanish (no i18n on admin
// screens), computeIsAdmin/useEnv gate, flat brand theme.
export default function AdminSettingsScreen() {
  const router = useRouter();
  const { env } = useEnv();

  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Edited as strings; parsed/validated on save. Amount is shown in EUROS.
  const [countInput, setCountInput] = useState('');
  const [amountEurosInput, setAmountEurosInput] = useState('');

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const isAdmin = computeIsAdmin(user, env as 'prod' | 'dev');
      setAuthorized(isAdmin);
      if (isAdmin) await loadSettings();
      else setLoading(false);
    })();
  }, [env]);

  const loadSettings = async () => {
    setLoading(true);
    try {
      const { countLimit, amountLimitCents } = await getRefundLimits();
      setCountInput(String(countLimit));
      setAmountEurosInput((amountLimitCents / 100).toFixed(2));
    } catch {
      showMsg('Error', 'No se pudieron cargar los ajustes.');
    } finally {
      setLoading(false);
    }
  };

  const showMsg = (title: string, msg: string) => {
    if (Platform.OS === 'web') window.alert(`${title}: ${msg}`);
    else Alert.alert(title, msg);
  };

  const handleSave = async () => {
    const count = Number(countInput.trim());
    if (!Number.isInteger(count) || count < 0) {
      showMsg('Dato inválido', 'El máximo de reembolsos debe ser un número entero ≥ 0.');
      return;
    }
    const euros = Number(amountEurosInput.replace(',', '.').trim());
    if (!Number.isFinite(euros) || euros < 0) {
      showMsg('Dato inválido', 'El importe máximo debe ser un número ≥ 0.');
      return;
    }
    const amountLimitCents = Math.round(euros * 100);

    setSaving(true);
    try {
      await updateRefundLimits({ countLimit: count, amountLimitCents });
      setAmountEurosInput((amountLimitCents / 100).toFixed(2));
      showMsg('Guardado', 'Límites de reembolso actualizados.');
    } catch (err: any) {
      showMsg('Error', err?.message || 'No se pudieron guardar los cambios.');
    } finally {
      setSaving(false);
    }
  };

  if (authorized === null || (authorized && loading)) {
    return <View style={styles.center}><ActivityIndicator color={COLORS.PRIMARY} /></View>;
  }

  if (authorized === false) {
    return (
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.center}>
          <Ionicons name="lock-closed-outline" size={48} color={COLORS.TEXT_MUTED} />
          <Text style={styles.noAccessText}>Solo accesible para administradores</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Ionicons name="arrow-back" size={24} color={COLORS.TEXT_MAIN} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Ajustes de Reembolsos</Text>
        <TouchableOpacity onPress={loadSettings} style={styles.headerBtn} disabled={loading}>
          <Ionicons name="refresh" size={22} color={COLORS.PRIMARY} />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.sectionTitle}>Límites diarios de reembolso automático</Text>

          <View style={[styles.card, SHADOWS.SMALL]}>
            <Text style={styles.fieldLabel}>Máximo de reembolsos automáticos al día</Text>
            <TextInput
              style={styles.input}
              value={countInput}
              onChangeText={setCountInput}
              keyboardType="number-pad"
              placeholder="p. ej. 20"
              placeholderTextColor={COLORS.TEXT_LIGHT}
              editable={!saving}
            />
            <Text style={styles.hint}>
              Número entero ≥ 0. Si en un día se superan, los reembolsos siguientes quedan en cola para que un admin los apruebe.
            </Text>

            <View style={styles.divider} />

            <Text style={styles.fieldLabel}>Importe máximo de reembolsos al día (€)</Text>
            <TextInput
              style={styles.input}
              value={amountEurosInput}
              onChangeText={setAmountEurosInput}
              keyboardType="decimal-pad"
              placeholder="p. ej. 1000.00"
              placeholderTextColor={COLORS.TEXT_LIGHT}
              editable={!saving}
            />
            <Text style={styles.hint}>
              Importe en euros ≥ 0. Es la protección principal: por encima de este total diario, los reembolsos esperan aprobación del admin.
            </Text>
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving
              ? <ActivityIndicator size="small" color={COLORS.TEXT_WHITE} />
              : <Text style={styles.saveBtnText}>Guardar cambios</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea:        { flex: 1, backgroundColor: COLORS.BACKGROUND },
  center:          { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  noAccessText:    { fontSize: 16, color: COLORS.TEXT_MUTED, fontFamily: FONTS.MEDIUM, textAlign: 'center', marginTop: 8 },

  header:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.BORDER_LIGHT },
  headerBtn:       { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle:     { flex: 1, textAlign: 'center', fontSize: 18, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MAIN },

  content:         { padding: 20, paddingBottom: 40 },
  sectionTitle:    { fontSize: 12, fontFamily: FONTS.BOLD, color: COLORS.TEXT_LIGHT, marginBottom: 12, marginTop: 4, textTransform: 'uppercase', letterSpacing: 1 },

  card:            { backgroundColor: COLORS.CARD_BG, borderRadius: SIZES.RADIUS_MEDIUM, padding: 20, borderWidth: 1, borderColor: COLORS.BORDER_LIGHT, marginBottom: 24 },
  fieldLabel:      { fontSize: 14, fontFamily: FONTS.SEMI_BOLD, color: COLORS.TEXT_MAIN, marginBottom: 8 },
  input:           { borderWidth: 1, borderColor: COLORS.BORDER_LIGHT, borderRadius: SIZES.RADIUS_SMALL, paddingHorizontal: 14, paddingVertical: 10, fontSize: 16, fontFamily: FONTS.MEDIUM, color: COLORS.TEXT_MAIN, backgroundColor: COLORS.BACKGROUND, marginBottom: 6 },
  hint:            { fontSize: 12, fontFamily: FONTS.REGULAR, color: COLORS.TEXT_MUTED, lineHeight: 17 },
  divider:         { height: 1, backgroundColor: COLORS.BORDER_LIGHT, marginVertical: 20 },

  saveBtn:         { backgroundColor: COLORS.PRIMARY, borderRadius: SIZES.RADIUS_SMALL, paddingVertical: 14, alignItems: 'center' },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText:     { fontSize: 15, fontFamily: FONTS.BOLD, color: COLORS.TEXT_WHITE },
});
