// Shared: confirm a paid slot when a payment reaches SUCCEEDED.
//
// reserve_paid_slot reserves a PENDING "hold" that only blocks capacity for ~10
// min (freshness window). If a payment completes LATE (after its hold aged out),
// the slot may already have been re-sold. Creating the participant blindly would
// OVERBOOK. So: re-check capacity and either create the participant (room) or
// REFUND the payment (full) — never charge for a slot we can't grant.
//
// Side effects performed here: participant insert OR Monei refund. The CALLER
// persists the resulting payment status from the returned fields (so each
// function keeps its single payments UPDATE).

import { moneiRequest } from './monei.ts';

interface SlotResult {
  participant_id?: string;
  status?: string;          // set for refund outcomes → caller must persist it
  refunded_amount?: number;
  refunded_at?: string;
}

export async function confirmSlotOrRefund(admin: any, payment: any): Promise<SlotResult> {
  const table = payment.env === 'dev' ? 'match_participants_dev' : 'match_participants';

  // Already created (webhook/verify/reconcile race)? Reuse it.
  let q = admin.from(table).select('id').eq('match_id', payment.match_id);
  q = payment.is_guest
    ? q.is('user_id', null).eq('user_name', payment.user_name)
    : q.eq('user_id', payment.user_id);
  const { data: existing } = await q.limit(1);
  if (existing && existing.length) return { participant_id: existing[0].id };

  // Still room? real participants + manual counter vs capacity.
  const { data: match } = await admin
    .from('matches').select('max_players, joined_players').eq('id', payment.match_id).maybeSingle();
  const { count } = await admin
    .from(table).select('id', { count: 'exact', head: true }).eq('match_id', payment.match_id);
  const used = (count ?? 0) + (match?.joined_players ?? 0);

  if (match && used >= match.max_players) {
    // FULL → refund instead of overbooking. On Monei failure, queue for admin.
    try {
      await moneiRequest(`/payments/${payment.monei_payment_id}/refund`, 'POST', { refundAmount: payment.amount });
      return { status: 'REFUNDED', refunded_amount: payment.amount, refunded_at: new Date().toISOString() };
    } catch (_e) {
      return { status: 'PENDING_REFUND_ADMIN' };
    }
  }

  // Room → create the participant (created_by = paying host, even for guests).
  const row = payment.is_guest
    ? { match_id: payment.match_id, user_id: null,            user_name: payment.user_name, created_by: payment.user_id }
    : { match_id: payment.match_id, user_id: payment.user_id, user_name: payment.user_name, created_by: payment.user_id };
  const { data: participant } = await admin.from(table).insert(row).select('id').maybeSingle();
  return { participant_id: participant?.id };
}
