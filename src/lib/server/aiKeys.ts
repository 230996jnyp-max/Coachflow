/*
 * Several Groq keys can share the load (GROQ_API_KEYS="key1,key2,key3", plus the older single GROQ_API_KEY). Each request starts
 * from the next key in turn; a key that is rate-limited or rejected is set aside for a while and the request goes straight to
 * another one, so a busy key never makes the person wait. Pure functions (no I/O), so they can be tested on their own.
 */

const KEY_RE = /^gsk_[A-Za-z0-9]{20,}$/;

/** Every usable key from the given settings (comma / space / semicolon separated), without duplicates. */
export function parseKeys(...values: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    for (const k of (v ?? "").split(/[\s,;]+/)) {
      if (KEY_RE.test(k) && !out.includes(k)) out.push(k);
    }
  }
  return out;
}

export const groqKeys = (): string[] => parseKeys(process.env.GROQ_API_KEYS, process.env.GROQ_API_KEY);

/**
 * The order to try the keys in: the ones that are available, starting from `cursor` so requests take turns; then the ones that
 * are cooling down, soonest-ready first (a last resort).
 */
export function orderKeys(keys: string[], coolUntil: Map<string, number>, now: number, cursor: number): string[] {
  if (keys.length === 0) return [];
  const start = ((cursor % keys.length) + keys.length) % keys.length;
  const rotated = [...keys.slice(start), ...keys.slice(0, start)];
  const ready = rotated.filter((k) => (coolUntil.get(k) ?? 0) <= now);
  const cooling = rotated.filter((k) => (coolUntil.get(k) ?? 0) > now).sort((a, b) => (coolUntil.get(a) ?? 0) - (coolUntil.get(b) ?? 0));
  return [...ready, ...cooling];
}
