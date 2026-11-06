// Register the offline shell before React or any lazy bundle starts. If a
// later script fails, the next launch is still controlled by the worker.
(() => {
  if (!('serviceWorker' in navigator) || location.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname)) return;
  navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .then(() => navigator.storage?.persist?.())
    .catch(() => undefined);
})();
// Loading Telegram synchronously can block the whole PWA while offline.
// Load it independently and notify React if it becomes available later.
(() => {
  let fontsRequested = false;
  const loadFonts = () => {
    if (fontsRequested || !navigator.onLine) return;
    fontsRequested = true;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700&family=Markazi+Text:wght@400;500;600;700&family=Merriweather:wght@400;700&family=Noto+Naskh+Arabic:wght@400;500;600;700&family=Noto+Sans+Arabic:wght@300;400;500;600;700&family=Vazirmatn:wght@300;400;500;600;700&display=swap';
    link.onerror = () => { fontsRequested = false; };
    document.head.appendChild(link);
  };
  const scheduleFonts = () => {
    if ('requestIdleCallback' in window) window.requestIdleCallback(loadFonts, { timeout: 5000 });
    else setTimeout(loadFonts, 1800);
  };
  window.addEventListener('komod-app-ready', scheduleFonts, { once: true });
  window.addEventListener('online', scheduleFonts);
})();
(() => {
  let requested = false;
  const loadTelegram = () => {
    if (requested || !navigator.onLine) return;
    requested = true;
    const script = document.createElement('script');
    script.src = 'https://telegram.org/js/telegram-web-app.js';
    script.async = true;
    script.onload = () => window.dispatchEvent(new Event('komod-telegram-ready'));
    script.onerror = () => { requested = false; };
    document.head.appendChild(script);
  };
  loadTelegram();
  window.addEventListener('online', loadTelegram);
})();
(() => {
  const recovery = document.getElementById('komod-recovery');
  let ready = false;
  let recovering = false;
  const autoRecoveryKey = 'komod-auto-boot-recovery';
  const showIfBlank = () => {
    const root = document.getElementById('root');
    if (!ready && (!root?.childElementCount || root.querySelector('[data-komod-boot]')) && recovery) recovery.style.display = 'flex';
  };
  const recoverApplication = async (automatic = false) => {
    if (recovering || ready) return;
    if (automatic) {
      if (!navigator.onLine || sessionStorage.getItem(autoRecoveryKey) === '1') return;
      sessionStorage.setItem(autoRecoveryKey, '1');
    }
    recovering = true;
    if (recovery) recovery.style.display = 'flex';
    recovery.disabled = true;
    recovery.innerHTML = '<span style="display:grid;width:28px;height:28px;place-items:center;border-radius:10px;background:rgb(168 85 247 / .16);color:rgb(216 180 254)">↻</span><span>در حال بازیابی…</span>';
    try {
      let reachable = false;
      if (navigator.onLine) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2200);
        try { reachable = (await fetch('/health', { cache: 'no-store', signal: controller.signal })).ok; }
        catch {}
        finally { clearTimeout(timer); }
      }
      if (reachable) {
        const tasks = [];
        if ('serviceWorker' in navigator) tasks.push(navigator.serviceWorker.getRegistrations().then(items => Promise.allSettled(items.map(item => item.unregister()))));
        if ('caches' in window) tasks.push(caches.keys().then(keys => Promise.allSettled(keys.filter(key => key.startsWith('komod-shell-')).map(key => caches.delete(key)))));
        await Promise.allSettled(tasks);
      } else if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready.catch(() => null);
        registration?.active?.postMessage({ type: 'WARM_OFFLINE' });
      }
    } catch {}
    const target = new URL('/', location.origin);
    target.searchParams.set('recover', String(Date.now()));
    location.replace(target.toString());
  };
  setTimeout(() => {
    showIfBlank();
    const root = document.getElementById('root');
    if (!ready && (!root?.childElementCount || root.querySelector('[data-komod-boot]'))) void recoverApplication(true);
  }, 5000);
  recovery?.addEventListener('click', () => void recoverApplication(false));
  window.addEventListener('komod-app-ready', () => {
    ready = true;
    sessionStorage.removeItem(autoRecoveryKey);
    if (recovery) recovery.style.display = 'none';
  });
})();
