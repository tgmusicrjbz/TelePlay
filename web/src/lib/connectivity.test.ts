import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('connectivity probes', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
        vi.resetModules();
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    });

    it('honors forced offline mode without issuing a request', async () => {
        localStorage.setItem('komod-force-offline', '1');
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        const connectivity = await import('./connectivity');
        expect(connectivity.connectivityState()).toBe('offline');
        expect(await connectivity.checkServerReachability({ force: true })).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('marks the server online only after a successful health response', async () => {
        const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const connectivity = await import('./connectivity');
        expect(await connectivity.checkServerReachability({ force: true, timeout: 100 })).toBe(true);
        expect(connectivity.connectivityState()).toBe('online');
        expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/health`, expect.objectContaining({ cache: 'no-store' }));
    });

    it('rejects an insecure remote server origin', async () => {
        localStorage.setItem('komod-server-origin', 'http://unsafe.example');
        const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);
        const connectivity = await import('./connectivity');
        await connectivity.checkServerReachability({ force: true });
        expect(fetchMock).toHaveBeenCalledWith(`${window.location.origin}/health`, expect.any(Object));
    });
});
