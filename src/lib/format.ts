import { getLang, t } from './i18n';

const TZ = 'Asia/Bangkok';

// Thai dates use the Buddhist calendar; English uses Gregorian. Always Asia/Bangkok.
const fmtCache = new Map<string, Intl.DateTimeFormat>();
function fmt(kind: 'datetime' | 'time' | 'date' | 'hour'): Intl.DateTimeFormat {
  const lang = getLang();
  const key = `${lang}:${kind}`;
  let f = fmtCache.get(key);
  if (!f) {
    const locale = lang === 'th' ? 'th-TH-u-ca-buddhist-nu-latn' : 'en-GB';
    const opts: Intl.DateTimeFormatOptions =
      kind === 'datetime'
        ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }
        : kind === 'date'
          ? { day: 'numeric', month: 'short', year: 'numeric' }
          : kind === 'hour'
            ? { hour: '2-digit', minute: '2-digit', hour12: false }
            : { hour: '2-digit', minute: '2-digit', hour12: false };
    f = new Intl.DateTimeFormat(locale, { ...opts, timeZone: TZ });
    fmtCache.set(key, f);
  }
  return f;
}

function withThaiSuffix(s: string): string {
  return getLang() === 'th' ? `${s} น.` : s;
}

/** "1 ต.ค. 2569 17:05 น." / "1 Oct 2026, 17:05" */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return t('common.noTime');
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return t('common.noTime');
  return withThaiSuffix(fmt('datetime').format(ms));
}

/** "17:05 น." / "17:05" */
export function formatTime(iso: string | number): string {
  const ms = typeof iso === 'number' ? iso : Date.parse(iso);
  if (Number.isNaN(ms)) return t('common.noTime');
  return withThaiSuffix(fmt('time').format(ms));
}

/** "17:05" without suffix, for chart axes. */
export function formatHour(ms: number): string {
  return fmt('hour').format(ms);
}

export function formatDate(ms: number): string {
  return fmt('date').format(ms);
}

/** "5 นาทีที่แล้ว" / "5 min ago". Null for missing or future times. */
export function formatAgo(iso: string | null | undefined, now: number = Date.now()): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const min = Math.round((now - ms) / 60000);
  if (min < -1) return null;
  if (min < 1) return t('time.justNow');
  if (min < 60) return t('time.minAgo', { n: min });
  const h = Math.round(min / 60);
  if (h < 48) return t('time.hourAgo', { n: h });
  return t('time.dayAgo', { n: Math.round(h / 24) });
}

export function formatNumber(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return '–';
  return v.toLocaleString(getLang() === 'th' ? 'th-TH-u-nu-latn' : 'en-GB', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  });
}

export function formatKm(km: number): string {
  return km < 1 ? t('unit.meters', { n: Math.round(km * 100) * 10 }) : t('unit.km', { n: formatNumber(km, 1) });
}
