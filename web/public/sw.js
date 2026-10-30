const BUILD_ID = '__KOMOD_BUILD_ID__';
const CACHE_NAME = `komod-shell-${BUILD_ID}`;
const COVER_CACHE = 'komod-covers-v4';
const MAX_COVER_ENTRIES = 250;
const CORE_ASSETS = ['/', '/index.html', '/offline.html', '/manifest.webmanifest', '/komod.svg', '/komod-192.png', '/komod-512.png', '/komod-maskable-512.png', '/apple-touch-icon.png'];
// Vite replaces these lists after the bundle graph is known. Only the entry
// and its static imports gate installation; lazy screens are warmed separately
// so one flaky optional request cannot invalidate an otherwise working update.
const CORE_BUILD_ASSETS = /*__KOMOD_CORE_BUILD_ASSETS__*/ [];
const OPTIONAL_BUILD_ASSETS = /*__KOMOD_OPTIONAL_BUILD_ASSETS__*/ [];

async function trimCache(cacheName, maximumEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length <= maximumEntries) return;
  await Promise.all(keys.slice(0, keys.length - maximumEntries).map(key => cache.delete(key)));
}

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      const response = await fetch('/index.html', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to cache the application shell');
      const html = await response.clone().text();
      const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1]);
      const requiredAssets = [...new Set([...CORE_BUILD_ASSETS, ...assetPaths])];
      // Keep the boot graph atomic. The previous worker remains active if the
      // HTML, entry script, CSS, or one of their static imports is unavailable.
      await cache.addAll(requiredAssets.map(asset => new Request(asset, { cache: 'reload' })));
      await Promise.all([
        cache.put('/index.html', response.clone()),
        cache.put('/', response.clone()),
        ...CORE_ASSETS.filter(asset => asset !== '/' && asset !== '/index.html').map(asset =>
          fetch(asset, { cache: 'no-store' }).then(optional => optional.ok ? cache.put(asset, optional) : undefined).catch(() => undefined)
        ),
      ]);
    }).then(() => self.skipWaiting())
  );
});

let optionalWarmPromise = null;
function warmOptionalAssets() {
  if (optionalWarmPromise) return optionalWarmPromise;
  optionalWarmPromise = (async () => {
    const cache = await caches.open(CACHE_NAME);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(4, OPTIONAL_BUILD_ASSETS.length) }, async () => {
      while (cursor < OPTIONAL_BUILD_ASSETS.length) {
        const asset = OPTIONAL_BUILD_ASSETS[cursor++];
        if (await cache.match(asset)) continue;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 8000);
        try {
          const response = await fetch(asset, { cache: 'reload', signal: controller.signal });
          if (response.ok) await cache.put(asset, response);
        } catch { /* Retried when the app next comes online. */ }
        finally { clearTimeout(timeout); }
      }
    });
    await Promise.all(workers);
  })().finally(() => { optionalWarmPromise = null; });
  return optionalWarmPromise;
}

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      // Keep the immediately previous shell. An already-open client can still
      // request one of its lazy chunks after a deployment; deleting that cache
      // made Downloads/MediaPlayer crash whenever the network was unavailable.
      const oldShells = keys.filter(key => key.startsWith('komod-shell-') && key !== CACHE_NAME);
      const previousShell = oldShells[oldShells.length - 1];
      const keep = new Set([CACHE_NAME, previousShell, COVER_CACHE].filter(Boolean));
      return Promise.all(keys.filter(key =>
        ((key.startsWith('komod-shell-') || key.startsWith('komod-covers-')) && !keep.has(key))
      ).map(key => caches.delete(key)));
    })
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'WARM_OFFLINE') event.waitUntil(warmOptionalAssets());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  if (request.method === 'POST' && requestUrl.origin === self.location.origin && requestUrl.pathname === '/share-target') {
    event.respondWith((async () => {
      const form = await request.formData();
      const params = new URLSearchParams({
        'share-target': '1',
        title: String(form.get('title') || ''),
        text: String(form.get('text') || ''),
        url: String(form.get('url') || ''),
      });
      return Response.redirect(`/?${params.toString()}`, 303);
    })());
    return;
  }
  if (request.method !== 'GET') return;

  const url = requestUrl;
  if (url.origin !== self.location.origin) return;

  // Cache only small thumbnails. Full image/media streams can be very large and
  // belong to the explicit offline-download store instead of the shell cache.
  const isCoverRequest = request.destination === 'image' && /^\/api\/stream\/\d+\/thumbnail$/.test(url.pathname);
  if (isCoverRequest) {
    event.respondWith(
      caches.open(COVER_CACHE).then(async cache => {
        // Access tokens rotate. Cache by resource/workspace instead of the token,
        // otherwise every refresh produces a different cache key.
        const cacheUrl = new URL(request.url);
        cacheUrl.searchParams.delete('token');
        const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
        const cached = await cache.match(cacheKey);
        const network = fetch(request).then(async response => {
          if (response.ok) {
            await cache.put(cacheKey, response.clone());
            await trimCache(COVER_CACHE, MAX_COVER_ENTRIES);
          }
          return response;
        }).catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedShell = (await cache.match('/index.html')) || (await cache.match('/'));
      // A cached HTML shell must stay paired with the exact hashed assets that
      // were installed with it. Updating HTML inside an old cache can produce a
      // blank page if connectivity drops between deployment requests.
      if (cachedShell) return cachedShell;
      const oldShells = (await caches.keys()).filter(key => key.startsWith('komod-shell-') && key !== CACHE_NAME);
      const previousShell = oldShells[oldShells.length - 1];
      if (previousShell) {
        const previousCache = await caches.open(previousShell);
        const previous = (await previousCache.match('/index.html')) || (await previousCache.match('/'));
        if (previous) return previous;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      try {
        return await fetch(request, { cache: 'no-store', signal: controller.signal });
      } catch {
        return (await caches.match('/offline.html')) || new Response(`<!doctype html><html lang="fa" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="theme-color" content="#7c3aed"><title>کمد آفلاین است</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#070b16;color:#f8fafc;font-family:system-ui;padding:24px;box-sizing:border-box}.c{max-width:360px;text-align:center;border:1px solid #ffffff18;background:#111827;padding:28px;border-radius:24px}button{border:0;border-radius:14px;padding:12px 18px;background:#7c3aed;color:white;font:inherit}</style><div class="c"><h1>کمد آفلاین است</h1><p>پوستهٔ آفلاین هنوز روی این دستگاه آماده نشده. پس از اولین بازشدن کامل با اینترنت، بدون اینترنت هم در دسترس خواهد بود.</p><button onclick="location.reload()">تلاش دوباره</button></div></html>`, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
      } finally {
        clearTimeout(timeout);
      }
    })());
    return;
  }

  const isStaticAsset = ['style', 'script', 'image', 'font'].includes(request.destination)
    || url.pathname === '/manifest.webmanifest';
  if (!isStaticAsset) return;

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached && url.pathname.startsWith('/assets/')) return cached;
      const network = fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
