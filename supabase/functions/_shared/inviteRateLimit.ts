// Shared: rate-limit invite-code validation attempts, to stop brute-forcing the
// invite-only gate (V1). Backed by the invite_attempts table; service-role only.
// Used by validate-invite (web, key = IP) and whatsapp-webhook (key = phone).
//
// Tunable via env: INVITE_MAX_ATTEMPTS (default 5), INVITE_WINDOW_MIN (default 15).

const MAX = Number(Deno.env.get('INVITE_MAX_ATTEMPTS') ?? '5');
const WINDOW_MIN = Number(Deno.env.get('INVITE_WINDOW_MIN') ?? '15');

/** True if this key has too many recent FAILED attempts (locked out). */
export async function isInviteBlocked(admin: any, key: string): Promise<boolean> {
  if (!key) return false;
  const since = new Date(Date.now() - WINDOW_MIN * 60 * 1000).toISOString();
  const { count } = await admin
    .from('invite_attempts')
    .select('*', { count: 'exact', head: true })
    .eq('key', key).eq('success', false).gte('attempted_at', since);
  return (count ?? 0) >= MAX;
}

/** Record a failed invite attempt for this key. */
export async function recordInviteFailure(admin: any, key: string): Promise<void> {
  if (!key) return;
  await admin.from('invite_attempts').insert({ key, success: false });
}
