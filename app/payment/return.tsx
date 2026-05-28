import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { verifyPayment } from '../../lib/services/paymentService';
import { COLORS, FONTS } from '../../constants/theme';
import { Payment, PaymentStatus } from '../../lib/types';

export default function PaymentReturn() {
  const { order_id, status: urlStatus } = useLocalSearchParams<{ order_id: string; status: string }>();
  const router = useRouter();
  const [verifying, setVerifying] = useState(true);
  const [finalStatus, setFinalStatus] = useState<PaymentStatus | null>(null);
  const [payment, setPayment] = useState<Payment | null>(null);

  useEffect(() => {
    if (!order_id) {
      setFinalStatus((urlStatus as PaymentStatus) ?? 'FAILED');
      setVerifying(false);
      return;
    }
    (async () => {
      try {
        const res = await verifyPayment(order_id);
        setFinalStatus(res.status as PaymentStatus);
        setPayment(res.payment ?? null);
      } catch {
        setFinalStatus((urlStatus as PaymentStatus) ?? 'FAILED');
      }
      setVerifying(false);
    })();
  }, [order_id]);

  const goToMatch = () => {
    if (!payment?.match_id) {
      router.replace('/(tabs)');
      return;
    }
    router.replace(`/match/${payment.match_id}` as any);
  };

  const isSuccess = finalStatus === 'SUCCEEDED';
  const isCanceled = finalStatus === 'CANCELED';

  return (
    <SafeAreaView style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.content}>
        {verifying ? (
          <>
            <ActivityIndicator size="large" color={COLORS.PRIMARY} />
            <Text style={styles.verifyingText}>Verificando pago...</Text>
          </>
        ) : (
          <>
            <View style={[styles.iconCircle, { backgroundColor: isSuccess ? '#D1FAE5' : '#FEE2E2' }]}>
              <Ionicons
                name={isSuccess ? 'checkmark-circle' : 'close-circle'}
                size={72}
                color={isSuccess ? '#059669' : COLORS.DANGER}
              />
            </View>

            <Text style={styles.title}>
              {isSuccess ? '¡Plaza Reservada!' : isCanceled ? 'Pago Cancelado' : 'Pago Fallido'}
            </Text>

            <Text style={styles.subtitle}>
              {isSuccess
                ? 'Tu pago se ha procesado correctamente. Ya estás apuntado al partido.'
                : isCanceled
                ? 'Has cancelado el proceso de pago. Tu plaza no ha sido reservada.'
                : 'No se ha podido procesar el pago. Por favor, inténtalo de nuevo desde el partido.'}
            </Text>

            {isSuccess && payment?.match_id ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={goToMatch}>
                <Ionicons name="football-outline" size={20} color="#FFF" />
                <Text style={styles.primaryBtnText}>Ver Partido</Text>
              </TouchableOpacity>
            ) : !isSuccess && payment?.match_id ? (
              <TouchableOpacity style={styles.primaryBtn} onPress={goToMatch}>
                <Ionicons name="arrow-back" size={20} color="#FFF" />
                <Text style={styles.primaryBtnText}>Volver al Partido</Text>
              </TouchableOpacity>
            ) : null}

            <TouchableOpacity
              style={[styles.secondaryBtn, payment?.match_id ? { marginTop: 12 } : {}]}
              onPress={() => router.replace('/(tabs)')}
            >
              <Text style={styles.secondaryBtnText}>Ir al Inicio</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.BACKGROUND },
  content: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  iconCircle: { width: 120, height: 120, borderRadius: 60, justifyContent: 'center', alignItems: 'center', marginBottom: 32 },
  title: { fontSize: 28, fontFamily: FONTS.EXTRA_BOLD, color: COLORS.TEXT_MAIN, textAlign: 'center', marginBottom: 12 },
  subtitle: { fontSize: 16, fontFamily: FONTS.REGULAR, color: COLORS.TEXT_MUTED, textAlign: 'center', lineHeight: 24, marginBottom: 40 },
  primaryBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.PRIMARY, paddingVertical: 16, paddingHorizontal: 32, borderRadius: 16, gap: 8, width: '100%' },
  primaryBtnText: { color: '#FFF', fontSize: 17, fontFamily: FONTS.BOLD },
  secondaryBtn: { paddingVertical: 14, paddingHorizontal: 32, borderRadius: 16, borderWidth: 1, borderColor: COLORS.BORDER, width: '100%', alignItems: 'center' },
  secondaryBtnText: { color: COLORS.TEXT_MUTED, fontSize: 16, fontFamily: FONTS.REGULAR },
  verifyingText: { marginTop: 16, fontSize: 16, fontFamily: FONTS.REGULAR, color: COLORS.TEXT_MUTED },
});
