import { ALERT_AREAS, evaluateArea, outlookArea, type AreaAlert, type AreaOutlook } from '../shared/alerts';
import { checkTemplate, DEFAULT_TEMPLATES, normalizeTemplate, renderSummary, worstCaseLength, type TemplateKind } from '../shared/templates';
import type { AdminLineState, LineUser } from '../shared/types';
import { clearCookie, isAdmin, lockedOut, makeSession, recordLoginFailure, safeEqual, sessionCookie, validLineSignature } from './auth';
import type { Env } from './env';
import { getForecast } from './forecast';
import { accountInfo, broadcast, multicast, profile, reply, webhookEndpoint } from './line';
import { loadTemplates, resetTemplate, saveTemplate } from './settings';

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

// ---------- forecast data for compose and preview ----------

interface Sample {
  now: number;
  siteUrl: string;
  alerts: AreaAlert[];
  outlooks: AreaOutlook[];
  sources: string[];
}

/** Current forecast turned into the inputs of the message renderers (2-hour alerts and 12-hour outlooks). */
async function currentSample(env: Env): Promise<Sample> {
  const now = Date.now();
  const alerts: AreaAlert[] = [];
  const outlooks: AreaOutlook[] = [];
  const sources = new Set<string>();
  for (const area of ALERT_AREAS) {
    try {
      const { res } = await getForecast(env, area.lat, area.lng);
      const hit = evaluateArea(area, res, now);
      if (hit) alerts.push(hit);
      outlooks.push(outlookArea(area, res, now));
      if (res.tmd.ok) sources.add('กรมอุตุนิยมวิทยา');
      if (res.openmeteo.ok) sources.add('Open-Meteo');
    } catch {
      /* area left out of the sample */
    }
  }
  return { now, siteUrl: env.SITE_URL ?? '', alerts, outlooks, sources: [...sources] };
}

/** Text for the send page: the 12-hour outlook in the saved summary format, without the monthly counter. */
async function forecastText(env: Env): Promise<string> {
  const [sample, templates] = await Promise.all([currentSample(env), loadTemplates(env)]);
  return renderSummary(templates.summary, sample.outlooks, { now: sample.now, siteUrl: sample.siteUrl, sources: sample.sources });
}

// ---------- templates ----------

async function putTemplate(request: Request, env: Env): Promise<Response> {
  if (!hasAdminHeader(request)) return json({ error: 'bad_request' }, 400);
  const body = await readJson<{ kind?: TemplateKind; template?: unknown; reset?: boolean }>(request);
  const kind = body?.kind;
  if (kind !== 'alert' && kind !== 'summary') return json({ error: 'bad_kind' }, 400);
  if (body?.reset) {
    await resetTemplate(env, kind);
    return json({ ok: true, template: DEFAULT_TEMPLATES[kind] });
  }
  const tpl = normalizeTemplate(kind, body?.template);
  const longest = worstCaseLength(kind, tpl, ALERT_AREAS, { now: Date.now(), siteUrl: env.SITE_URL ?? '', sources: ['กรมอุตุนิยมวิทยา', 'Open-Meteo'], counter: { sendNo: 48, cap: 48 } });
  const check = checkTemplate(kind, (body?.template ?? {}) as object, longest);
  if (!check.ok) return json({ error: 'invalid', errors: check.errors, longest }, 400);
  await saveTemplate(env, kind, tpl);
  return json({ ok: true, template: tpl, longest });
}

/** Send the previewed text to one chosen person only, marked as a test. Costs one message. */
async function sendTest(request: Request, env: Env): Promise<Response> {
  if (!hasAdminHeader(request)) return json({ error: 'bad_request' }, 400);
  const token = env.LINE_CHANNEL_ACCESS_TOKEN?.trim();
  if (!token) return json({ error: 'line_not_configured' }, 503);
  const body = await readJson<{ text?: string; userId?: string }>(request);
  const text = `[ทดสอบรูปแบบข้อความ]\n${String(body?.text ?? '').trim()}`;
  if (text.length > 5000 || !body?.text?.trim()) return json({ error: 'bad_text' }, 400);
  const user = await env.DB.prepare('SELECT user_id FROM line_users WHERE user_id = ? AND following = 1').bind(String(body?.userId ?? '')).first<{ user_id: string }>();
  if (!user) return json({ error: 'no_recipients' }, 400);
  const at = new Date().toISOString();
  try {
    await multicast(token, [user.user_id], text);
    await env.DB.prepare("INSERT INTO alert_log (sent_at, kind, areas, message, ok, error, recipients) VALUES (?, 'manual', 'test', ?, 1, NULL, 1)").bind(at, text).run();
    return json({ ok: true, recipients: 1 });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await env.DB.prepare("INSERT INTO alert_log (sent_at, kind, areas, message, ok, error, recipients) VALUES (?, 'manual', 'test', ?, 0, ?, 1)").bind(at, text, message).run();
    return json({ error: 'send_failed', message }, 502);
  }
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
  if (path === '/api/admin/usage' && request.method === 'GET') {
    const month = new Date(Date.now() + 7 * 3600000).toISOString().slice(0, 7);
    const row = await env.DB.prepare("SELECT count FROM usage WHERE month = ? AND service = 'longdo'").bind(month).first<{ count: number }>();
    return json({ longdo: { configured: !!env.LONGDO_API_KEY, month, count: row?.count ?? 0, limit: 100_000 } });
  }
  if (path === '/api/admin/line' && request.method === 'GET') return json(await lineState(env));
  if (path === '/api/admin/line/compose' && request.method === 'GET') return json({ text: await forecastText(env) });
  if (path === '/api/admin/line/templates' && request.method === 'GET') return json({ templates: await loadTemplates(env), defaults: DEFAULT_TEMPLATES });
  if (path === '/api/admin/line/templates' && request.method === 'PUT') return putTemplate(request, env);
  if (path === '/api/admin/line/sample' && request.method === 'GET') return json(await currentSample(env));
  if (path === '/api/admin/line/test' && request.method === 'POST') return sendTest(request, env);
  if (path === '/api/admin/line/send' && request.method === 'POST') return send(request, env);
  return json({ error: 'not_found' }, 404);
}
