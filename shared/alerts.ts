import { DEFAULT_TEMPLATES, renderAlert, renderSummary } from './templates';
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
  // Rayong districts: each point is the subdistrict that holds the district seat, from the TMD
  // subdistrict file (public/gazetteer.json).
  { id: 'nikhomphatthana', name: 'นิคมพัฒนา ระยอง', lat: 12.8435, lng: 101.1811 }, // ต.นิคมพัฒนา อ.นิคมพัฒนา
  { id: 'mueangrayong', name: 'เมืองระยอง', lat: 12.6893, lng: 101.2687 }, // ต.ท่าประดู่ ตัวเมืองระยอง
  { id: 'pluakdaeng', name: 'ปลวกแดง ระยอง', lat: 12.9843, lng: 101.2118 }, // ต.ปลวกแดง อ.ปลวกแดง
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

function inWindow(h: ForecastHour, now: number, hours: number = LOOKAHEAD_HOURS): boolean {
  const t = Date.parse(h.time);
  const hourStart = Math.floor(now / 3600000) * 3600000;
  return t >= hourStart && t <= now + hours * 3600000;
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

// ---- Twice-daily summary (08:00 and 18:00, only when rain is expected) ----

/** Thai-time hours at which a summary may be sent; each slot stays open for `SLOT_SPAN_HOURS`. */
export const SUMMARY_HOURS = [8, 18] as const;
/** The slot stays open this long, so a summary blocked by the 3-hour gap can still go out a bit later. */
export const SLOT_SPAN_HOURS = 2;
export const SUMMARY_WINDOW_HOURS = 12;

/** The summary slot open right now (8 or 18), or null. */
export function currentSlot(now: number): number | null {
  const h = new Date(now + 7 * 3600000).getUTCHours();
  return SUMMARY_HOURS.find((s) => h >= s && h < s + SLOT_SPAN_HOURS) ?? null;
}

export interface AreaOutlook {
  area: AlertArea;
  /** Strongest condition in the window, or null when rain is not likely. */
  kind: AlertKind | null;
  /** First and last wet hour (start of hour, ms), when `kind` is set. */
  fromMs: number | null;
  toMs: number | null;
  maxProb: number | null;
}

/** Same conditions as the urgent alert, over the next 12 hours, keeping the span of wet hours. */
export function outlookArea(area: AlertArea, fc: ForecastResponse, now: number, hours: number = SUMMARY_WINDOW_HOURS): AreaOutlook {
  const fresh = (fetchedAt: string | null) => !!fetchedAt && now - Date.parse(fetchedAt) < 3 * 3600000;
  const tmd = fc.tmd.ok && fresh(fc.tmd.fetched_at) ? fc.tmd.hours.filter((h) => inWindow(h, now, hours)) : [];
  const om = fc.openmeteo.ok && fresh(fc.openmeteo.fetched_at) ? fc.openmeteo.hours.filter((h) => inWindow(h, now, hours)) : [];
  const wet = new Map<number, AlertKind>();
  const mark = (time: string, kind: AlertKind) => {
    const t = Date.parse(time);
    const prev = wet.get(t);
    if (!prev || STRENGTH[kind] > STRENGTH[prev]) wet.set(t, kind);
  };
  for (const h of tmd) {
    if (h.cond === COND_THUNDERSTORM) mark(h.time, 'storm');
    else if (h.cond === COND_HEAVY_RAIN || (h.mm ?? 0) >= HEAVY_MM) mark(h.time, 'heavy');
  }
  for (const h of om) {
    if ((h.mm ?? 0) >= HEAVY_MM) mark(h.time, 'heavy');
    else if ((h.prob ?? 0) >= PROB_THRESHOLD) mark(h.time, 'rain');
  }
  const probs = om.map((h) => h.prob).filter((p): p is number => typeof p === 'number');
  const maxProb = probs.length ? Math.max(...probs) : null;
  if (!wet.size) return { area, kind: null, fromMs: null, toMs: null, maxProb };
  const times = [...wet.keys()].sort((a, b) => a - b);
  const kind = [...wet.values()].reduce((a, b) => (STRENGTH[b] > STRENGTH[a] ? b : a));
  return { area, kind, fromMs: times[0], toMs: times[times.length - 1], maxProb };
}

/** Area ids and wet spans a summary covered, stored with the send: "minburi@<from>-<to>". */
export function encodeCoverage(outlooks: AreaOutlook[]): string {
  return outlooks
    .filter((o) => o.kind && o.fromMs != null && o.toMs != null)
    .map((o) => `${o.area.id}@${o.fromMs}-${o.toMs}`)
    .join(',');
}

/** True when a recent summary already announced rain for this area at this hour: no need to alert again. */
export function alreadyAnnounced(alert: AreaAlert, coverage: string[]): boolean {
  return coverage.some((c) =>
    c.split(',').some((entry) => {
      const m = /^([a-z]+)@(\d+)-(\d+)$/.exec(entry);
      return !!m && m[1] === alert.area.id && alert.atMs >= Number(m[2]) && alert.atMs <= Number(m[3]);
    }),
  );
}

// ---- Message ----

/** Urgent alert with the default template (the worker passes the saved template to `renderAlert`). */
export function composeAlert(alerts: AreaAlert[], now: number, siteUrl: string, sendNo: number, cap: number, sources: string[]): string {
  return renderAlert(DEFAULT_TEMPLATES.alert, alerts, { now, siteUrl, sources, counter: { sendNo, cap } });
}

/** 12-hour outlook with the default template. */
export function composeSummary(outlooks: AreaOutlook[], now: number, siteUrl: string, sendNo: number, cap: number, sources: string[]): string {
  return renderSummary(DEFAULT_TEMPLATES.summary, outlooks, { now, siteUrl, sources, counter: { sendNo, cap } });
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
  kind: 'alert' | 'summary' | 'quota';
  ok: number;
}

/** Automatic sends that count towards the daily and monthly limits. */
const counts = (r: SentRow) => r.kind === 'alert' || r.kind === 'summary';

export type Decision = { send: 'alert'; sendNo: number } | { send: 'quota' } | { send: false; reason: string };

/** Month and day boundaries follow Thai time. */
const bkk = (ms: number) => new Date(ms + 7 * 3600000).toISOString();

/** Apply the limits to alerts and summaries together: 2 a day, 3 hours apart, `cap` a month, then one "limit reached" notice. */
export function decide(rows: SentRow[], now: number, cap: number): Decision {
  const month = bkk(now).slice(0, 7);
  const day = bkk(now).slice(0, 10);
  const ok = rows.filter((r) => r.ok === 1);
  const monthAlerts = ok.filter((r) => counts(r) && bkk(Date.parse(r.sent_at)).startsWith(month));
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
