// Shared: WhatsApp Cloud API (Graph) outbound + inbound-signature verification.
// Mirrors _shared/monei.ts. Used by the whatsapp-webhook Edge Function.
//
// Secrets (supabase secrets set ...):
//   WHATSAPP_TOKEN            — Meta access token
//   WHATSAPP_PHONE_NUMBER_ID  — Phone Number ID (the sending number)
//   WHATSAPP_APP_SECRET       — App Secret, to verify X-Hub-Signature-256

import { timingSafeEqual } from './timingSafeEqual.ts';

const WHATSAPP_TOKEN = Deno.env.get('WHATSAPP_TOKEN') ?? '';
const WHATSAPP_PHONE_NUMBER_ID = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID') ?? '';
const WHATSAPP_APP_SECRET = Deno.env.get('WHATSAPP_APP_SECRET') ?? '';
const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

/** Send a free-form text message (only valid inside the 24h customer-service
 *  window; proactive messages need an approved template). `to` is E.164. */
export async function sendWhatsAppText(to: string, body: string) {
  const res = await fetch(`${GRAPH_BASE}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { preview_url: true, body },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WhatsApp send ${res.status}: ${text}`);
  return JSON.parse(text);
}

/** Send an approved template message (required for proactive / outside-24h
 *  sends). `bodyParams` fill the template's {{1}},{{2}},… body variables. */
export async function sendWhatsAppTemplate(
  to: string,
  templateName: string,
  lang: string,
  bodyParams: string[],
) {
  const res = await fetch(`${GRAPH_BASE}/${WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: lang },
        components: bodyParams.length
          ? [{ type: 'body', parameters: bodyParams.map((t) => ({ type: 'text', text: t })) }]
          : [],
      },
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`WhatsApp template ${res.status}: ${text}`);
  return JSON.parse(text);
}

/** Verify the X-Hub-Signature-256 header (HMAC-SHA256 of the raw body with the
 *  App Secret). Constant-time compare. Header format: "sha256=<hex>". */
export async function verifyWhatsAppSignature(rawBody: string, signatureHeader: string): Promise<boolean> {
  try {
    if (!WHATSAPP_APP_SECRET) return false;
    const provided = signatureHeader.startsWith('sha256=') ? signatureHeader.slice(7) : signatureHeader;
    if (!provided) return false;

    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(WHATSAPP_APP_SECRET),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const mac = await crypto.subtle.sign('HMAC', key, enc.encode(rawBody));
    const computed = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('');
    return timingSafeEqual(computed, provided);
  } catch {
    return false;
  }
}
