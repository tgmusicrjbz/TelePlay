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

const measured = await Promise.all(entries.filter(name=>/\.(?:js|css)$/.test(name)).map(async name=>({name,size:(await stat(path.join(assetsDirectory,name))).size})));
const limits = {js:350*1024,css:180*1024};
const oversized = measured.filter(item=>item.size>limits[item.name.endsWith('.css')?'css':'js']);
if(oversized.length){
    throw new Error(`Oversized lazy/vendor assets:\n${oversized.map(item=>`${item.name}: ${(item.size/1024).toFixed(1)} KiB`).join('\n')}`);
}
const totalBytes=measured.reduce((sum,item)=>sum+item.size,0);
// KaTeX is kept local so Markdown formulas also render offline. The shell is
// still bounded below 1.6 MiB uncompressed and is checked separately after
// service-worker asset selection.
const totalLimit=1.6*1024*1024;
if(totalBytes>totalLimit)throw new Error(`Total JS/CSS bundle is ${(totalBytes/1024).toFixed(1)} KiB; limit is ${(totalLimit/1024).toFixed(0)} KiB.`);
console.log(`All ${measured.length} JS/CSS assets are within per-file limits; total ${(totalBytes/1024).toFixed(1)} KiB.`);
