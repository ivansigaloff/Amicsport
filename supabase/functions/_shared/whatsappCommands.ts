// Shared: pure command parser for inbound WhatsApp text. No deps → unit-testable.
//
// Recognises VOY / NOVOY / LISTA / AYUDA and extracts a 4-char match code when
// present (the deep links pre-fill e.g. "VOY A7F3"). Tolerant to case/accents.

export type WhatsAppCommand =
  | { kind: 'join'; code: string | null }
  | { kind: 'leave'; code: string | null }
  | { kind: 'list'; code: string | null }
  | { kind: 'help' }
  | { kind: 'unknown' };

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Extract the first standalone 4-char code in our alphabet (no 0/O/1/I/L). */
export function extractCode(raw: string): string | null {
  const m = (raw ?? '').toUpperCase().match(/\b([A-HJ-NP-Z2-9]{4})\b/);
  return m ? m[1] : null;
}

export function parseCommand(raw: string): WhatsAppCommand {
  const text = stripAccents((raw ?? '').trim().toLowerCase());
  if (!text) return { kind: 'unknown' };

  const code = extractCode(raw);

  // LEAVE patterns checked BEFORE JOIN so "no voy" / "no me apunto" win over the
  // substring "voy" / "apunto".
  if (/\b(no\s*voy|novoy|no\s*me\s*apunto|me\s*borro)\b/.test(text)) return { kind: 'leave', code };
  if (/\b(voy|me\s*apunto|apunta(me)?|\+\s*1)\b/.test(text))         return { kind: 'join', code };
  if (/\b(lista|listado|quien(es)?\s*v(a|an))\b/.test(text))         return { kind: 'list', code };
  if (/\b(ayuda|help|comandos)\b/.test(text))                       return { kind: 'help' };

  return { kind: 'unknown' };
}
