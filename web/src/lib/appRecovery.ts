const SHELL_CACHE_PREFIX = 'komod-shell-';
const LAZY_RETRY_PREFIX = 'komod-lazy-retry:';

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
    await clearBrokenAppShell();
    const target = new URL(path || `${window.location.pathname}${window.location.search}`, window.location.origin);
    target.searchParams.set('recover', String(Date.now()));
    window.location.replace(target.toString());
}
