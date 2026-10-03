import { ALERT_AREAS, evaluateArea } from '../shared/alerts';
import type { AdminLineState, LineUser } from '../shared/types';
import { clearCookie, isAdmin, lockedOut, makeSession, recordLoginFailure, safeEqual, sessionCookie, validLineSignature } from './auth';
import type { Env } from './env';
import { getForecast } from './forecast';
import { accountInfo, broadcast, multicast, profile, reply, webhookEndpoint } from './line';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' };
const json = (data: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });

/**
 * State-changing admin requests must carry this header. Browsers do not add custom headers to
 * cross-site form posts, so together with the SameSite=Strict cookie this blocks CSRF.
 */
const hasAdminHeader = (r: Request) => r.headers.get('x-fm-admin') === '1';

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

// ---------- sign in / out ----------

async function login(request: Request, env: Env): Promise<Response> {
  if (!env.ADMIN_PASSWORD || !env.SESSION_SECRET) return json({ error: 'not_configured' }, 503);
  if (!hasAdminHeader(request)) return json({ error: 'bad_request' }, 400);
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  if (await lockedOut(env, ip)) return json({ error: 'locked' }, 429);
  const body = await readJson<{ username?: string; password?: string }>(request);
  const ok = !!body && safeEqual(String(body.username ?? '').trim().toLowerCase(), 'admin') && safeEqual(String(body.password ?? ''), env.ADMIN_PASSWORD);
  if (!ok) {
    await recordLoginFailure(env, ip);
    return json({ error: 'wrong_credentials' }, 401);
  }
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie(await makeSession(env.SESSION_SECRET)) });
}

// ---------- LINE state for the send page ----------

async function lineState(env: Env): Promise<AdminLineState> {
  const token = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  const { results } = await env.DB.prepare('SELECT user_id, display_name, following, first_seen, last_seen FROM line_users ORDER BY following DESC, display_name').all<
    Omit<LineUser, 'following'> & { following: number }
  >();
  const users = results.map((u) => ({ ...u, following: u.following === 1 }));
  const { results: sends } = await env.DB.prepare('SELECT sent_at, kind, areas, message, ok, error, recipients FROM alert_log ORDER BY id DESC LIMIT 15').all<
    AdminLineState['recent'][number]
  >();
  let account: AdminLineState['account'] = null;
  let webhook: AdminLineState['webhook'] = null;
  if (token) {
    try {
      const a = await accountInfo(token);
      account = { name: a.name, quota: a.quota, used: a.used };
    } catch (e) {
      account = { name: null, quota: null, used: null, error: e instanceof Error ? e.message : String(e) };
    }
    try {
      webhook = await webhookEndpoint(token);
    } catch {
      webhook = null;
    }
  }
  return { configured: !!token, account, webhook, users, recent: sends.map((r) => ({ ...r, ok: Number(r.ok) })) };
}

// ---------- compose from the current forecast ----------

/** Text describing the forecast for every area right now, for the admin to edit before sending. */
async function forecastText(env: Env): Promise<string> {
  const now = Date.now();
  const hhmm = (ms: number) => new Date(ms + 7 * 3600000).toISOString().slice(11, 16);
  const lines = [`🌦️ สภาพอากาศ ${hhmm(now)} น. (พยากรณ์ 2 ชม. ข้างหน้า)`];
  for (const area of ALERT_AREAS) {
    try {
      const { res } = await getForecast(env, area.lat, area.lng);
      const hit = evaluateArea(area, res, now);
      const prob = res.openmeteo.hours.find((h) => Date.parse(h.time) >= Math.floor(now / 3600000) * 3600000)?.prob;
      if (hit) {
        const when = hit.atMs <= now ? 'ตอนนี้' : `ช่วง ${hhmm(hit.atMs)} น.`;
        const what = hit.kind === 'storm' ? 'เสี่ยงพายุฝนฟ้าคะนอง' : hit.kind === 'heavy' ? 'ฝนหนัก' : `โอกาสฝน ${hit.prob}%`;
        lines.push(`• ${area.name}: ${what} ${when}`);
      } else {
        lines.push(`• ${area.name}: โอกาสฝนต่ำ${prob != null ? ` (${prob}%)` : ''}`);
      }
    } catch {
      lines.push(`• ${area.name}: ไม่มีข้อมูลพยากรณ์`);
    }
  }
  lines.push('', `ดูรายละเอียด: ${env.SITE_URL ?? ''}`, 'ใช้ประกอบการตัดสินใจเท่านั้น โปรดตรวจสอบประกาศทางการอีกครั้ง');
  return lines.join('\n');
}

// ---------- send ----------

