import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';

const vite = await createServer({
    appType: 'custom',
    logLevel: 'error',
    server: { middlewareMode: true },
});

try {
    const indexSource = await readFile(path.resolve(process.cwd(), 'index.html'), 'utf8');
    const contextMenuSource = await readFile(path.resolve(process.cwd(), 'src/components/GlobalContextMenu.tsx'), 'utf8');
    assert.equal(indexSource.includes('data-komod-boot'), false, 'the application shell must not block first paint with a boot splash');
    assert.equal(indexSource.includes('در حال باز کردن کمد…'), false, 'the old cabinet boot message must not be rendered before React');
    const downloadActionIndex = contextMenuSource.indexOf('<ActionTile icon={<Download/>} label="دانلود"');
    const moreActionsIndex = contextMenuSource.indexOf("{showMore?'بستن گزینه‌های بیشتر':'گزینه‌های بیشتر'}");
    assert.ok(downloadActionIndex >= 0 && downloadActionIndex < moreActionsIndex, 'file download must stay in the immediately visible action group');

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

    console.log('Frontend regression checks passed: boot shell, file actions, queue boundaries, repeat and reordering.');
} finally {
    await vite.close();
}
