import { View, Text, TouchableOpacity, FlatList, StyleSheet, ActivityIndicator, Alert, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import { refundPayment } from '../../lib/services/paymentService';
import { computeIsAdmin } from '../../lib/auth';
import { useEnv } from '../../hooks/use-env';
import { Payment, PaymentStatus } from '../../lib/types';
import { COLORS, FONTS, SIZES, SHADOWS } from '../../constants/theme';

const STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING:              'Pendiente',
  SUCCEEDED:            'Pagado',
  FAILED:               'Fallido',
  CANCELED:             'Cancelado',
  REFUNDED:             'Reembolsado',
  PARTIALLY_REFUNDED:   'Parcialmente reembolsado',
  EXPIRED:              'Expirado',
  PENDING_REFUND_ADMIN: 'Reembolso pendiente',
};

const STATUS_COLORS: Record<PaymentStatus, string> = {
  PENDING:              '#F59E0B',
  SUCCEEDED:            '#10B981',
  FAILED:               '#EF4444',
  CANCELED:             '#6B7280',
  REFUNDED:             '#3B82F6',
  PARTIALLY_REFUNDED:   '#8B5CF6',
  EXPIRED:              '#9CA3AF',
  PENDING_REFUND_ADMIN: '#F97316',
};

type FilterStatus = PaymentStatus | 'ALL';
const FILTER_OPTIONS: FilterStatus[] = ['ALL', 'SUCCEEDED', 'PENDING', 'REFUNDED', 'PENDING_REFUND_ADMIN', 'FAILED', 'CANCELED', 'EXPIRED'];

