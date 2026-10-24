import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const assetsDirectory = path.resolve('dist/assets');
const entries = await readdir(assetsDirectory);
const appChunks = entries.filter(name => /^index-[\w-]+\.js$/.test(name));

if (appChunks.length !== 1) {
    throw new Error(`Expected one application entry chunk, found ${appChunks.length}.`);
}

const entryPath = path.join(assetsDirectory, appChunks[0]);
const { size } = await stat(entryPath);
const maximumBytes = 450 * 1024;

if (size > maximumBytes) {
    throw new Error(`Application entry chunk is ${(size / 1024).toFixed(1)} KiB; limit is ${maximumBytes / 1024} KiB.`);
}

console.log(`Application entry chunk: ${(size / 1024).toFixed(1)} KiB (limit ${maximumBytes / 1024} KiB).`);
