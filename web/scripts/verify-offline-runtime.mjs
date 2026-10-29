import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';

const origin = 'https://komod.test';
const dist = path.resolve(process.cwd(), 'dist');
const source = await readFile(path.join(dist, 'sw.js'), 'utf8');
const listeners = new Map();
let networkOnline = true;

const requestUrl = input => new URL(typeof input === 'string' ? input : input.url, origin).toString();
class ServiceWorkerRequest extends Request {
    constructor(input, init) {
        super(requestUrl(input), init);
    }
}

class MemoryCache {
    records = new Map();
    async match(input) {
        const response = this.records.get(requestUrl(input));
        return response?.clone();
    }
    async put(input, response) {
        this.records.set(requestUrl(input), response.clone());
    }
    async add(input) {
        const response = await mockFetch(input);
        if (!response.ok) throw new Error(`Unable to cache ${requestUrl(input)}`);
        await this.put(input, response);
    }
    async addAll(inputs) {
        const responses = await Promise.all(inputs.map(input => mockFetch(input)));
        if (responses.some(response => !response.ok)) throw new Error('Atomic cache fill failed');
        await Promise.all(inputs.map((input, index) => this.put(input, responses[index])));
    }
    async keys() {
        return [...this.records.keys()].map(url => new ServiceWorkerRequest(url));
    }
    async delete(input) {
        return this.records.delete(requestUrl(input));
    }
}

const stores = new Map();
const cacheStorage = {
    async open(name) {
        if (!stores.has(name)) stores.set(name, new MemoryCache());
        return stores.get(name);
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async match(input) {
        for (const cache of stores.values()) {
            const response = await cache.match(input);
            if (response) return response;
        }
    },
};

async function mockFetch(input) {
    if (!networkOnline) throw new TypeError('Network unavailable');
    const url = new URL(requestUrl(input));
    const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    try {
        const body = await readFile(path.join(dist, relative));
        const type = relative.endsWith('.html') ? 'text/html; charset=utf-8'
            : relative.endsWith('.js') ? 'text/javascript; charset=utf-8'
                : relative.endsWith('.css') ? 'text/css; charset=utf-8'
                    : 'application/octet-stream';
        return new Response(body, { status: 200, headers: { 'Content-Type': type } });
    } catch {
        return new Response('missing', { status: 404 });
    }
}

const context = vm.createContext({
    AbortController,
    Request: ServiceWorkerRequest,
    Response,
    URL,
    URLSearchParams,
    caches: cacheStorage,
    clearTimeout,
    console,
    fetch: mockFetch,
    setTimeout,
    self: {
        location: new URL(origin),
        clients: { claim: async () => undefined },
        skipWaiting: async () => undefined,
        addEventListener(type, listener) { listeners.set(type, listener); },
    },
});
vm.runInContext(source, context, { filename: 'dist/sw.js' });

const runExtendableEvent = async (type, extra = {}) => {
    let pending;
    listeners.get(type)?.({ ...extra, waitUntil(value) { pending = Promise.resolve(value); } });
    if (pending) await pending;
};

await runExtendableEvent('install');
await runExtendableEvent('activate');
const shellNames = (await cacheStorage.keys()).filter(name => name.startsWith('komod-shell-'));
if (shellNames.length !== 1 || shellNames[0].includes('__KOMOD')) throw new Error('A versioned shell cache was not installed.');

networkOnline = false;
let navigationResponse;
listeners.get('fetch')?.({
    request: { method: 'GET', mode: 'navigate', destination: 'document', url: `${origin}/downloads` },
    respondWith(value) { navigationResponse = Promise.resolve(value); },
    waitUntil() {},
});
const navigation = await navigationResponse;
if (!navigation?.ok || !(await navigation.text()).includes('کمد | درایو ابری تلگرام')) {
    throw new Error('Offline navigation did not return the installed application shell.');
}

const coreMatch = source.match(/const CORE_BUILD_ASSETS = (\[[^;]+\]);/);
const coreAssets = coreMatch ? JSON.parse(coreMatch[1]) : [];
for (const asset of coreAssets) {
    let assetResponse;
    listeners.get('fetch')?.({
        request: { method: 'GET', mode: 'cors', destination: asset.endsWith('.css') ? 'style' : 'script', url: `${origin}${asset}` },
        respondWith(value) { assetResponse = Promise.resolve(value); },
        waitUntil() {},
    });
    const response = await assetResponse;
    if (!response?.ok) throw new Error(`Core asset is unavailable offline: ${asset}`);
}

await runExtendableEvent('message', { data: { type: 'WARM_OFFLINE' } });
console.log(`Offline runtime verified: navigation and ${coreAssets.length} mandatory assets work with the network unavailable.`);
