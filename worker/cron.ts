import { LAYER_SOURCE } from '../shared/sources';
import type { LayerType, Reading, SourceId } from '../shared/types';
import { getSnapshot, getStatus, prune, putSnapshot, recordFailure, recordSuccess } from './db';
import type { Env } from './env';
import { fetchCctv } from './fetchers/bma-cctv';
import { fetchRoad } from './fetchers/bma-road';
import { fetchHighway } from './fetchers/doh';
import { fetchRain } from './fetchers/thaiwater-rain';
import { fetchWater } from './fetchers/thaiwater-water';
import { fetchRadarImage, fetchRadarList } from './fetchers/tmd-radar';
import { packLayer, unpackLayer, type PackedLayer } from './pack';

export const CRON_RAIN = '*/10 * * * *';
export const CRON_SENSORS = '3-59/10 * * * *';
export const CRON_ANNOUNCE = '6-59/10 * * * *';

const CCTV_REFRESH_MS = 24 * 3600 * 1000;

/**
 * Sources that only answer requests arriving from inside Thailand (verified, see SOURCES.md).
 * Cloudflare runs cron triggers wherever it has spare capacity, usually abroad, so these are
 * refreshed from the request path instead (see `refreshOnVisit`), where the Worker runs at the
 * visitor's nearest location. Cron still runs them whenever it happens to execute in Thailand.
 */
export const THAILAND_ONLY: Partial<Record<LayerType, JobName>> = { road: 'road', highway: 'highway' };
const REFRESH_AFTER_MS = 9.5 * 60 * 1000;
const RETRY_AFTER_MS = 2 * 60 * 1000;

/** Country this invocation's outgoing requests come from, per Cloudflare's own trace endpoint. */
export async function egressCountry(): Promise<string | null> {
  try {
    const res = await fetch('https://www.cloudflare.com/cdn-cgi/trace', { signal: AbortSignal.timeout(4000) });
    return /^loc=([A-Z]{2})$/m.exec(await res.text())?.[1] ?? null;
  } catch {
    return null;
  }
}

/**
 * Called when a visitor requests a Thailand-only layer. If the stored data is older than one
 * cron interval, claim the refresh (so concurrent visitors trigger a single upstream call) and
 * run it. Upstream volume stays at most one request per source per ~10 minutes.
 * Returns a promise for `ctx.waitUntil` when a refresh was started, otherwise null.
 */
export async function refreshOnVisit(env: Env, layer: LayerType, fetchedAt: string | null): Promise<Promise<void> | null> {
  const job = THAILAND_ONLY[layer];
  if (!job) return null;
  const now = Date.now();
  if (fetchedAt && now - Date.parse(fetchedAt) < REFRESH_AFTER_MS) return null;
  const source = LAYER_SOURCE[layer];
  const nowIso = new Date(now).toISOString();
  const retryBefore = new Date(now - RETRY_AFTER_MS).toISOString();
  // Atomic claim: only one request gets `changes = 1` inside the retry window.
  await env.DB.prepare('INSERT OR IGNORE INTO source_status (source) VALUES (?)').bind(source).run();
  const claim = await env.DB.prepare(
    'UPDATE source_status SET last_attempt_at = ?1 WHERE source = ?2 AND (last_attempt_at IS NULL OR last_attempt_at < ?3)',
  )
    .bind(nowIso, source, retryBefore)
    .run();
  if (!claim.meta.changes) return null;
  return (async () => {
    // Outside Thailand the source would refuse; that is not a source failure, so do not record one.
    if ((await egressCountry()) !== 'TH') return;
    await JOBS[job](env);
  })();
}

/**
 * Run one source. On success its data replaces the stored snapshot. On any failure the previous
 * snapshot is left untouched (it ages and turns grey in the UI), the error is logged, and the
 * source shows as unavailable. Nothing is ever estimated to fill the gap.
 */
