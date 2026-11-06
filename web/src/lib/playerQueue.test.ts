import { describe, expect, it } from 'vitest';
import { moveQueueEntry, nextQueueIndex, previousQueueIndex } from './playerQueue';

describe('player queue', () => {
    it('respects repeat mode at queue boundaries', () => {
        expect(nextQueueIndex(3, 2, 'off')).toBeNull();
        expect(nextQueueIndex(3, 2, 'all')).toBe(0);
        expect(previousQueueIndex(3, 0, 'off')).toBeNull();
        expect(previousQueueIndex(3, 0, 'all')).toBe(2);
    });

    it('keeps the active item selected when the queue is reordered', () => {
        expect(moveQueueEntry(['a', 'b', 'c'], 1, 2, 1)).toEqual({ queue: ['a', 'c', 'b'], currentIndex: 2 });
        expect(moveQueueEntry(['a', 'b', 'c', 'd'], 0, 3, 2)).toEqual({ queue: ['b', 'c', 'd', 'a'], currentIndex: 1 });
    });
});
