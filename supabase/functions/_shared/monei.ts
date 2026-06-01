import { timingSafeEqual } from './timingSafeEqual.ts';

const MONEI_API_KEY = Deno.env.get('MONEI_API_KEY')!;
const MONEI_BASE = 'https://api.monei.com/v1';

export async function moneiRequest(path: string, method = 'GET', body?: object) {
  const res = await fetch(`${MONEI_BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${MONEI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Monei ${method} ${path}: ${res.status} - ${text}`);
  return JSON.parse(text);
}

// Signature format from Monei: "t=timestamp,v1=hmac_sha256"
export async function verifyMoneiSignature(rawBody: string, signature: string): Promise<boolean> {
  try {
    const parts = Object.fromEntries(signature.split(',').map(p => {
      const idx = p.indexOf('=');
      return [p.slice(0, idx), p.slice(idx + 1)];
    }));
    const { t: timestamp, v1 } = parts;
    if (!timestamp || !v1) return false;

    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(MONEI_API_KEY),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${rawBody}`));
    const computed = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
    return timingSafeEqual(computed, v1);
  } catch {
    return false;
  }
}
