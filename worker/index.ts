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

  async scheduled(_controller: ScheduledController, _env: Env, _ctx: ExecutionContext): Promise<void> {
    // Fetchers are wired in Phase 3.
  },
} satisfies ExportedHandler<Env>;
