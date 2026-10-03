import type { AdminLineState } from '../../shared/types';

/** Admin calls always send this header; the server rejects state changes without it (CSRF guard). */
async function call<T>(path: string, init: RequestInit = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'content-type': 'application/json', 'x-fm-admin': '1', ...(init.headers as Record<string, string>) },
  });
  let body: T;
  try {
    body = (await res.json()) as T;
  } catch {
    body = {} as T;
  }
  return { status: res.status, body };
}

export const adminMe = () => call<{ admin: boolean; configured: boolean }>('/api/admin/me');
export const adminLogin = (username: string, password: string) =>
  call<{ ok?: boolean; error?: string }>('/api/admin/login', { method: 'POST', body: JSON.stringify({ username, password }) });
export const adminLogout = () => call('/api/admin/logout', { method: 'POST' });
export const lineState = () => call<AdminLineState & { error?: string }>('/api/admin/line');
export const composeFromForecast = () => call<{ text?: string; error?: string }>('/api/admin/line/compose');
export const sendLine = (text: string, to: 'all' | string[]) =>
  call<{ ok?: boolean; recipients?: number; error?: string; message?: string; remaining?: number }>('/api/admin/line/send', {
    method: 'POST',
    body: JSON.stringify({ text, to }),
  });
