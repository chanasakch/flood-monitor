import { handleApi } from './api';
import { runCron } from './cron';
import type { Env } from './env';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return handleApi(request, env);
    // Everything else is the static frontend (served directly by the assets layer in production).
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCron(env, controller.cron, controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
