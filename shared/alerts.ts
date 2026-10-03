import type { ForecastHour, ForecastResponse } from './types';

// ---- Areas the family wants alerts for. Edit this list to change them. ----

export interface AlertArea {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export const ALERT_AREAS: AlertArea[] = [
  { id: 'minburi', name: 'มีนบุรี', lat: 13.8135, lng: 100.7317 }, // สำนักงานเขตมีนบุรี
  { id: 'bangkhen', name: 'บางเขน (พหลโยธิน)', lat: 13.8733, lng: 100.5962 }, // สำนักงานเขตบางเขน
  { id: 'huaikhwang', name: 'ห้วยขวาง (รัชดา)', lat: 13.7785, lng: 100.5737 }, // แยกห้วยขวาง
  { id: 'ramintra', name: 'รามอินทรา', lat: 13.8488, lng: 100.6438 }, // ถนนรามอินทรา ช่วงกลาง
  { id: 'kaset', name: 'เกษตร–รัชโยธิน', lat: 13.8334, lng: 100.5719 }, // ระหว่างแยกเกษตรกับแยกรัชโยธิน
  { id: 'laplae', name: 'ลับแล อุตรดิตถ์', lat: 17.6513, lng: 100.0391 }, // ที่ว่าการอำเภอลับแล
];

// ---- Sending limits agreed with the owner (LINE free plan: 300 messages a month, counted per recipient) ----

export const ALERT_LIMITS = {
  /** People expected to follow the LINE account. One broadcast costs one message per person. */
  recipients: 6,
  /** Messages kept back for the single "monthly limit reached" notice. */
  reserveMessages: 12,
  /** Free plan quota, used when LINE's own quota cannot be read. */
  monthlyQuota: 300,
  maxPerDay: 2,
  minGapHours: 3,
} as const;

/** Sends allowed per month: (300 - 12) / 6 = 48 with the defaults. */
export function monthlySendCap(quota: number = ALERT_LIMITS.monthlyQuota, recipients: number = ALERT_LIMITS.recipients): number {
  return Math.max(0, Math.floor((quota - ALERT_LIMITS.reserveMessages) / Math.max(1, recipients)));
}

// ---- When to alert ----

/** Probability (%) from Open-Meteo at or above which rain counts as likely. */
export const PROB_THRESHOLD = 60;
/** mm in one hour at or above which rain counts as heavy (TMD's heavy rain starts at 10 mm/h). */
export const HEAVY_MM = 10;
/** Look at the current hour and the next two. */
export const LOOKAHEAD_HOURS = 2;

/** TMD weather condition codes. */
const COND_HEAVY_RAIN = 7;
const COND_THUNDERSTORM = 8;

export type AlertKind = 'storm' | 'heavy' | 'rain';
const STRENGTH: Record<AlertKind, number> = { rain: 1, heavy: 2, storm: 3 };

export interface AreaAlert {
  area: AlertArea;
  kind: AlertKind;
  /** Start of the first hour that meets the condition, ms. */
  atMs: number;
  /** Highest probability in the window, if known. */
  prob: number | null;
  /** Highest mm/h in the window, if known. */
  mm: number | null;
}

function inWindow(h: ForecastHour, now: number): boolean {
  const t = Date.parse(h.time);
  const hourStart = Math.floor(now / 3600000) * 3600000;
  return t >= hourStart && t <= now + LOOKAHEAD_HOURS * 3600000;
}

/**
 * Decide whether one area needs an alert from its forecast. Only fresh forecast parts count
 * (`ok` and fetched within the last 3 hours). Returns the strongest condition found:
 * thunderstorm (TMD) > heavy rain (TMD code or >= 10 mm/h) > rain likely (Open-Meteo >= 60 %).
 */
export function evaluateArea(area: AlertArea, fc: ForecastResponse, now: number): AreaAlert | null {
  const fresh = (fetchedAt: string | null) => !!fetchedAt && now - Date.parse(fetchedAt) < 3 * 3600000;
  const tmd = fc.tmd.ok && fresh(fc.tmd.fetched_at) ? fc.tmd.hours.filter((h) => inWindow(h, now)) : [];
  const om = fc.openmeteo.ok && fresh(fc.openmeteo.fetched_at) ? fc.openmeteo.hours.filter((h) => inWindow(h, now)) : [];

  let best: { kind: AlertKind; atMs: number } | null = null;
  const consider = (kind: AlertKind, time: string) => {
    const atMs = Date.parse(time);
    if (!best || STRENGTH[kind] > STRENGTH[best.kind] || (kind === best.kind && atMs < best.atMs)) best = { kind, atMs };
  };
  for (const h of tmd) {
    if (h.cond === COND_THUNDERSTORM) consider('storm', h.time);
    else if (h.cond === COND_HEAVY_RAIN || (h.mm ?? 0) >= HEAVY_MM) consider('heavy', h.time);
  }
  for (const h of om) {
    if ((h.mm ?? 0) >= HEAVY_MM) consider('heavy', h.time);
    else if ((h.prob ?? 0) >= PROB_THRESHOLD) consider('rain', h.time);
  }
  if (!best) return null;
  const max = (xs: (number | null | undefined)[]) => {
    const v = xs.filter((x): x is number => typeof x === 'number');
    return v.length ? Math.max(...v) : null;
  };
  const b = best as { kind: AlertKind; atMs: number };
  return { area, kind: b.kind, atMs: b.atMs, prob: max(om.map((h) => h.prob)), mm: max([...tmd, ...om].map((h) => h.mm)) };
}

// ---- Message ----

const hhmm = (ms: number) => new Date(ms + 7 * 3600000).toISOString().slice(11, 16);

function describe(a: AreaAlert, now: number): string {
  const when = a.atMs <= now ? 'ตอนนี้' : `ช่วง ${hhmm(a.atMs)} น.`;
  const what =
    a.kind === 'storm'
      ? 'เสี่ยงพายุฝนฟ้าคะนอง'
      : a.kind === 'heavy'
        ? `ฝนหนัก${a.mm != null ? ` ราว ${Math.round(a.mm)} มม./ชม.` : ''}`
        : `โอกาสฝน ${a.prob}%`;
  return `• ${a.area.name}: ${what} ${when}`;
}

/** One message covering every area that needs an alert. Forecast wording only: no promised stop time. */
export function composeAlert(alerts: AreaAlert[], now: number, siteUrl: string, sendNo: number, cap: number, sources: string[]): string {
  const sorted = [...alerts].sort((x, y) => STRENGTH[y.kind] - STRENGTH[x.kind] || x.atMs - y.atMs);
  const icon = sorted.some((a) => a.kind !== 'rain') ? '⛈️' : '🌧️';
  return [
    `${icon} เตือนฝน · ${hhmm(now)} น.`,
    ...sorted.map((a) => describe(a, now)),
    '',
    `ที่มา: ${sources.join(', ')} (เป็นพยากรณ์ อาจคลาดเคลื่อน)`,
    `ดูรายละเอียด: ${siteUrl}`,
    `แจ้งเตือนครั้งที่ ${sendNo}/${cap} ของเดือนนี้`,
    'ใช้ประกอบการตัดสินใจเท่านั้น โปรดตรวจสอบประกาศทางการอีกครั้ง',
  ].join('\n');
}

export function composeQuotaNotice(cap: number, siteUrl: string): string {
  return [
    `🔕 แจ้งเตือนฝนของเดือนนี้ครบ ${cap} ครั้งแล้ว`,
    'จะเริ่มแจ้งเตือนอีกครั้งวันที่ 1 ของเดือนหน้า',
    `ระหว่างนี้ดูสถานการณ์ได้ที่ ${siteUrl}`,
  ].join('\n');
}

// ---- Budget ----

export interface SentRow {
  sent_at: string;
  kind: 'alert' | 'quota';
  ok: number;
}

export type Decision = { send: 'alert'; sendNo: number } | { send: 'quota' } | { send: false; reason: string };

/** Month and day boundaries follow Thai time. */
const bkk = (ms: number) => new Date(ms + 7 * 3600000).toISOString();

/** Apply the limits: 2 a day, 3 hours apart, `cap` a month, then one "limit reached" notice. */
export function decide(rows: SentRow[], now: number, cap: number): Decision {
  const month = bkk(now).slice(0, 7);
  const day = bkk(now).slice(0, 10);
  const ok = rows.filter((r) => r.ok === 1);
  const monthAlerts = ok.filter((r) => r.kind === 'alert' && bkk(Date.parse(r.sent_at)).startsWith(month));
  if (monthAlerts.length >= cap) {
    return ok.some((r) => r.kind === 'quota' && bkk(Date.parse(r.sent_at)).startsWith(month))
      ? { send: false, reason: 'monthly limit reached' }
      : { send: 'quota' };
  }
  const today = monthAlerts.filter((r) => bkk(Date.parse(r.sent_at)).startsWith(day));
  if (today.length >= ALERT_LIMITS.maxPerDay) return { send: false, reason: 'daily limit reached' };
  const last = Math.max(0, ...monthAlerts.map((r) => Date.parse(r.sent_at)));
  // Attempts that failed still count towards the gap, so a broken token is not retried every 10 minutes.
  const lastAttempt = Math.max(0, ...rows.map((r) => Date.parse(r.sent_at)));
  if (now - Math.max(last, lastAttempt) < ALERT_LIMITS.minGapHours * 3600000) return { send: false, reason: 'too soon after the last alert' };
  return { send: 'alert', sendNo: monthAlerts.length + 1 };
}
