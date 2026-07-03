import { View, Text, StyleSheet, ActivityIndicator, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { getRefundLimits, updateRefundLimits } from '../../../lib/services/settingsService';
import AdminScreen from '../../../components/v2/admin/AdminScreen';
import { Field, Button, C, FONTS, R, S, SHADOW } from '../../../components/v2/ui';

export default function V2AdminSettings() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [countInput, setCountInput] = useState('');
  const [amountEurosInput, setAmountEurosInput] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const { countLimit, amountLimitCents } = await getRefundLimits();
      setCountInput(String(countLimit));
      setAmountEurosInput((amountLimitCents / 100).toFixed(2));
    } catch { msg('Error', 'No se pudieron cargar los ajustes.'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const msg = (title: string, m: string) => (Platform.OS === 'web' ? window.alert(`${title}: ${m}`) : Alert.alert(title, m));

  const save = async () => {
    const count = Number(countInput.trim());
    if (!Number.isInteger(count) || count < 0) return msg('Dato inválido', 'El máximo de reembolsos debe ser un entero ≥ 0.');
    const euros = Number(amountEurosInput.replace(',', '.').trim());
    if (!Number.isFinite(euros) || euros < 0) return msg('Dato inválido', 'El importe máximo debe ser ≥ 0.');
    setSaving(true);
    try {
      await updateRefundLimits({ countLimit: count, amountLimitCents: Math.round(euros * 100) });
      setAmountEurosInput((Math.round(euros * 100) / 100).toFixed(2));
      msg('Guardado', 'Límites de reembolso actualizados.');
    } catch (err: any) { msg('Error', err?.message || 'No se pudieron guardar los cambios.'); }
    finally { setSaving(false); }
  };

  return (
    <AdminScreen title="Reembolsos" subtitle="Límites diarios automáticos" onRefresh={load}>
      {loading ? (
        <ActivityIndicator color={C.brand} style={{ marginTop: 40 }} />
      ) : (
        <View style={{ gap: S.lg }}>
          <View style={styles.infoBox}>
            <Ionicons name="shield-checkmark" size={20} color={C.brandDeep} />
            <Text style={styles.infoText}>Por encima de estos límites diarios, los reembolsos quedan en cola para aprobación manual del administrador.</Text>
          </View>

          <View style={styles.card}>
            <Field label="Máximo de reembolsos automáticos / día" icon="repeat-outline" value={countInput} onChangeText={setCountInput} keyboardType="number-pad" placeholder="20" editable={!saving} />
            <Text style={styles.hint}>Número entero ≥ 0.</Text>
            <View style={styles.divider} />
            <Field label="Importe máximo de reembolsos / día (€)" icon="cash-outline" value={amountEurosInput} onChangeText={setAmountEurosInput} keyboardType="decimal-pad" placeholder="1000.00" editable={!saving} />
            <Text style={styles.hint}>Protección principal: importe total diario en euros ≥ 0.</Text>
          </View>

          <Button title="Guardar cambios" onPress={save} loading={saving} full size="lg" icon="save" />
        </View>
      )}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  infoBox: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', backgroundColor: C.brandWash, padding: S.lg, borderRadius: R.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.brandDeep },
  infoText: { flex: 1, color: C.brandDeep, fontFamily: FONTS.medium, fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: S.lg, borderWidth: 2, borderColor: C.ink, ...SHADOW.sm },
  hint: { fontSize: 12, fontFamily: FONTS.regular, color: C.textMuted, marginTop: 6, marginLeft: 2 },
  divider: { height: 1, backgroundColor: C.border, marginVertical: S.lg },
});
