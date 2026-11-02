const SHELL_CACHE_PREFIX = 'komod-shell-';
const LAZY_RETRY_PREFIX = 'komod-lazy-retry:';

async function originIsReachable(timeout = 2200): Promise<boolean> {
    if (!navigator.onLine) return false;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch('/health', { cache: 'no-store', signal: controller.signal });
        return response.ok;
    } catch {
        return false;
    } finally {
        window.clearTimeout(timer);
    }
}

export async function clearBrokenAppShell(): Promise<void> {
    Object.keys(sessionStorage)
        .filter(key => key.startsWith(LAZY_RETRY_PREFIX))
        .forEach(key => sessionStorage.removeItem(key));

    const tasks: Promise<unknown>[] = [];
    if ('serviceWorker' in navigator) {
        tasks.push(
            navigator.serviceWorker.getRegistrations().then(registrations =>
                Promise.allSettled(registrations.map(registration => registration.unregister())),
            ),
        );
    }
    if ('caches' in window) {
        tasks.push(
            caches.keys().then(keys =>
                Promise.allSettled(
                    keys
                        .filter(key => key.startsWith(SHELL_CACHE_PREFIX))
                        .map(key => caches.delete(key)),
                ),
            ),
        );
    }
    await Promise.allSettled(tasks);
}

export async function recoverApplication(path?: string): Promise<void> {
    // Keep the last known-good shell when the origin is blocked or the device
    // is offline. Deleting it here makes the next navigation fall through to
    // the browser's generic "You are offline" page.
    if (await originIsReachable()) {
        await clearBrokenAppShell();
    } else if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.ready.catch(() => null);
        registration?.active?.postMessage({ type: 'WARM_OFFLINE' });
    }
    const target = new URL(path || `${window.location.pathname}${window.location.search}`, window.location.origin);
    target.searchParams.set('recover', String(Date.now()));
    window.location.replace(target.toString());
}
