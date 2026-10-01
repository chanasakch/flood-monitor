export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'fm.theme';

export function getThemeChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'light' || v === 'dark') return v;
  } catch {
    /* storage unavailable: fall through to system */
  }
  return 'system';
}

export function setThemeChoice(choice: ThemeChoice): void {
  try {
    if (choice === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    /* ignore */
  }
  applyTheme(choice);
}

export function applyTheme(choice: ThemeChoice): void {
  const root = document.documentElement;
  if (choice === 'system') delete root.dataset.theme;
  else root.dataset.theme = choice;
  window.dispatchEvent(new CustomEvent('fm:theme'));
}

/** The theme actually on screen, after resolving "system". */
export function effectiveTheme(): 'light' | 'dark' {
  const choice = getThemeChoice();
  if (choice !== 'system') return choice;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Calls `cb` whenever the effective theme changes (toggle or OS setting). Returns an unsubscribe function. */
export function onThemeChange(cb: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  window.addEventListener('fm:theme', cb);
  mq.addEventListener('change', cb);
  return () => {
    window.removeEventListener('fm:theme', cb);
    mq.removeEventListener('change', cb);
  };
}

/** Read a CSS colour token as currently resolved, for canvas drawing (charts, map markers). */
export function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
