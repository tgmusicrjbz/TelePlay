import assert from 'node:assert/strict';
import { createServer } from 'vite';

const vite = await createServer({
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true },
});

try {
    const { moveQueueEntry, nextQueueIndex, previousQueueIndex } = await vite.ssrLoadModule('/src/lib/playerQueue.ts');

    assert.equal(nextQueueIndex(3, 0, 'off'), 1, 'next advances inside the queue');
    assert.equal(nextQueueIndex(3, 2, 'off'), null, 'next stops at the end when repeat is off');
    assert.equal(nextQueueIndex(3, 2, 'all'), 0, 'next wraps only when queue repeat is enabled');
    assert.equal(previousQueueIndex(3, 0, 'off'), null, 'previous stops at the beginning when repeat is off');
    assert.equal(previousQueueIndex(3, 0, 'all'), 2, 'previous wraps only when queue repeat is enabled');

    const movedCurrent = moveQueueEntry(['a', 'b', 'c'], 1, 2, 1);
    assert.deepEqual(movedCurrent, { queue: ['a', 'c', 'b'], currentIndex: 2 }, 'moving the active item keeps it active');
    const movedAcrossCurrent = moveQueueEntry(['a', 'b', 'c', 'd'], 0, 3, 2);
    assert.deepEqual(movedAcrossCurrent, { queue: ['b', 'c', 'd', 'a'], currentIndex: 1 }, 'moving an earlier item adjusts the active index');
    assert.equal(moveQueueEntry(['a'], 0, 0, 0), null, 'no-op moves do not mutate the queue');

    console.log('Frontend regression checks passed: queue boundaries, repeat and reordering.');
} finally {
    await vite.close();
}
