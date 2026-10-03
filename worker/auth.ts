// Admin sign-in for the LINE send page. One account ("admin"); the password is the
// ADMIN_PASSWORD secret, never stored in code. Sessions are HMAC-signed cookies.

import type { Env } from './env';

export const COOKIE = 'fm_admin';
const SESSION_DAYS = 7;
/** Lockout: this many failures in the window blocks further attempts from that address. */
export const MAX_FAILURES_PER_IP = 5;
/** And this many from all addresses together, against slow distributed guessing. */
export const MAX_FAILURES_TOTAL = 20;
export const FAILURE_WINDOW_S = 15 * 60;

const enc = new TextEncoder();

async function hmac(secret: string, data: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(data));
}

const b64url = (buf: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

/** Compare without leaking where two strings differ through timing. */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export async function makeSession(secret: string, nowMs = Date.now()): Promise<string> {
  const exp = Math.floor(nowMs / 1000) + SESSION_DAYS * 86400;
  const payload = `admin.${exp}`;
  return `${payload}.${b64url(await hmac(secret, payload))}`;
}

export async function verifySession(secret: string, token: string | null | undefined, nowMs = Date.now()): Promise<boolean> {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'admin') return false;
  const exp = Number(parts[1]);
  if (!Number.isFinite(exp) || exp * 1000 < nowMs) return false;
  return safeEqual(parts[2], b64url(await hmac(secret, `${parts[0]}.${parts[1]}`)));
}

export function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}`;
}

export const clearCookie = () => `${COOKIE}=; Path=/api/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;

export function readCookie(request: Request): string | null {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(request.headers.get('cookie') ?? '');
  return m ? m[1] : null;
}

export async function isAdmin(request: Request, env: Env): Promise<boolean> {
  return !!env.SESSION_SECRET && (await verifySession(env.SESSION_SECRET, readCookie(request)));
}

/** True when sign-in attempts are currently blocked for this address (or for everyone). */
export async function lockedOut(env: Env, ip: string): Promise<boolean> {
  const since = Math.floor(Date.now() / 1000) - FAILURE_WINDOW_S;
  const row = await env.DB.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN ip = ? THEN 1 ELSE 0 END) AS mine FROM login_failures WHERE at >= ?')
    .bind(ip, since)
    .first<{ total: number; mine: number | null }>();
  return (row?.mine ?? 0) >= MAX_FAILURES_PER_IP || (row?.total ?? 0) >= MAX_FAILURES_TOTAL;
}

export async function recordLoginFailure(env: Env, ip: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.batch([
    env.DB.prepare('INSERT INTO login_failures (ip, at) VALUES (?, ?)').bind(ip, now),
    env.DB.prepare('DELETE FROM login_failures WHERE at < ?').bind(now - 86400),
  ]);
}

/** Check the LINE webhook signature: base64 HMAC-SHA256 of the raw body with the channel secret. */
export async function validLineSignature(channelSecret: string, body: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const expected = btoa(String.fromCharCode(...new Uint8Array(await hmac(channelSecret, body))));
  return safeEqual(expected, signature);
}
