/* Service worker: caches the app shell and the last API responses so the site opens with a
   poor signal. Cached API data keeps its original observation times, so the page still greys
   it out as "not current" when it is old. */

const VERSION = 'v1';
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
    const res = await fetch(request);
    if (res.ok) cache.put(request, res.clone());
    return res;
  } catch (err) {
    const saved = await fromCache(cache, request);
    if (saved) return saved;
    throw err;
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
  if (url.origin !== self.location.origin) return; // map tiles and other origins: browser default

  if (url.pathname === '/api/radar/frame.png') event.respondWith(radarFrame(request));
  else if (url.pathname.startsWith('/api/')) event.respondWith(apiNetworkFirst(request));
  else if (request.mode === 'navigate') event.respondWith(pageNetworkFirst(request));
  else if (url.pathname.startsWith('/assets/') || SHELL_URLS.includes(url.pathname)) event.respondWith(assetCacheFirst(request));
});
