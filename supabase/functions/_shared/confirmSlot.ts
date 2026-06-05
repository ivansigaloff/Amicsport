// Shared: confirm a paid slot when a payment reaches SUCCEEDED.
//
// reserve_paid_slot reserves a PENDING "hold" that only blocks capacity for ~6
// min (freshness window). If a payment completes LATE (after its hold aged out),
// the slot may already have been re-sold. Creating the participant blindly would
// OVERBOOK.
//
// The decision is made by the confirm_paid_slot SQL function, which LOCKS the
// match row so the three confirm paths (webhook / verify-payment / reconcile)
// serialize: it re-checks idempotency + capacity and inserts the participant
// under the lock, or signals 'queued_return' when the match filled. We never
// call Monei here — a queued return is picked up by the single refund worker in
// reconcile-payments, so a refund can't be issued twice.
//
// The CALLER persists the returned status (PENDING_RETURN) on the payment so the
// worker sees it; on 'confirmed' it persists participant_id. Each function keeps
// its single payments UPDATE.

interface SlotResult {
  participant_id?: string;
  status?: string;          // 'PENDING_RETURN' when the match was full → caller persists it
}

export async function confirmSlotOrRefund(admin: any, payment: any): Promise<SlotResult> {
  const { data: result, error } = await admin.rpc('confirm_paid_slot', { p_payment_id: payment.id });

  if (error || !result) {
    // Don't fabricate a participant or a refund on an unknown DB error; let the
    // caller keep the payment as-is so reconcile retries it later.
    console.error('confirm_paid_slot failed:', error);
    return {};
  }

  switch (result.outcome) {
    case 'confirmed':
      return { participant_id: result.participant_id };
    case 'queued_return':
      // Match filled while the hold aged out → owe a refund. Queue it; the
      // worker in reconcile-payments will call Monei.
      return { status: 'PENDING_RETURN' };
    default:
      // payment_not_found / match_not_found — leave the payment untouched.
      console.error('confirm_paid_slot outcome:', result.outcome);
      return {};
  }
}
