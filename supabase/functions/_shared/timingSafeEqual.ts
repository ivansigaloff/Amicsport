// Constant-time string comparison, to avoid timing side-channels when checking
// HMAC signatures / shared secrets. The length check is acceptable here: the
// compared values are fixed-length (hex HMAC) or a fixed secret, so length is
// not sensitive.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
