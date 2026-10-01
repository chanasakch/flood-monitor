import type { LayerType, SourceId, SourceStatus } from '../shared/types';

export interface SnapshotRow {
  layer: string;
  source: string;
  fetched_at: string;
  item_count: number;
  body: string;
}

export async function getSnapshot(db: D1Database, layer: LayerType | 'radar'): Promise<SnapshotRow | null> {
  return db.prepare('SELECT layer, source, fetched_at, item_count, body FROM snapshots WHERE layer = ?').bind(layer).first<SnapshotRow>();
}

export async function putSnapshot(
  db: D1Database,
  layer: LayerType | 'radar',
  source: SourceId,
  fetchedAt: string,
  itemCount: number,
  body: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO snapshots (layer, source, fetched_at, item_count, body) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (layer) DO UPDATE SET source = ?2, fetched_at = ?3, item_count = ?4, body = ?5`,
    )
    .bind(layer, source, fetchedAt, itemCount, body)
    .run();
}

export async function getStatus(db: D1Database, source: SourceId): Promise<SourceStatus | null> {
  return db.prepare('SELECT * FROM source_status WHERE source = ?').bind(source).first<SourceStatus>();
}

export async function getAllStatuses(db: D1Database): Promise<SourceStatus[]> {
  const { results } = await db.prepare('SELECT * FROM source_status').all<SourceStatus>();
  return results;
}

export async function recordSuccess(
  db: D1Database,
  source: SourceId,
  at: string,
  itemCount: number | null,
  durationMs: number,
): Promise<void> {
  const before = await getStatus(db, source);
  const stmts = [
    db
      .prepare(
        `INSERT INTO source_status (source, last_attempt_at, last_success_at, consecutive_failures, item_count, duration_ms)
         VALUES (?1, ?2, ?2, 0, ?3, ?4)
         ON CONFLICT (source) DO UPDATE SET last_attempt_at = ?2, last_success_at = ?2,
           consecutive_failures = 0, item_count = ?3, duration_ms = ?4`,
      )
      .bind(source, at, itemCount, durationMs),
  ];
  // Log the recovery so the status page shows when a broken source came back.
  if (before && before.consecutive_failures > 0) {
    stmts.push(
      db.prepare('INSERT INTO fetch_log (source, at, ok, message, duration_ms) VALUES (?, ?, 1, ?, ?)').bind(source, at, 'recovered', durationMs),
    );
  }
  await db.batch(stmts);
}

export async function recordFailure(
  db: D1Database,
  source: SourceId,
  at: string,
  message: string,
  durationMs: number,
): Promise<void> {
  const msg = message.slice(0, 300);
  await db.batch([
    db
      .prepare(
        `INSERT INTO source_status (source, last_attempt_at, last_error_at, last_error, consecutive_failures, duration_ms)
         VALUES (?1, ?2, ?2, ?3, 1, ?4)
         ON CONFLICT (source) DO UPDATE SET last_attempt_at = ?2, last_error_at = ?2, last_error = ?3,
           consecutive_failures = consecutive_failures + 1, duration_ms = ?4`,
      )
      .bind(source, at, msg, durationMs),
    db.prepare('INSERT INTO fetch_log (source, at, ok, message, duration_ms) VALUES (?, ?, 0, ?, ?)').bind(source, at, msg, durationMs),
  ]);
}

export interface CacheRow {
  fetched_at: string;
  expires_at: number;
  body: string;
}

export async function cacheGet(db: D1Database, key: string): Promise<CacheRow | null> {
  return db.prepare('SELECT fetched_at, expires_at, body FROM cache WHERE key = ?').bind(key).first<CacheRow>();
}

export async function cachePut(db: D1Database, key: string, fetchedAt: string, ttlSeconds: number, body: string): Promise<void> {
  const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
  await db
    .prepare(
      `INSERT INTO cache (key, fetched_at, expires_at, body) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT (key) DO UPDATE SET fetched_at = ?2, expires_at = ?3, body = ?4`,
    )
    .bind(key, fetchedAt, expires, body)
    .run();
}

/** Remove rows past retention: 7 days of history and error log, cache entries a day past expiry. */
export async function prune(db: D1Database, nowMs: number): Promise<void> {
  const weekAgoS = Math.floor(nowMs / 1000) - 7 * 86400;
  const weekAgoIso = new Date(nowMs - 7 * 86400000).toISOString();
  await db.batch([
    db.prepare('DELETE FROM history WHERE ts < ?').bind(weekAgoS),
    db.prepare('DELETE FROM fetch_log WHERE at < ?').bind(weekAgoIso),
    db.prepare('DELETE FROM cache WHERE expires_at < ?').bind(Math.floor(nowMs / 1000) - 86400),
  ]);
}
