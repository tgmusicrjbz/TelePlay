import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.cwd(), 'dist');
const worker = await readFile(path.join(root, 'sw.js'), 'utf8');
const parseAssetList = name => {
    const match = worker.match(new RegExp(`const ${name} = (\\[[^;]+\\]);`));
    if (!match) throw new Error(`${name} was not injected into the service worker.`);
    return JSON.parse(match[1]);
};

async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    return (await Promise.all(entries.map(async entry => {
        const target = path.join(directory, entry.name);
        return entry.isDirectory() ? walk(target) : [target];
    }))).flat();
}

if (worker.includes('__KOMOD_BUILD_ID__') || worker.includes('__KOMOD_CORE_BUILD_ASSETS__') || worker.includes('__KOMOD_OPTIONAL_BUILD_ASSETS__')) {
    throw new Error('Offline asset placeholder was not replaced.');
}
if (!worker.includes('previousShell') || !worker.includes("key.startsWith('komod-shell-')")) {
    throw new Error('Service worker does not retain the previous shell for open offline clients.');
}
if (!worker.includes('warmOptionalAssets') || !worker.includes('WARM_OFFLINE')) {
    throw new Error('Service worker does not retry warming optional offline screens.');
}
if (worker.includes("cache.put('/index.html', response.clone())") && worker.includes('refreshShell')) {
    throw new Error('Service worker mutates cached HTML outside an atomic shell installation.');
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
const coreAssets = parseAssetList('CORE_BUILD_ASSETS');
const optionalAssets = parseAssetList('OPTIONAL_BUILD_ASSETS');
const duplicateAssets = coreAssets.filter(file => optionalAssets.includes(file));
if (duplicateAssets.length) throw new Error(`Assets appear in both core and optional lists: ${duplicateAssets.join(', ')}`);
const unclassified = cacheable.filter(file => !coreAssets.includes(file) && !optionalAssets.includes(file));
if (unclassified.length) throw new Error(`Unclassified offline assets: ${unclassified.join(', ')}`);
const coreSizes = await Promise.all(coreAssets.map(file => stat(path.join(root, file.slice(1)))));
const coreBytes = coreSizes.reduce((sum, item) => sum + item.size, 0);
if (coreBytes > 1024 * 1024) throw new Error(`Mandatory boot shell is ${(coreBytes / 1024).toFixed(1)} KiB; limit is 1024 KiB.`);
const maximumBytes = 3 * 1024 * 1024;
if (totalBytes > maximumBytes) throw new Error(`Offline shell is ${(totalBytes / 1024 / 1024).toFixed(2)} MiB; limit is 3 MiB.`);
console.log(`Offline shell verified: ${coreAssets.length} mandatory assets (${(coreBytes / 1024).toFixed(1)} KiB), ${optionalAssets.length} background assets, ${(totalBytes / 1024 / 1024).toFixed(2)} MiB total.`);
