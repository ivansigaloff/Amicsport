import { View, Text, FlatList, StyleSheet, ActivityIndicator, Alert, Platform, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { supabase } from '../../../lib/supabase';
import { refundPayment } from '../../../lib/services/paymentService';
import { Payment, PaymentStatus } from '../../../lib/types';
import AdminScreen from '../../../components/v2/admin/AdminScreen';
import { Badge, Button, PressableScale, AnimatedEntrance, C, FONTS, R, S, SHADOW } from '../../../components/v2/ui';

const STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: 'Pendiente', SUCCEEDED: 'Pagado', FAILED: 'Fallido', CANCELED: 'Cancelado',
  REFUNDED: 'Reembolsado', PARTIALLY_REFUNDED: 'Parcial', EXPIRED: 'Expirado', PENDING_REFUND_ADMIN: 'Reembolso pdte.',
};
const STATUS_TONE: Record<PaymentStatus, any> = {
  PENDING: 'warning', SUCCEEDED: 'success', FAILED: 'danger', CANCELED: 'neutral',
  REFUNDED: 'info', PARTIALLY_REFUNDED: 'info', EXPIRED: 'neutral', PENDING_REFUND_ADMIN: 'warning',
};
type FilterStatus = PaymentStatus | 'ALL';
const FILTER_OPTIONS: FilterStatus[] = ['ALL', 'SUCCEEDED', 'PENDING', 'REFUNDED', 'PENDING_REFUND_ADMIN', 'FAILED', 'CANCELED', 'EXPIRED'];

export default function V2AdminPayments() {
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [matchTitles, setMatchTitles] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<FilterStatus>('ALL');
  const [acting, setActing] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('payments').select('*').eq('env', 'prod').order('created_at', { ascending: false });
    if (error || !data) { setLoading(false); return; }
    setPayments(data as Payment[]);
    const matchIds = [...new Set((data as any[]).map((p) => p.match_id as string))];
    if (matchIds.length) {
      const { data: matches } = await supabase.from('matches').select('id, title').in('id', matchIds);
      if (matches) { const map: Record<string, string> = {}; (matches as any[]).forEach((m) => { map[m.id] = m.title; }); setMatchTitles(map); }
    }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const showMsg = (title: string, m: string) => (Platform.OS === 'web' ? window.alert(`${title}: ${m}`) : Alert.alert(title, m));

  const handleRefund = async (payment: Payment) => {
    const isForced = payment.status === 'PENDING_REFUND_ADMIN';
    const label = isForced ? 'Forzar reembolso' : 'Reembolsar';
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`${label}: €${(payment.amount / 100).toFixed(2)} a ${payment.user_name}?`)
      : await new Promise<boolean>((res) => Alert.alert(label, `¿${label} €${(payment.amount / 100).toFixed(2)} a ${payment.user_name}?`, [{ text: 'Cancelar', style: 'cancel', onPress: () => res(false) }, { text: label, style: 'destructive', onPress: () => res(true) }]));
    if (!confirmed) return;
    setActing(payment.id);
    try {
      const result = await refundPayment(payment.id);
      showMsg('Reembolso', result.status === 'PENDING_REFUND_ADMIN' ? 'Reembolso en cola (límite diario alcanzado).' : 'Reembolso solicitado. Se procesará en breve.');
      await load();
    } catch (err: any) { showMsg('Error', err.message || 'No se pudo procesar el reembolso'); }
    setActing(null);
  };

  const filtered = filter === 'ALL' ? payments : payments.filter((p) => p.status === filter);
  const total = filtered.reduce((s, p) => (p.status === 'SUCCEEDED' ? s + p.amount : s), 0);

  return (
    <AdminScreen title="Pagos" subtitle="Gestión de cobros y reembolsos" onRefresh={load} scroll={false}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterContent}>
        {FILTER_OPTIONS.map((s) => {
          const n = s === 'ALL' ? 0 : payments.filter((p) => p.status === s).length;
          const active = filter === s;
          return (
            <PressableScale key={s} onPress={() => setFilter(s)} style={[styles.pill, active && styles.pillActive]}>
              <Text style={[styles.pillText, active && styles.pillTextActive]}>{s === 'ALL' ? 'Todos' : STATUS_LABELS[s as PaymentStatus]}{n > 0 ? ` ${n}` : ''}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      {(filter === 'ALL' || filter === 'SUCCEEDED') && (
        <View style={styles.summary}>
          <Text style={styles.summaryText}>{filtered.length} pago{filtered.length !== 1 ? 's' : ''}</Text>
          {total > 0 && <Text style={styles.summaryAmount}>€{(total / 100).toFixed(2)} recaudado</Text>}
        </View>
      )}

      {loading ? (
        <ActivityIndicator color={C.brand} style={{ marginTop: 50 }} />
      ) : filtered.length === 0 ? (
        <View style={styles.center}><Ionicons name="receipt-outline" size={48} color={C.textFaint} /><Text style={styles.empty}>No hay pagos</Text></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => i.id}
          contentContainerStyle={{ padding: S.lg, gap: 12, paddingBottom: 60, maxWidth: 720, width: '100%', alignSelf: 'center' }}
          renderItem={({ item, index }) => (
            <AnimatedEntrance index={Math.min(index, 8)}>
              <View style={styles.card}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.match} numberOfLines={1}>{matchTitles[item.match_id] || `Partido ${item.match_id.slice(-6)}`}</Text>
                    <Text style={styles.player}>{item.user_name}{item.is_guest ? ' · invitado' : ''}</Text>
                  </View>
                  <Badge tone={STATUS_TONE[item.status]} label={STATUS_LABELS[item.status]} size="sm" />
                </View>
                <View style={styles.row}>
                  <Text style={styles.amount}>€{(item.amount / 100).toFixed(2)}</Text>
                  {item.refunded_amount > 0 && <Text style={styles.refunded}>-€{(item.refunded_amount / 100).toFixed(2)}</Text>}
                  {!!item.payment_method && <Text style={styles.meta}>{item.payment_method}</Text>}
                  <Text style={styles.meta}>{item.created_at ? new Date(item.created_at).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}</Text>
                </View>
                {(item.status === 'SUCCEEDED' || item.status === 'PENDING_REFUND_ADMIN') && (
                  <Button
                    title={item.status === 'PENDING_REFUND_ADMIN' ? 'Forzar reembolso' : 'Reembolsar'}
                    variant="outline" size="sm" loading={acting === item.id}
                    onPress={() => handleRefund(item)} style={{ marginTop: 12, alignSelf: 'flex-start' }}
                  />
                )}
              </View>
            </AnimatedEntrance>
          )}
        />
      )}
    </AdminScreen>
  );
}

