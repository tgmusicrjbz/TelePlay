import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ user: { id: 42 } as { id: number } | null, online: true }));
vi.mock('./accounts', () => ({ cachedCurrentUser: () => mocks.user }));
vi.mock('./connectivity', () => ({ isEffectivelyOnline: () => mocks.online }));

import { clearResolvedOfflineMutations, listOfflineMutations, queueOfflineMutation, shouldQueueOffline, syncOfflineMutations } from './offlineMutations';

describe('offline mutation queue', () => {
    beforeEach(() => {
        localStorage.clear();
        mocks.user = { id: 42 };
        mocks.online = true;
    });

    it('queues changes for the active account and notifies the UI', () => {
        const listener = vi.fn();
        window.addEventListener('komod-offline-mutations-changed', listener);
        const item = queueOfflineMutation({ entity: 'folder', method: 'post', url: '/folders', payload: { name: 'آفلاین' }, tempId: -1 });
        expect(item).toEqual(expect.objectContaining({ userId: 42, state: 'queued', tempId: -1 }));
        expect(listOfflineMutations()).toHaveLength(1);
        expect(listener).toHaveBeenCalledOnce();
        window.removeEventListener('komod-offline-mutations-changed', listener);
    });

    it('requires an active account and queues network failures', () => {
        mocks.user = null;
        expect(() => queueOfflineMutation({ entity: 'tag', method: 'post', url: '/tags' })).toThrow('حساب فعال پیدا نشد.');
        mocks.online = false;
        expect(shouldQueueOffline({ response: { status: 500 } })).toBe(true);
        mocks.online = true;
        expect(shouldQueueOffline({ response: { status: 500 } })).toBe(false);
        expect(shouldQueueOffline(new TypeError('network'))).toBe(true);
    });

    it('resolves temporary IDs in later URLs and nested payloads', async () => {
        queueOfflineMutation({ entity: 'folder', method: 'post', url: '/folders', payload: { name: 'کشو' }, tempId: -10 });
        queueOfflineMutation({ entity: 'playlist', method: 'patch', url: '/folders/-10/playlists/5', payload: { folder_id: -10, nested: [-10] } });
        const request = vi.fn()
            .mockResolvedValueOnce({ data: { id: 77 } })
            .mockResolvedValueOnce({ data: { ok: true } });
        await expect(syncOfflineMutations(request)).resolves.toEqual({ synced: 2, conflicts: 0, failed: 0 });
        expect(request).toHaveBeenNthCalledWith(2, { method: 'patch', url: '/folders/77/playlists/5', data: { folder_id: 77, nested: [77] } });
        expect(listOfflineMutations()).toEqual([]);
    });

    it('keeps a newer online version as an explicit conflict', async () => {
        const item = queueOfflineMutation({ entity: 'playlist', method: 'patch', url: '/playlists/2', payload: { name: 'محلی' }, baseUpdatedAt: '2020-01-01T00:00:00Z' });
        const stored = JSON.parse(localStorage.getItem('komod-offline-mutations-v1') || '[]');
        stored[0].createdAt = '2020-01-02T00:00:00Z';
        localStorage.setItem('komod-offline-mutations-v1', JSON.stringify(stored));
        const request = vi.fn().mockResolvedValue({ data: { updated_at: '2020-01-03T00:00:00Z' } });
        await expect(syncOfflineMutations(request)).resolves.toEqual({ synced: 0, conflicts: 1, failed: 0 });
        expect(listOfflineMutations()).toEqual([expect.objectContaining({ id: item.id, state: 'conflict' })]);
        clearResolvedOfflineMutations();
        expect(listOfflineMutations()).toEqual([]);
    });

    it('keeps queued work when the network disappears during synchronization', async () => {
        queueOfflineMutation({ entity: 'tag', method: 'post', url: '/tags', payload: { name: 'بعداً' } });
        const request = vi.fn().mockRejectedValue(new TypeError('network'));
        await expect(syncOfflineMutations(request)).resolves.toEqual({ synced: 0, conflicts: 0, failed: 0 });
        expect(listOfflineMutations()).toEqual([expect.objectContaining({ state: 'queued' })]);
    });
});
