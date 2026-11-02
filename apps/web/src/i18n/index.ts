import en from './en.json';

// To add French or Kinyarwanda: copy en.json to fr.json / rw.json, translate
// the values, and add it to LANGS. Missing keys fall back to English.
const LANGS: Record<string, Record<string, string>> = { en };

let current: Record<string, string> = en;

export function setLanguage(code: string) {
  current = LANGS[code] ?? en;
}

export type Key = keyof typeof en;

export function t(key: Key, vars?: Record<string, string | number>): string {
  let s = current[key] ?? (en as Record<string, string>)[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
