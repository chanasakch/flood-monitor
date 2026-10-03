import {
  ALERT_AREAS,
  ALERT_LIMITS,
  composeAlert,
  composeQuotaNotice,
  decide,
  evaluateArea,
  monthlySendCap,
  type AreaAlert,
  type SentRow,
} from '../shared/alerts';
import type { AlertsStatus } from '../shared/types';
import { cacheGet, cachePut } from './db';
import type { Env } from './env';
import { getForecast } from './forecast';
import { accountInfo, broadcast } from './line';

const STATUS_KEY = 'line:status';
const ACCOUNT_CHECK_MS = 6 * 3600 * 1000;

interface StoredStatus {
  checked_at: string;
  ok: boolean;
  name: string | null;
  quota: number | null;
  used: number | null;
  error: string | null;
}

async function readStatus(env: Env): Promise<StoredStatus | null> {
  const row = await cacheGet(env.DB, STATUS_KEY);
  if (!row) return null;
  try {
    return JSON.parse(row.body) as StoredStatus;
  } catch {
    return null;
  }
}

/** Check the token and quota every 6 hours (free calls), so the status page shows problems early. */
async function checkAccount(env: Env, token: string, force = false): Promise<StoredStatus> {
  const prev = await readStatus(env);
  if (!force && prev && Date.now() - Date.parse(prev.checked_at) < ACCOUNT_CHECK_MS) return prev;
  let status: StoredStatus;
  try {
    const a = await accountInfo(token);
    status = { checked_at: new Date().toISOString(), ok: true, name: a.name, quota: a.quota, used: a.used, error: null };
  } catch (e) {
    status = { checked_at: new Date().toISOString(), ok: false, name: prev?.name ?? null, quota: prev?.quota ?? null, used: prev?.used ?? null, error: e instanceof Error ? e.message : String(e) };
  }
  await cachePut(env.DB, STATUS_KEY, status.checked_at, 365 * 86400, JSON.stringify(status));
  return status;
}

async function recentSends(env: Env): Promise<SentRow[]> {
  const since = new Date(Date.now() - 40 * 86400000).toISOString();
  // Manual sends from the admin page are not automatic alerts; they only reduce the quota (below).
  const { results } = await env.DB.prepare("SELECT sent_at, kind, ok FROM alert_log WHERE sent_at >= ? AND kind != 'manual' ORDER BY sent_at").bind(since).all<SentRow>();
  return results;
}

/** Messages used this month by manual sends, which come out of the same LINE quota. */
async function manualMessagesThisMonth(env: Env): Promise<number> {
  const monthStart = new Date(Date.parse(new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7) + '-01T00:00:00+07:00')).toISOString();
  const row = await env.DB.prepare("SELECT COALESCE(SUM(recipients), 0) AS n FROM alert_log WHERE kind = 'manual' AND ok = 1 AND sent_at >= ?")
    .bind(monthStart)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

async function logSend(env: Env, kind: 'alert' | 'quota', areas: string[], message: string, ok: boolean, error: string | null): Promise<void> {
  await env.DB.prepare('INSERT INTO alert_log (sent_at, kind, areas, message, ok, error, recipients) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(new Date().toISOString(), kind, areas.join(','), message, ok ? 1 : 0, error, Number(env.ALERT_RECIPIENTS) || ALERT_LIMITS.recipients)
    .run();
}

/**
 * Called by cron every 10 minutes. Looks at the forecast for each area and, within the agreed
 * limits, sends one LINE broadcast listing every area where rain or a storm is expected in the
 * next two hours. Without a LINE token it only logs what it would have sent.
 */
export async function runAlerts(env: Env): Promise<void> {
  const now = Date.now();
  const token = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  const siteUrl = env.SITE_URL ?? 'https://flood-monitor.flood-monitor.workers.dev';
  const account = token ? await checkAccount(env, token) : null;

  const cap = monthlySendCap((account?.quota ?? ALERT_LIMITS.monthlyQuota) - (await manualMessagesThisMonth(env)), Number(env.ALERT_RECIPIENTS) || ALERT_LIMITS.recipients);
  const decision = decide(await recentSends(env), now, cap);
  if (decision.send === false) return;

  if (decision.send === 'quota') {
    const text = composeQuotaNotice(cap, siteUrl);
    if (!token) return console.log(`[alerts] (no LINE token) would send: ${text}`);
    try {
      await broadcast(token, text);
      await logSend(env, 'quota', [], text, true, null);
    } catch (e) {
      await logSend(env, 'quota', [], text, false, e instanceof Error ? e.message : String(e));
    }
    return;
  }

  const hits: AreaAlert[] = [];
  const sources = new Set<string>();
  for (const area of ALERT_AREAS) {
    try {
      const { res } = await getForecast(env, area.lat, area.lng);
      const hit = evaluateArea(area, res, now);
      if (hit) {
        hits.push(hit);
        if (res.tmd.ok) sources.add('กรมอุตุนิยมวิทยา');
        if (res.openmeteo.ok) sources.add('Open-Meteo');
      }
    } catch (e) {
      console.error(`[alerts] forecast for ${area.id} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!hits.length) return;

  const text = composeAlert(hits, now, siteUrl, decision.sendNo, cap, [...sources]);
  const ids = hits.map((h) => h.area.id);
  if (!token) return console.log(`[alerts] (no LINE token) would send: ${text}`);

  // Do not start a send that LINE's own counter says would go over the plan.
  const recipients = Number(env.ALERT_RECIPIENTS) || ALERT_LIMITS.recipients;
  if (account?.ok && account.quota != null && account.used != null && account.quota - account.used < recipients + ALERT_LIMITS.reserveMessages) {
    console.log('[alerts] skipped: LINE quota nearly used up');
    return;
  }
  try {
    await broadcast(token, text);
    await logSend(env, 'alert', ids, text, true, null);
    await checkAccount(env, token, true);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[alerts] LINE send failed: ${message}`);
    await logSend(env, 'alert', ids, text, false, message);
  }
}

/** Summary for the status page. */
export async function alertsStatus(env: Env): Promise<AlertsStatus> {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  const account = await readStatus(env);
  const recipients = Number(env.ALERT_RECIPIENTS) || ALERT_LIMITS.recipients;
  const cap = monthlySendCap((account?.quota ?? ALERT_LIMITS.monthlyQuota) - (await manualMessagesThisMonth(env)), recipients);
  const month = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7);
  const rows = (await recentSends(env)).filter((r) => new Date(Date.parse(r.sent_at) + 7 * 3600000).toISOString().startsWith(month));
  const last = await env.DB.prepare("SELECT sent_at, ok, error FROM alert_log WHERE kind != 'manual' ORDER BY id DESC LIMIT 1").first<{ sent_at: string; ok: number; error: string | null }>();
  return {
    configured: !!token,
    account_ok: account?.ok ?? null,
    account_name: account?.name ?? null,
    account_error: account?.error ?? null,
    checked_at: account?.checked_at ?? null,
    quota: account?.quota ?? null,
    used: account?.used ?? null,
    sent_this_month: rows.filter((r) => r.kind === 'alert' && r.ok === 1).length,
    cap,
    max_per_day: ALERT_LIMITS.maxPerDay,
    min_gap_hours: ALERT_LIMITS.minGapHours,
    last_sent_at: last?.sent_at ?? null,
    last_ok: last ? last.ok === 1 : null,
    last_error: last?.error ?? null,
    areas: ALERT_AREAS.map((a) => a.name),
  };
}