async function runSource(env: Env, source: SourceId, job: () => Promise<number | null>): Promise<void> {
  const started = Date.now();
  const at = new Date(started).toISOString();
  try {
    const count = await job();
    await recordSuccess(env.DB, source, at, count, Date.now() - started);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[${source}] fetch failed: ${message}`);
    try {
      await recordFailure(env.DB, source, at, message, Date.now() - started);
    } catch (dbErr) {
      console.error(`[${source}] could not record failure: ${dbErr instanceof Error ? dbErr.message : String(dbErr)}`);
    }
  }
}

async function storeLayer(env: Env, layer: LayerType, readings: Reading[]): Promise<number> {
  const body = JSON.stringify(packLayer(readings));
  await putSnapshot(env.DB, layer, LAYER_SOURCE[layer], new Date().toISOString(), readings.length, body);
  return readings.length;
}

/**
 * Append Bangkok road sensor readings to the 7-day history. To stay inside the D1 free write
 * quota a row is written only when the value changed since the last run, plus one baseline row
 * per sensor each hour.
 */
async function storeRoadHistory(env: Env, readings: Reading[], previousBody: string | null, nowMs: number): Promise<void> {
  const previous = new Map<string, number | null>();
  if (previousBody) {
    try {
      for (const r of unpackLayer(JSON.parse(previousBody) as PackedLayer)) previous.set(r.id, r.value);
    } catch {
      /* unreadable previous snapshot: treat everything as changed */
    }
  }
  const hourlyBaseline = new Date(nowMs).getUTCMinutes() < 10;
  const rows: [string, number, number][] = [];
  for (const r of readings) {
    if (r.value == null || !r.observed_at) continue;
    const ts = Math.floor(Date.parse(r.observed_at) / 1000);
    // Ignore sensors whose clock is far off (old or in the future): their history would mislead.
    if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > 3600) continue;
    if (hourlyBaseline || !previous.has(r.id) || previous.get(r.id) !== r.value) rows.push([r.id, ts, r.value]);
  }
  const CHUNK = 30; // 3 bound parameters per row, D1 allows 100 per statement
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    stmts.push(
      env.DB.prepare(`INSERT OR IGNORE INTO history (id, ts, value) VALUES ${chunk.map(() => '(?, ?, ?)').join(', ')}`).bind(...chunk.flat()),
    );
  }
  if (stmts.length) await env.DB.batch(stmts);
}

async function runRadar(env: Env): Promise<number> {
  const frame = await fetchRadarList();
  const current = await getSnapshot(env.DB, 'radar');
  const fetchedAt = new Date().toISOString();
  if (current) {
    try {
      // Same frame as last time: nothing to download.
      if ((JSON.parse(current.body) as { observed_at?: string }).observed_at === frame.observed_at) return 1;
    } catch {
      /* fall through and store again */
    }
  }
  const image = await fetchRadarImage(frame);
  const meta = JSON.stringify({ observed_at: frame.observed_at, bytes: image.byteLength });
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO blobs (key, updated_at, meta, body) VALUES ('radar', ?1, ?2, ?3)
       ON CONFLICT (key) DO UPDATE SET updated_at = ?1, meta = ?2, body = ?3`,
    ).bind(fetchedAt, meta, image),
    env.DB.prepare(
      `INSERT INTO snapshots (layer, source, fetched_at, item_count, body) VALUES ('radar', 'tmd-radar', ?1, 1, ?2)
       ON CONFLICT (layer) DO UPDATE SET fetched_at = ?1, body = ?2`,
    ).bind(fetchedAt, meta),
  ]);
  return 1;
}

const JOBS = {
  rain: (env: Env) => runSource(env, 'thaiwater-rain', async () => storeLayer(env, 'rain', await fetchRain())),
  water: (env: Env) => runSource(env, 'thaiwater-water', async () => storeLayer(env, 'water', await fetchWater())),
  road: (env: Env) =>
    runSource(env, 'bma-road', async () => {
      const readings = await fetchRoad();
      const previous = await getSnapshot(env.DB, 'road');
      const n = await storeLayer(env, 'road', readings);
      await storeRoadHistory(env, readings, previous?.body ?? null, Date.now());
      return n;
    }),
  radar: (env: Env) => runSource(env, 'tmd-radar', () => runRadar(env)),
  highway: (env: Env) => runSource(env, 'doh-hdms', async () => storeLayer(env, 'highway', await fetchHighway())),
  cctv: async (env: Env) => {
    // The camera directory rarely changes: refresh once a day.
    const current = await getSnapshot(env.DB, 'cctv');
    if (current && Date.now() - Date.parse(current.fetched_at) < CCTV_REFRESH_MS) return;
    // While the site is unreachable, try again every 6 hours instead of every run.
    const status = await getStatus(env.DB, 'bma-cctv');
    if (status?.consecutive_failures && status.last_attempt_at && Date.now() - Date.parse(status.last_attempt_at) < 6 * 3600 * 1000) return;
    await runSource(env, 'bma-cctv', async () => storeLayer(env, 'cctv', await fetchCctv()));
  },
};

export type JobName = keyof typeof JOBS;

export async function runJobs(env: Env, names: JobName[]): Promise<void> {
  await Promise.allSettled(names.map((n) => JOBS[n](env)));
}

/** Drop Thailand-only jobs unless this cron run happens to execute in Thailand. */
async function reachable(names: JobName[]): Promise<JobName[]> {
  const restricted = new Set<JobName>(Object.values(THAILAND_ONLY));
  if (!names.some((n) => restricted.has(n))) return names;
  return (await egressCountry()) === 'TH' ? names : names.filter((n) => !restricted.has(n));
}

export async function runCron(env: Env, cron: string, scheduledTime: number): Promise<void> {
  switch (cron) {
    case CRON_RAIN:
      return runJobs(env, ['rain']);
    case CRON_SENSORS:
      return runJobs(env, await reachable(['water', 'road', 'radar']));
    case CRON_ANNOUNCE: {
      await runJobs(env, await reachable(['highway', 'cctv']));
      // Housekeeping once a day, around 03:06 Thai time (20:06 UTC).
      const d = new Date(scheduledTime);
      if (d.getUTCHours() === 20 && d.getUTCMinutes() < 10) await prune(env.DB, scheduledTime);
      return;
    }
    default:
      // Manual trigger during local development: run everything.
      return runJobs(env, ['rain', 'water', 'road', 'radar', 'highway', 'cctv']);
  }
}
