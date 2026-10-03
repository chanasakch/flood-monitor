// LINE Messaging API: broadcast to everyone who has added the family's LINE Official Account.
// Broadcast needs no list of user ids and no webhook. Docs: https://developers.line.biz/en/reference/messaging-api/

import { UpstreamError } from './lib/http';

const API = 'https://api.line.me/v2/bot';

async function call(token: string, path: string, init: RequestInit = {}): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(API + path, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers as Record<string, string>) },
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    throw new UpstreamError(`network error: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await res.text();
  if (!res.ok) {
    let detail = text.slice(0, 160);
    try {
      detail = (JSON.parse(text) as { message?: string }).message ?? detail;
    } catch {
      /* not JSON */
    }
    throw new UpstreamError(`LINE ${res.status}: ${detail}`);
  }
  return text ? JSON.parse(text) : {};
}

export async function broadcast(token: string, text: string): Promise<void> {
  await call(token, '/message/broadcast', {
    method: 'POST',
    // Lets LINE drop a duplicate if this request is retried.
    headers: { 'x-line-retry-key': crypto.randomUUID() },
    body: JSON.stringify({ messages: [{ type: 'text', text: text.slice(0, 4900) }] }),
  });
}

export interface LineAccount {
  name: string | null;
  /** Monthly message quota, or null when the plan has no fixed limit. */
  quota: number | null;
  used: number;
}

/** Read the account name and this month's quota and usage. These calls do not use up any messages. */
export async function accountInfo(token: string): Promise<LineAccount> {
  const [info, quota, usage] = await Promise.all([
    call(token, '/info') as Promise<{ displayName?: string }>,
    call(token, '/message/quota') as Promise<{ type?: string; value?: number }>,
    call(token, '/message/quota/consumption') as Promise<{ totalUsage?: number }>,
  ]);
  return {
    name: info.displayName ?? null,
    quota: quota.type === 'limited' && typeof quota.value === 'number' ? quota.value : null,
    used: typeof usage.totalUsage === 'number' ? usage.totalUsage : 0,
  };
}
