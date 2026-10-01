import th from '../i18n/th.json';
import en from '../i18n/en.json';

export type Lang = 'th' | 'en';
const KEY = 'fm.lang';
const DICTS: Record<Lang, unknown> = { th, en };

let current: Lang = readLang();
const listeners = new Set<() => void>();

function readLang(): Lang {
  try {
    return localStorage.getItem(KEY) === 'en' ? 'en' : 'th';
  } catch {
    return 'th';
  }
}

export function getLang(): Lang {
  return current;
}

export function setLang(lang: Lang): void {
  current = lang;
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = lang;
  listeners.forEach((fn) => fn());
}

export function onLangChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function lookup(dict: unknown, key: string): string | undefined {
  let node: unknown = dict;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/** Translate `key` (dotted path). `{name}` placeholders are replaced from `vars`. */
export function t(key: string, vars?: Record<string, string | number>): string {
  const raw = lookup(DICTS[current], key) ?? lookup(DICTS.th, key) ?? key;
  if (!vars) return raw;
  return raw.replace(/\{(\w+)\}/g, (_, name: string) => (name in vars ? String(vars[name]) : `{${name}}`));
}

/** Pick the Thai or English variant of a data field, falling back to Thai. */
export function pick(thText: string | null | undefined, enText: string | null | undefined): string {
  if (current === 'en' && enText && enText.trim() && enText.trim() !== '-') return enText;
  return thText ?? enText ?? '';
}
