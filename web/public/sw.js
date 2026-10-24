const CACHE_NAME = 'komod-shell-v18';
const COVER_CACHE = 'komod-covers-v3';
const CORE_ASSETS = ['/', '/index.html', '/offline.html', '/manifest.webmanifest', '/komod.svg'];
// Replaced with every emitted JS/CSS chunk by the Vite build plugin. Keeping
// this list in the service worker makes installation atomic: a new worker is
// activated only after the complete application shell is available offline.
const BUILD_ASSETS = /*__KOMOD_BUILD_ASSETS__*/ [];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      const response = await fetch('/index.html', { cache: 'no-store' });
      if (!response.ok) throw new Error('Unable to cache the application shell');
      const html = await response.clone().text();
      const assetPaths = [...html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)].map(match => match[1]);
      const requiredAssets = [...new Set([...BUILD_ASSETS, ...assetPaths])];
      // addAll intentionally rejects the installation if even one required
      // chunk is missing. The previous working worker/cache then stays active.
      await cache.addAll(requiredAssets);
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

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => (key.startsWith('komod-shell-') && key !== CACHE_NAME) || (key.startsWith('komod-covers-') && key !== COVER_CACHE)).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
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

  const isCoverRequest = request.destination === 'image' && url.pathname.startsWith('/api/stream/');
  if (isCoverRequest) {
    event.respondWith(
      caches.open(COVER_CACHE).then(async cache => {
        // Access tokens rotate. Cache by resource/workspace instead of the token,
        // otherwise every refresh produces a different cache key.
        const cacheUrl = new URL(request.url);
        cacheUrl.searchParams.delete('token');
        const cacheKey = new Request(cacheUrl.toString(), { method: 'GET' });
        const cached = await cache.match(cacheKey);
        const network = fetch(request).then(response => {
          if (response.ok) cache.put(cacheKey, response.clone());
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
      if (cachedShell) {
        const refreshShell = fetch('/index.html', { cache: 'no-store' })
          .then(response => {
            if (!response.ok) return;
            return Promise.all([cache.put('/index.html', response.clone()), cache.put('/', response.clone())]);
          })
          .catch(() => undefined);
        event.waitUntil(refreshShell);
        return cachedShell;
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
      const network = fetch(request).then(response => {
        if (response.ok) caches.open(CACHE_NAME).then(cache => cache.put(request, response.clone()));
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