const styles = StyleSheet.create({
  filterRow: { maxHeight: 56, flexGrow: 0 },
  filterContent: { paddingHorizontal: S.lg, paddingVertical: 10, gap: 8, alignItems: 'center' },
  pill: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: R.pill, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  pillActive: { backgroundColor: C.ink800, borderColor: C.ink800 },
  pillText: { fontSize: 13, fontFamily: FONTS.semibold, color: C.textMuted },
  pillTextActive: { color: '#fff', fontFamily: FONTS.bold },
  summary: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: S.xl, paddingVertical: 8 },
  summaryText: { fontSize: 13, color: C.textMuted, fontFamily: FONTS.semibold },
  summaryAmount: { fontSize: 13, color: C.brandDeep, fontFamily: FONTS.bold },
  center: { alignItems: 'center', justifyContent: 'center', marginTop: 60, gap: 10 },
  empty: { fontSize: 15, color: C.textMuted, fontFamily: FONTS.medium },
  card: { backgroundColor: C.surface, borderRadius: R.lg, padding: S.lg, borderWidth: 1, borderColor: C.border, ...SHADOW.sm },
  match: { fontSize: 14.5, fontFamily: FONTS.bold, color: C.text },
  player: { fontSize: 13, fontFamily: FONTS.regular, color: C.textMuted, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 10 },
  amount: { fontSize: 17, fontFamily: FONTS.black, color: C.text },
  refunded: { fontSize: 12.5, fontFamily: FONTS.semibold, color: C.info },
  meta: { fontSize: 12, fontFamily: FONTS.regular, color: C.textFaint },
});
