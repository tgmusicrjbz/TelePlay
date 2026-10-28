import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'dist');
const worker = await readFile(path.join(root, 'sw.js'), 'utf8');

async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map(async entry => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(target) : [target];
    }))).flat();
}

if (worker.includes('__KOMOD_BUILD_ASSETS__')) {
    throw new Error('Offline asset placeholder was not replaced.');
}

const cacheable = (await walk(path.join(root, 'assets')))
    .map(file => `/${path.relative(root, file).replace(/\\/g, '/')}`)
    .filter(file => /\.(?:js|css|woff2|png|jpe?g|webp|svg)$/i.test(file));
const missing = cacheable.filter(file => !worker.includes(JSON.stringify(file)));

if (missing.length) {
    throw new Error(`Service worker is missing ${missing.length} build asset(s):\n${missing.join('\n')}`);
}

const sizes = await Promise.all(cacheable.map(file => stat(path.join(root, file.slice(1)))));
const totalBytes = sizes.reduce((sum, item) => sum + item.size, 0);
const maximumBytes = 3 * 1024 * 1024;
if (totalBytes > maximumBytes) throw new Error(`Offline shell is ${(totalBytes / 1024 / 1024).toFixed(2)} MiB; limit is 3 MiB.`);
console.log(`Offline shell verified: ${cacheable.length} assets, ${(totalBytes / 1024 / 1024).toFixed(2)} MiB precached.`);
