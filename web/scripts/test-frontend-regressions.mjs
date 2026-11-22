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
    const bootSource = await readFile(path.resolve(process.cwd(), 'public/boot.js'), 'utf8');
    const workerSource = await readFile(path.resolve(process.cwd(), 'public/sw.js'), 'utf8');
    const contextMenuSource = await readFile(path.resolve(process.cwd(), 'src/components/GlobalContextMenu.tsx'), 'utf8');
    const browserSource = await readFile(path.resolve(process.cwd(), 'src/components/FileBrowser.tsx'), 'utf8');
    const sidebarSource = await readFile(path.resolve(process.cwd(), 'src/components/Sidebar.tsx'), 'utf8');
    const playlistSource = await readFile(path.resolve(process.cwd(), 'src/components/PlaylistBrowser.tsx'), 'utf8');
    const speechSource = await readFile(path.resolve(process.cwd(), 'src/components/TTSSettingsPanel.tsx'), 'utf8');
    const apiSource = await readFile(path.resolve(process.cwd(), 'src/lib/api.ts'), 'utf8');
    const mediaPlayerSource = await readFile(path.resolve(process.cwd(), 'src/components/MediaPlayer.tsx'), 'utf8');
    const stylesSource = await readFile(path.resolve(process.cwd(), 'src/index.css'), 'utf8');
    assert.equal(indexSource.includes('data-komod-boot'), false, 'the application shell must not block first paint with a boot splash');
    assert.equal(indexSource.includes('در حال باز کردن کمد…'), false, 'the old cabinet boot message must not be rendered before React');
    assert.equal(bootSource.includes('recoverApplication(true)'), false, 'slow startup must not automatically clear caches and reload');
    assert.equal(workerSource.includes('}).then(() => self.skipWaiting())'), false, 'an update must not activate and reload an active player without confirmation');
    const downloadActionIndex = contextMenuSource.indexOf('<ActionTile icon={<Download/>} label="دانلود"');
    const moreActionsIndex = contextMenuSource.indexOf("{showMore?'بستن گزینه‌های بیشتر':'گزینه‌های بیشتر'}");
    assert.ok(downloadActionIndex >= 0 && downloadActionIndex < moreActionsIndex, 'file download must stay in the immediately visible action group');
    assert.equal(contextMenuSource.includes('privateFileLink(file)'), false, 'device download must not call the removed privateFileLink helper');
    assert.equal(contextMenuSource.includes('downloadFileToDevice(file)'), true, 'device download must publish tracked progress');
    assert.equal(browserSource.includes('startQueue(index >= 0 ? queue : [file], index >= 0 ? index : 0)'), true, 'opening a recent file outside the current folder must play that file');
    assert.equal(sidebarSource.includes("url.searchParams.set('settings','tts')"), true, 'speech navigation must persist its destination in the URL');
    assert.equal(sidebarSource.includes('komod-bottom-dock'), true, 'mobile navigation must use the floating bottom dock');
    assert.equal(stylesSource.includes('.komod-dock-item.is-active'), true, 'the active bottom navigation destination must have a distinct visual state');
    assert.equal(stylesSource.includes('(orientation: landscape) and (max-height: 500px)'), true, 'the bottom dock must compact itself on short landscape screens');
    assert.equal(browserSource.includes("setViewMode('compact')"), true, 'the cabinet must offer the extra-small card view');
    assert.equal(playlistSource.includes('جست‌وجو در این پلی‌لیست…'), true, 'playlist details must include track search');
    assert.equal(playlistSource.includes('reorderedVisible'), true, 'filtered playlist reordering must preserve hidden track positions');
    assert.equal(speechSource.includes("window.confirm('همه موارد پایان‌یافته"), false, 'clearing speech history must not open a browser confirmation popup');
    assert.equal(apiSource.includes("queryClient.setQueryData<TTSJobStatus[]>(['tts-jobs'],items=>items?.filter"), true, 'TTS history deletion must update the UI optimistically');
    assert.equal(speechSource.includes("localStorage.getItem('komod-stt-picker-view')"), true, 'the STT cabinet picker must persist its selected view');
    assert.equal(speechSource.includes('نتایج جست‌وجو در همه کمد'), true, 'the STT picker must distinguish global search from folder browsing');
    assert.ok(speechSource.indexOf("label:'تنظیمات'") < speechSource.indexOf("sttPanel==='settings'&&<ModelUsageCard"), 'the STT model card must render below the panel tabs');
    assert.equal(mediaPlayerSource.includes('data-player-audio-actions'), true, 'audio controls must expose the landscape-only secondary action row');
    assert.equal(stylesSource.includes('@media (orientation: landscape) and (max-height: 620px)'), true, 'short landscape players must use the compact control layout');
    assert.equal(stylesSource.includes('[data-player-audio-actions] {\n    display: none;'), true, 'duplicated audio actions must be hidden in short landscape mode');

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

    console.log('Frontend regression checks passed: boot shell, file actions, compact cabinet and landscape player, speech history, playlist search, queue boundaries, repeat and reordering.');
} finally {
    await vite.close();
}
