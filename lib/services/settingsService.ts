import { supabase } from '../supabase';

// Admin-configurable refund limits, stored in the global `app_settings` table
// (no env column — these are read by the reconcile-payments refund worker).
//   daily_refund_count_limit        — JSON number: max automatic refunds / day
//   daily_refund_amount_limit_cents — JSON number: max refunded amount / day, in CENTS
// RLS already restricts SELECT/UPDATE to admins (settings_admin_select/_update).
// Rows are pre-seeded, so we UPDATE existing keys (there is no INSERT policy).

export interface RefundLimits {
  countLimit: number;        // whole refunds per day
  amountLimitCents: number;  // cents per day
}

const COUNT_KEY = 'daily_refund_count_limit';
const AMOUNT_KEY = 'daily_refund_amount_limit_cents';

export const getRefundLimits = async (): Promise<RefundLimits> => {
  const { data, error } = await supabase
    .from('app_settings')
    .select('key, value')
    .in('key', [COUNT_KEY, AMOUNT_KEY]);
  if (error) throw error;

  const find = (k: string) => (data || []).find((r: any) => r.key === k)?.value;
  return {
    countLimit: Number(find(COUNT_KEY) ?? 0),
    amountLimitCents: Number(find(AMOUNT_KEY) ?? 0),
  };
};

export const updateRefundLimits = async (limits: RefundLimits): Promise<void> => {
  // value is jsonb — pass JS numbers so they are stored as JSON numbers.
  const [a, b] = await Promise.all([
    supabase.from('app_settings').update({ value: limits.countLimit }).eq('key', COUNT_KEY),
    supabase.from('app_settings').update({ value: limits.amountLimitCents }).eq('key', AMOUNT_KEY),
  ]);
  if (a.error) throw a.error;
  if (b.error) throw b.error;
};
