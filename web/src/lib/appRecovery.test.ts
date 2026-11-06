import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRecoveryUrl, clearBrokenAppShell, originIsReachable } from './appRecovery';

describe('application recovery', () => {
    beforeEach(() => {
        sessionStorage.clear();
        vi.restoreAllMocks();
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
    });

    it('preserves the requested path and replaces an old recovery marker', () => {
        expect(buildRecoveryUrl('/downloads?tab=ready&recover=old', 1234)).toBe(`${window.location.origin}/downloads?tab=ready&recover=1234`);
    });

    it('does not probe the origin while the browser is offline', async () => {
        Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
        const fetchMock = vi.spyOn(globalThis, 'fetch');
        expect(await originIsReachable(10)).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('clears only Komod shell caches and lazy retry markers', async () => {
        sessionStorage.setItem('komod-lazy-retry:chunk', '1');
        sessionStorage.setItem('keep-me', '1');
        const unregister = vi.fn().mockResolvedValue(true);
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistrations: vi.fn().mockResolvedValue([{ unregister }]) } });
        const deleteCache = vi.fn().mockResolvedValue(true);
        Object.defineProperty(globalThis, 'caches', { configurable: true, value: { keys: vi.fn().mockResolvedValue(['komod-shell-old', 'other-cache']), delete: deleteCache } });
        await clearBrokenAppShell();
        expect(sessionStorage.getItem('komod-lazy-retry:chunk')).toBeNull();
        expect(sessionStorage.getItem('keep-me')).toBe('1');
        expect(unregister).toHaveBeenCalledOnce();
        expect(deleteCache).toHaveBeenCalledOnce();
        expect(deleteCache).toHaveBeenCalledWith('komod-shell-old');
    });
});
