import { runCron } from './cron';
import type { Env } from './env';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM source_status').first<{ n: number }>();
      return Response.json({ ok: true, sources_seen: row?.n ?? 0 });
    }
    if (url.pathname.startsWith('/api/')) return Response.json({ error: 'not found' }, { status: 404 });
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(env, controller.cron, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