async function send(request: Request, env: Env): Promise<Response> {
  if (!hasAdminHeader(request)) return json({ error: 'bad_request' }, 400);
  const token = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!token) return json({ error: 'line_not_configured' }, 503);
  const body = await readJson<{ text?: string; to?: 'all' | string[] }>(request);
  const text = String(body?.text ?? '').trim();
  if (!text || text.length > 2000) return json({ error: 'bad_text' }, 400);

  let recipients: number;
  let ids: string[] = [];
  if (body?.to === 'all') {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM line_users WHERE following = 1').first<{ n: number }>();
    // Broadcast reaches every friend, including people the site has not seen yet.
    recipients = Math.max(row?.n ?? 0, Number(env.ALERT_RECIPIENTS) || 6);
  } else if (Array.isArray(body?.to) && body.to.length) {
    const wanted = [...new Set(body.to.map(String))].slice(0, 100);
    const { results } = await env.DB.prepare(`SELECT user_id FROM line_users WHERE following = 1 AND user_id IN (${wanted.map(() => '?').join(',')})`)
      .bind(...wanted)
      .all<{ user_id: string }>();
    ids = results.map((r) => r.user_id);
    if (!ids.length) return json({ error: 'no_recipients' }, 400);
    recipients = ids.length;
  } else {
    return json({ error: 'no_recipients' }, 400);
  }

  // Refuse a send that LINE's own counter says would go over the monthly quota.
  try {
    const a = await accountInfo(token);
    if (a.quota != null && a.quota - a.used < recipients) return json({ error: 'quota', remaining: a.quota - a.used }, 409);
  } catch {
    /* quota unreadable: LINE itself will refuse if over */
  }

  const at = new Date().toISOString();
  try {
    if (ids.length) await multicast(token, ids, text);
    else await broadcast(token, text);
    await env.DB.prepare('INSERT INTO alert_log (sent_at, kind, areas, message, ok, error, recipients) VALUES (?, ?, ?, ?, 1, NULL, ?)')
      .bind(at, 'manual', ids.length ? `to:${ids.length}` : 'to:all', text, recipients)
      .run();
    return json({ ok: true, recipients });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await env.DB.prepare('INSERT INTO alert_log (sent_at, kind, areas, message, ok, error, recipients) VALUES (?, ?, ?, ?, 0, ?, ?)')
      .bind(at, 'manual', ids.length ? `to:${ids.length}` : 'to:all', text, message, recipients)
      .run();
    return json({ error: 'send_failed', message }, 502);
  }
}

// ---------- LINE webhook: learn who follows the account ----------

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type?: string; userId?: string };
}

export async function lineWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const secret = env.LINE_CHANNEL_SECRET?.trim();
  const token = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  const raw = await request.text();
  if (!secret || !(await validLineSignature(secret, raw, request.headers.get('x-line-signature')))) return new Response('forbidden', { status: 403 });
  let events: LineEvent[] = [];
  try {
    events = ((JSON.parse(raw) as { events?: LineEvent[] }).events ?? []).slice(0, 50);
  } catch {
    return new Response('bad request', { status: 400 });
  }
  // Answer LINE quickly; do the work in the background.
  ctx.waitUntil(
    (async () => {
      const now = new Date().toISOString();
      for (const ev of events) {
        const userId = ev.source?.type === 'user' ? ev.source.userId : undefined;
        if (!userId) continue;
        if (ev.type === 'unfollow') {
          await env.DB.prepare('UPDATE line_users SET following = 0, last_seen = ? WHERE user_id = ?').bind(now, userId).run();
          continue;
        }
        if (ev.type !== 'follow' && ev.type !== 'message') continue;
        const known = await env.DB.prepare('SELECT display_name, following FROM line_users WHERE user_id = ?').bind(userId).first<{ display_name: string | null; following: number }>();
        let name = known?.display_name ?? null;
        if (token && (!known || ev.type === 'follow')) name = (await profile(token, userId).catch(() => null)) ?? name;
        await env.DB.prepare(
          `INSERT INTO line_users (user_id, display_name, following, first_seen, last_seen) VALUES (?1, ?2, 1, ?3, ?3)
           ON CONFLICT (user_id) DO UPDATE SET display_name = ?2, following = 1, last_seen = ?3`,
        )
          .bind(userId, name, now)
          .run();
        // A free reply confirms registration the first time someone is seen.
        if (token && ev.replyToken && (!known || known.following === 0)) {
          await reply(token, ev.replyToken, 'ลงทะเบียนรับแจ้งเตือนฝนแล้ว ✅\nระบบจะส่งข้อความเมื่อพยากรณ์มีฝนหรือพายุในพื้นที่ที่เฝ้าดู').catch(() => {});
        }
      }
    })().catch((e) => console.error(`[webhook] ${e instanceof Error ? e.message : String(e)}`)),
  );
  return new Response('ok');
}

// ---------- router ----------

export async function handleAdmin(request: Request, env: Env, path: string): Promise<Response> {
  if (path === '/api/admin/login' && request.method === 'POST') return login(request, env);
  if (path === '/api/admin/logout' && request.method === 'POST') return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
  const admin = await isAdmin(request, env);
  if (path === '/api/admin/me') return json({ admin, configured: !!env.ADMIN_PASSWORD && !!env.SESSION_SECRET });
  if (!admin) return json({ error: 'unauthorized' }, 401);
  if (path === '/api/admin/line' && request.method === 'GET') return json(await lineState(env));
  if (path === '/api/admin/line/compose' && request.method === 'GET') return json({ text: await forecastText(env) });
  if (path === '/api/admin/line/send' && request.method === 'POST') return send(request, env);
  return json({ error: 'not_found' }, 404);
}