export default function AdminPaymentsScreen() {
  const router = useRouter();
  const { env } = useEnv();
  const [loading, setLoading] = useState(true);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [matchTitles, setMatchTitles] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<FilterStatus>('ALL');
  const [acting, setActing] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const isAdmin = computeIsAdmin(user, env as 'prod' | 'dev');
      setAuthorized(isAdmin);
      if (isAdmin) await loadPayments();
      else setLoading(false);
    })();
  }, [env]);

  const loadPayments = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('payments')
      .select('*')
      .eq('env', env)
      .order('created_at', { ascending: false });

    if (error || !data) { setLoading(false); return; }
    setPayments(data as Payment[]);

    const matchIds = [...new Set((data as any[]).map((p) => p.match_id as string))];
    if (matchIds.length > 0) {
      const matchTable = env === 'dev' ? 'matches_dev' : 'matches';
      const { data: matches } = await supabase.from(matchTable).select('id, title').in('id', matchIds);
      if (matches) {
        const titleMap: Record<string, string> = {};
        (matches as any[]).forEach((m) => { titleMap[m.id] = m.title; });
        setMatchTitles(titleMap);
      }
    }
    setLoading(false);
  };

  const showMsg = (title: string, msg: string) => {
    if (Platform.OS === 'web') window.alert(`${title}: ${msg}`);
    else Alert.alert(title, msg);
  };

  const handleRefund = async (payment: Payment) => {
    const isForced = payment.status === 'PENDING_REFUND_ADMIN';
    const label = isForced ? 'Forzar reembolso' : 'Reembolsar';
    const confirmed = Platform.OS === 'web'
      ? window.confirm(`${label}: €${(payment.amount / 100).toFixed(2)} a ${payment.user_name}?`)
      : await new Promise<boolean>((resolve) => {
          Alert.alert(
            label,
            `¿${label} €${(payment.amount / 100).toFixed(2)} a ${payment.user_name}?`,
            [{ text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
             { text: label, style: 'destructive', onPress: () => resolve(true) }]
          );
        });
    if (!confirmed) return;

    setActing(payment.id);
    try {
      const result = await refundPayment(payment.id);
      const msg = result.status === 'PENDING_REFUND_ADMIN'
        ? 'Reembolso en cola (límite diario alcanzado).'
        : 'Reembolso solicitado. Se procesará en breve.';
      showMsg('Reembolso', msg);
      await loadPayments();
    } catch (err: any) {
      showMsg('Error', err.message || 'No se pudo procesar el reembolso');
    }
    setActing(null);
  };

  const filtered = filter === 'ALL' ? payments : payments.filter((p) => p.status === filter);
  const total = filtered.reduce((sum, p) => p.status === 'SUCCEEDED' ? sum + p.amount : sum, 0);

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
        <Text style={styles.headerTitle}>Pagos</Text>
        <TouchableOpacity onPress={loadPayments} style={styles.headerBtn} disabled={loading}>
          <Ionicons name="refresh" size={22} color={COLORS.PRIMARY} />
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterContent}
      >
        {FILTER_OPTIONS.map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.pill, filter === s && styles.pillActive]}
            onPress={() => setFilter(s)}
          >
            <Text style={[styles.pillText, filter === s && styles.pillTextActive]}>
              {s === 'ALL' ? 'Todos' : STATUS_LABELS[s as PaymentStatus]}
              {s !== 'ALL' && payments.filter((p) => p.status === s).length > 0
                ? ` (${payments.filter((p) => p.status === s).length})`
                : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {filter === 'ALL' || filter === 'SUCCEEDED' ? (
        <View style={styles.summaryBar}>
          <Text style={styles.summaryText}>
            {filtered.length} pago{filtered.length !== 1 ? 's' : ''}
            {total > 0 ? ` · €${(total / 100).toFixed(2)} recaudado` : ''}
          </Text>
        </View>
      ) : null}

      {filtered.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="receipt-outline" size={48} color={COLORS.TEXT_MUTED} />
          <Text style={styles.emptyText}>No hay pagos</Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={{ flex: 1, marginRight: 8 }}>
                  <Text style={styles.cardMatch} numberOfLines={1}>
                    {matchTitles[item.match_id] || `Partido ${item.match_id.slice(-6)}`}
                  </Text>
                  <Text style={styles.cardPlayer}>
                    {item.user_name}{item.is_guest ? ' · invitado' : ''}
                  </Text>
                </View>
                <View style={[styles.statusBadge, { backgroundColor: STATUS_COLORS[item.status] + '22' }]}>
                  <Text style={[styles.statusText, { color: STATUS_COLORS[item.status] }]}>
                    {STATUS_LABELS[item.status]}
                  </Text>
                </View>
              </View>

              <View style={styles.cardRow}>
                <Text style={styles.cardAmount}>€{(item.amount / 100).toFixed(2)}</Text>
                {item.refunded_amount > 0 && (
                  <Text style={styles.cardRefunded}>-€{(item.refunded_amount / 100).toFixed(2)} devuelto</Text>
                )}
                {item.payment_method ? (
                  <Text style={styles.cardMeta}>{item.payment_method}</Text>
                ) : null}
                <Text style={styles.cardMeta}>
                  {item.created_at
                    ? new Date(item.created_at).toLocaleDateString('es-ES', {
                        day: '2-digit', month: '2-digit', year: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })
                    : ''}
                </Text>
              </View>

              {item.status === 'SUCCEEDED' && (
                <TouchableOpacity
                  style={styles.refundBtn}
                  onPress={() => handleRefund(item)}
                  disabled={acting === item.id}
                >
                  {acting === item.id
                    ? <ActivityIndicator size="small" color={COLORS.DANGER} />
                    : <Text style={styles.refundBtnText}>Reembolsar</Text>}
                </TouchableOpacity>
              )}
              {item.status === 'PENDING_REFUND_ADMIN' && (
                <TouchableOpacity
                  style={[styles.refundBtn, { borderColor: '#F97316' }]}
                  onPress={() => handleRefund(item)}
                  disabled={acting === item.id}
                >
                  {acting === item.id
                    ? <ActivityIndicator size="small" color="#F97316" />
                    : <Text style={[styles.refundBtnText, { color: '#F97316' }]}>Forzar reembolso</Text>}
                </TouchableOpacity>
              )}
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.BACKGROUND },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  noAccessText: { fontSize: 16, color: COLORS.TEXT_MUTED, fontFamily: FONTS.MEDIUM, textAlign: 'center', marginTop: 8 },
  emptyText: { fontSize: 15, color: COLORS.TEXT_MUTED, fontFamily: FONTS.MEDIUM, marginTop: 8 },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: COLORS.BORDER_LIGHT },
  headerBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { flex: 1, textAlign: 'center', fontSize: 18, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MAIN },

  filterRow: { maxHeight: 48, borderBottomWidth: 1, borderBottomColor: COLORS.BORDER_LIGHT },
  filterContent: { paddingHorizontal: 12, paddingVertical: 8, gap: 8, alignItems: 'center' },
  pill: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20, backgroundColor: COLORS.CARD_BG, borderWidth: 1, borderColor: COLORS.BORDER_LIGHT },
  pillActive: { backgroundColor: COLORS.PRIMARY, borderColor: COLORS.PRIMARY },
  pillText: { fontSize: 13, fontFamily: FONTS.MEDIUM, color: COLORS.TEXT_MUTED },
  pillTextActive: { color: '#FFF', fontFamily: FONTS.BOLD },

  summaryBar: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: COLORS.CARD_BG, borderBottomWidth: 1, borderBottomColor: COLORS.BORDER_LIGHT },
  summaryText: { fontSize: 13, color: COLORS.TEXT_MUTED, fontFamily: FONTS.MEDIUM },

  list: { padding: 16, gap: 12 },
  card: { backgroundColor: COLORS.CARD_BG, borderRadius: SIZES.RADIUS_MEDIUM, padding: 16, borderWidth: 1, borderColor: COLORS.BORDER_LIGHT, ...SHADOWS.SMALL },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8 },
  cardMatch: { fontSize: 14, fontFamily: FONTS.BOLD, color: COLORS.TEXT_MAIN },
  cardPlayer: { fontSize: 13, fontFamily: FONTS.REGULAR, color: COLORS.TEXT_MUTED, marginTop: 2 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, alignSelf: 'flex-start' },
  statusText: { fontSize: 11, fontFamily: FONTS.BOLD },
  cardRow: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  cardAmount: { fontSize: 16, fontFamily: FONTS.EXTRA_BOLD, color: COLORS.TEXT_MAIN },
  cardRefunded: { fontSize: 12, fontFamily: FONTS.MEDIUM, color: '#3B82F6' },
  cardMeta: { fontSize: 12, fontFamily: FONTS.REGULAR, color: COLORS.TEXT_MUTED },
  refundBtn: { marginTop: 12, borderWidth: 1, borderColor: COLORS.DANGER, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  refundBtnText: { fontSize: 13, fontFamily: FONTS.BOLD, color: COLORS.DANGER },
});
