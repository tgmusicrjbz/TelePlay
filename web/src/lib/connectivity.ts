import { useEffect, useState } from 'react';

export type ConnectivityState = 'online' | 'offline' | 'checking';

const EVENT_NAME = 'komod-connectivity-changed';
let state: ConnectivityState = navigator.onLine ? 'checking' : 'offline';
let lastCheckedAt = 0;
let pendingProbe: Promise<boolean> | null = null;

const forcedOffline = () => localStorage.getItem('komod-force-offline') === '1';

const serverOrigin = () => {
    const configured = String(localStorage.getItem('komod-server-origin') || '').trim().replace(/\/+$/, '');
    if (!configured) return window.location.origin;
    try {
        const url = new URL(configured);
        if (url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) return url.origin;
    } catch { /* Fall back to the current host. */ }
    return window.location.origin;
};

const publish = (next: ConnectivityState) => {
    if (state === next) return;
    state = next;
    window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: next }));
};

export const connectivityState = () => forcedOffline() || !navigator.onLine ? 'offline' : state;
export const isEffectivelyOnline = () => connectivityState() !== 'offline';

export const markServerReachable = () => {
    lastCheckedAt = Date.now();
    if (!forcedOffline() && navigator.onLine) publish('online');
};

export const markServerUnreachable = () => {
    lastCheckedAt = Date.now();
    publish('offline');
};

export async function checkServerReachability(options: { force?: boolean; timeout?: number } = {}): Promise<boolean> {
    if (forcedOffline() || !navigator.onLine) {
        publish('offline');
        return false;
    }
    if (!options.force && Date.now() - lastCheckedAt < 10_000 && state !== 'checking') return state === 'online';
    if (pendingProbe) return pendingProbe;
    publish('checking');
    pendingProbe = (async () => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), options.timeout ?? 2800);
        try {
            const response = await fetch(`${serverOrigin()}/health`, { cache: 'no-store', signal: controller.signal });
            if (!response.ok) throw new Error(`Health check failed with ${response.status}`);
            markServerReachable();
            return true;
        } catch {
            markServerUnreachable();
            return false;
        } finally {
            window.clearTimeout(timer);
            pendingProbe = null;
        }
    })();
    return pendingProbe;
}

export function useConnectivity() {
    const [current, setCurrent] = useState<ConnectivityState>(() => connectivityState());
    useEffect(() => {
        const changed = (event: Event) => setCurrent((event as CustomEvent<ConnectivityState>).detail || connectivityState());
        const modeChanged = () => {
            if (forcedOffline()) { publish('offline'); setCurrent('offline'); }
            else void checkServerReachability({ force: true });
        };
        const browserOnline = () => { setCurrent('checking'); void checkServerReachability({ force: true }); };
        const browserOffline = () => { markServerUnreachable(); setCurrent('offline'); };
        window.addEventListener(EVENT_NAME, changed);
        window.addEventListener('komod-connectivity-mode', modeChanged);
        window.addEventListener('online', browserOnline);
        window.addEventListener('offline', browserOffline);
        const onVisible = () => { if (document.visibilityState === 'visible') void checkServerReachability({ force: state === 'offline' }); };
        document.addEventListener('visibilitychange', onVisible);
        const timer = window.setInterval(() => { if (state === 'offline' && navigator.onLine && !forcedOffline()) void checkServerReachability({ force: true }); }, 20_000);
        void checkServerReachability();
        return () => {
            window.removeEventListener(EVENT_NAME, changed);
            window.removeEventListener('komod-connectivity-mode', modeChanged);
            window.removeEventListener('online', browserOnline);
            window.removeEventListener('offline', browserOffline);
            document.removeEventListener('visibilitychange', onVisible);
            window.clearInterval(timer);
        };
    }, []);
    return current;
}
