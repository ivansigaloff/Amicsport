import { supabase } from '../supabase';
import { Payment } from '../types';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

async function authHeader(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error('No autenticado');
  return `Bearer ${session.access_token}`;
}

async function callEdgeFn<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': await authHeader(),
      'apikey': SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(mapEdgeError(data.error) || `${name} failed (${res.status})`);
  return data as T;
}

// Maps Edge Function error codes to user-facing Spanish messages.
function mapEdgeError(code?: string): string | undefined {
  switch (code) {
    case 'match_full':   return 'El partido está completo.';
    case 'already_paid': return 'Ya tienes un pago confirmado para este partido.';
    case 'invalid_price':
    case 'match_does_not_require_payment': return 'Este partido no admite pago.';
    default: return code;
  }
}

function getReturnBaseUrl(): string {
  if (typeof window === 'undefined') return process.env.APP_BASE_URL || '';
  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const basePath = isLocal ? '' : (process.env.EXPO_PUBLIC_BASE_URL || '');
  return window.location.origin + basePath;
}

export async function createPayment(matchId: string, env: string, guestName?: string): Promise<{ redirectUrl: string; order_id: string }> {
  return callEdgeFn('create-payment', {
    match_id: matchId,
    env,
    return_base_url: getReturnBaseUrl(),
    ...(guestName ? { guest_name: guestName } : {}),
  });
}

export async function verifyPayment(orderId: string): Promise<{ status: string; payment: Payment }> {
  return callEdgeFn('verify-payment', { order_id: orderId });
}

export async function refundPayment(paymentId: string, force = false): Promise<{ status: string; refunded_amount: number }> {
  return callEdgeFn('refund-payment', { payment_id: paymentId, force });
}
