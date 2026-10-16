const CACHE_NAME = 'komod-shell-v16';
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
      const requiredAssets = [...new Set([
        ...CORE_ASSETS.filter(asset => asset !== '/' && asset !== '/index.html'),
        ...BUILD_ASSETS,
        ...assetPaths,
      ])];
      // addAll intentionally rejects the installation if even one required
      // chunk is missing. The previous working worker/cache then stays active.
      await cache.addAll(requiredAssets);
      await Promise.all([
        cache.put('/index.html', response.clone()),
        cache.put('/', response.clone()),
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
    event.respondWith(
      fetch(request, { cache: 'no-store' })
        .catch(async () => (await caches.match('/index.html')) || (await caches.match('/offline.html')))
    );
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
