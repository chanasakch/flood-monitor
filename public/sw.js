/* Service worker: caches the app shell and the last API responses so the site opens with a
   poor signal. Cached API data keeps its original observation times, so the page still greys
   it out as "not current" when it is old. */

const VERSION = 'v3';
const SHELL = `fm-shell-${VERSION}`;
const DATA = `fm-data-${VERSION}`;
const SHELL_URLS = ['/', '/manifest.webmanifest', '/icon.svg', '/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(SHELL_URLS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== SHELL && k !== DATA).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** Mark a cached API answer so the page can tell the visitor it is showing saved data. */
async function fromCache(cache, request) {
  const hit = await cache.match(request);
  if (!hit) return null;
  const headers = new Headers(hit.headers);
  headers.set('x-fm-cache', '1');
  return new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers });
}

async function apiNetworkFirst(request) {
  const cache = await caches.open(DATA);
  try {
    // Bypass the browser's HTTP cache: this worker keeps its own copy, and going straight to the
    // network is the only way to notice that the connection is gone.
    const res = await fetch(request, { cache: 'no-store' });
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const saved = await fromCache(cache, request);
    if (saved) return saved;
    throw err;
  }
}

const THAIWATER = 'https://api-v3.thaiwater.net';
const THAIWATER_FRESH_MS = 10 * 60 * 1000;

/**
 * ThaiWater is fetched directly by the page. Keep each answer for 10 minutes so reloading does
 * not download megabytes again, and fall back to the saved copy when the network fails.
 * `x-fm-stored` carries the time the copy was fetched; `x-fm-cache` marks an offline fallback.
 */
async function thaiwater(request) {
  const cache = await caches.open(DATA);
  const hit = await cache.match(request);
  const storedAt = hit ? Date.parse(hit.headers.get('x-fm-stored') || '') : NaN;
  if (hit && Date.now() - storedAt < THAIWATER_FRESH_MS) return hit;
  try {
    const res = await fetch(request);
    if (!res.ok) return res;
    const headers = new Headers(res.headers);
    headers.set('x-fm-stored', new Date().toISOString());
    const copy = new Response(await res.blob(), { status: 200, headers });
    await cache.put(request, copy.clone());
    return copy;
  } catch (err) {
    if (!hit) throw err;
    const headers = new Headers(hit.headers);
    headers.set('x-fm-cache', '1');
    return new Response(await hit.blob(), { status: 200, headers });
  }
}

async function radarFrame(request) {
  // Each frame has its own URL (?t=time) and never changes: serve from cache, keep only a few.
  const cache = await caches.open(DATA);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    await cache.put(request, res.clone());
    const frames = (await cache.keys()).filter((k) => new URL(k.url).pathname === '/api/radar/frame.png');
    for (const old of frames.slice(0, Math.max(0, frames.length - 3))) await cache.delete(old);
  }
  return res;
}

async function assetCacheFirst(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) cache.put(request, res.clone());
  return res;
}

async function pageNetworkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await fetch(request);
    if (res.ok) cache.put('/', res.clone());
    return res;
  } catch (err) {
    const shell = await cache.match('/');
    if (shell) return shell;
    throw err;
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === THAIWATER) return event.respondWith(thaiwater(request));
  if (url.origin !== self.location.origin) return; // map tiles and other origins: browser default

  if (url.pathname === '/api/radar/frame.png') event.respondWith(radarFrame(request));
  else if (url.pathname.startsWith('/api/')) event.respondWith(apiNetworkFirst(request));
  else if (request.mode === 'navigate') event.respondWith(pageNetworkFirst(request));
  else if (url.pathname.startsWith('/assets/') || SHELL_URLS.includes(url.pathname)) event.respondWith(assetCacheFirst(request));
});
