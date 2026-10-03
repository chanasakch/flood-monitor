import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeSession, safeEqual, validLineSignature, verifySession } from '../worker/auth';

const SECRET = 'test-session-secret';

describe('admin session', () => {
  it('accepts its own fresh token', async () => {
    expect(await verifySession(SECRET, await makeSession(SECRET))).toBe(true);
  });

  it('rejects expired, tampered, foreign and empty tokens', async () => {
    const t = await makeSession(SECRET, Date.now() - 8 * 86400000);
    expect(await verifySession(SECRET, t)).toBe(false);
    const good = await makeSession(SECRET);
    const [, exp, sig] = good.split('.');
    expect(await verifySession(SECRET, `admin.${Number(exp) + 999999}.${sig}`)).toBe(false);
    expect(await verifySession('other-secret', good)).toBe(false);
    expect(await verifySession(SECRET, `guest.${exp}.${sig}`)).toBe(false);
    expect(await verifySession(SECRET, '')).toBe(false);
    expect(await verifySession(SECRET, null)).toBe(false);
  });

  it('compares strings without shortcuts', () => {
    expect(safeEqual('110208', '110208')).toBe(true);
    expect(safeEqual('110208', '110209')).toBe(false);
    expect(safeEqual('110208', '1102080')).toBe(false);
    expect(safeEqual('', '')).toBe(true);
  });
});

describe('LINE webhook signature', () => {
  const channelSecret = 'line-channel-secret';
  const body = JSON.stringify({ destination: 'U1', events: [{ type: 'follow', source: { type: 'user', userId: 'U123' } }] });
  const sign = (b: string, s = channelSecret) => createHmac('sha256', s).update(b).digest('base64');

  it('accepts a request signed with the channel secret', async () => {
    expect(await validLineSignature(channelSecret, body, sign(body))).toBe(true);
  });

  it('rejects missing, wrong or altered signatures', async () => {
    expect(await validLineSignature(channelSecret, body, null)).toBe(false);
    expect(await validLineSignature(channelSecret, body, sign(body, 'wrong'))).toBe(false);
    expect(await validLineSignature(channelSecret, body + ' ', sign(body))).toBe(false);
  });
});
