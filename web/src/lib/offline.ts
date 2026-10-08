import { api, Playlist, TelegramFile } from './api';

const DB_NAME = 'komod-offline';
const DB_VERSION = 4;
const MEDIA_STORE = 'media';
const PLAYLIST_STORE = 'playlists';
const TEXT_STORE = 'texts';
const TEXT_OUTBOX_STORE = 'text-outbox';
const FOLDER_STORE = 'download-folders';
export const OFFLINE_CHANGED_EVENT = 'komod-offline-changed';
export const OFFLINE_PROGRESS_EVENT = 'komod-offline-progress';

export interface OfflineMedia { id: number; file: TelegramFile; blob: Blob; savedAt: string; folderId?: string | null; }
export interface OfflinePlaylist { id: number; name: string; description?: string | null; fileIds: number[]; totalCount: number; failedCount?: number; savedAt: string; folderId?: string | null; }
export interface OfflineText { id: number; file: TelegramFile; content: string; savedAt: string; folderId?: string | null; }
export interface OfflineFolder { id: string; name: string; createdAt: string; }
export interface OfflineTextDraft { id: number; name: string; content: string; folderId: number | null; createdAt: string; }
export interface OfflineDownloadProgress { done: number; total: number; failed: number; currentName: string; loaded: number; size: number; }
export interface OfflineJobProgress extends OfflineDownloadProgress { id: string; kind: 'file' | 'playlist'; title: string; state: 'queued' | 'downloading' | 'paused' | 'cancelled' | 'done' | 'error'; }
let textOutboxSyncing = false;
type OfflineQueueJob = { file: TelegramFile; onProgress?: (loaded:number,total:number)=>void; options?: {silentProgress?:boolean}; resolve:()=>void; reject:(error:unknown)=>void };
const offlineQueue: OfflineQueueJob[] = [];
const offlinePromises = new Map<number, Promise<void>>();
const activeControllers = new Map<number, AbortController>();
const playlistControls = new Map<string, { paused: boolean; cancelled: boolean }>();
let activeOfflineJobs = 0;

function emitProgress(progress: OfflineJobProgress) {
    window.dispatchEvent(new CustomEvent<OfflineJobProgress>(OFFLINE_PROGRESS_EVENT, { detail: progress }));
}

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(PLAYLIST_STORE)) db.createObjectStore(PLAYLIST_STORE, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(TEXT_STORE)) db.createObjectStore(TEXT_STORE, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(TEXT_OUTBOX_STORE)) db.createObjectStore(TEXT_OUTBOX_STORE, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(FOLDER_STORE)) db.createObjectStore(FOLDER_STORE, { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('باز کردن حافظه آفلاین انجام نشد'));
    });
}

async function transaction<T>(storeName: string, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const request = action(tx.objectStore(storeName));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('عملیات حافظه آفلاین انجام نشد'));
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error || new Error('عملیات حافظه آفلاین انجام نشد'));
    });
}

export const listOfflineMedia = () => transaction<OfflineMedia[]>(MEDIA_STORE, 'readonly', store => store.getAll());
export const getOfflineMedia = (id: number) => transaction<OfflineMedia | undefined>(MEDIA_STORE, 'readonly', store => store.get(id));
export const listOfflinePlaylists = () => transaction<OfflinePlaylist[]>(PLAYLIST_STORE, 'readonly', store => store.getAll());
export const getOfflineText = (id: number) => transaction<OfflineText | undefined>(TEXT_STORE, 'readonly', store => store.get(id));
export const listOfflineTexts = () => transaction<OfflineText[]>(TEXT_STORE, 'readonly', store => store.getAll());
export const listOfflineTextDrafts = () => transaction<OfflineTextDraft[]>(TEXT_OUTBOX_STORE, 'readonly', store => store.getAll());
export const listOfflineFolders = () => transaction<OfflineFolder[]>(FOLDER_STORE, 'readonly', store => store.getAll());

export async function createOfflineFolder(name: string): Promise<OfflineFolder> {
    const cleanName = name.trim().slice(0, 80);
    if (!cleanName) throw new Error('نام پوشه را وارد کن.');
    const folder: OfflineFolder = { id: crypto.randomUUID(), name: cleanName, createdAt: new Date().toISOString() };
    await transaction<IDBValidKey>(FOLDER_STORE, 'readwrite', store => store.put(folder));
    window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT));
    return folder;
}

export async function assignOfflineFolder(kind: 'media'|'text'|'playlist', id: number, folderId: string | null): Promise<void> {
    const storeName = kind === 'media' ? MEDIA_STORE : kind === 'text' ? TEXT_STORE : PLAYLIST_STORE;
    const record = await transaction<any>(storeName, 'readonly', store => store.get(id));
    if (!record) throw new Error('مورد آفلاین پیدا نشد.');
    await transaction<IDBValidKey>(storeName, 'readwrite', store => store.put({ ...record, folderId }));
    window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT));
}

export async function removeOfflineFolder(id: string): Promise<void> {
    for (const storeName of [MEDIA_STORE, TEXT_STORE, PLAYLIST_STORE]) {
        const records = await transaction<any[]>(storeName, 'readonly', store => store.getAll());
        for (const record of records.filter(item => item.folderId === id)) {
            await transaction<IDBValidKey>(storeName, 'readwrite', store => store.put({ ...record, folderId: null }));
        }
    }
    await transaction<undefined>(FOLDER_STORE, 'readwrite', store => store.delete(id) as IDBRequest<undefined>);
    window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT));
}

async function performFileOffline(file: TelegramFile, onProgress?: (loaded: number, total: number) => void, options?: { silentProgress?: boolean }): Promise<void> {
    if (!navigator.onLine) throw new Error('برای ذخیره اولیه باید آنلاین باشی.');
    const jobId = `file-${file.id}`;
    if (!options?.silentProgress) emitProgress({ id: jobId, kind: 'file', title: file.file_name, state: 'downloading', done: 0, total: 1, failed: 0, currentName: file.file_name, loaded: 0, size: file.file_size });
    await navigator.storage?.persist?.();
    const controller = new AbortController();
    activeControllers.set(file.id, controller);
    try {
        if (await getOfflineMedia(file.id)) {
            onProgress?.(file.file_size, file.file_size);
            if (!options?.silentProgress) emitProgress({ id: jobId, kind: 'file', title: file.file_name, state: 'done', done: 1, total: 1, failed: 0, currentName: file.file_name, loaded: file.file_size, size: file.file_size });
            return;
        }
        const source = file.stream_url.replace(/^\/api/, '');
        const response = await api.get<Blob>(source, {
            responseType: 'blob',
            // Large Telegram-backed streams can take minutes on mobile data.
            timeout: 0,
            signal: controller.signal,
            onDownloadProgress: event => {
                const total = event.total || file.file_size || 0;
                onProgress?.(event.loaded, total);
                if (!options?.silentProgress) emitProgress({ id: jobId, kind: 'file', title: file.file_name, state: 'downloading', done: 0, total: 1, failed: 0, currentName: file.file_name, loaded: event.loaded, size: total });
            },
        });
        const blob = response.data;
        if (!blob.size) throw new Error('فایل خالی دریافت شد.');
        await transaction<IDBValidKey>(MEDIA_STORE, 'readwrite', store => store.put({ id: file.id, file, blob, savedAt: new Date().toISOString() } satisfies OfflineMedia));
        window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT));
        if (!options?.silentProgress) emitProgress({ id: jobId, kind: 'file', title: file.file_name, state: 'done', done: 1, total: 1, failed: 0, currentName: file.file_name, loaded: blob.size, size: blob.size });
    } catch (error) {
        const cancelled = controller.signal.aborted;
        if (!options?.silentProgress) emitProgress({ id: jobId, kind: 'file', title: file.file_name, state: cancelled ? 'cancelled' : 'error', done: 0, total: 1, failed: cancelled ? 0 : 1, currentName: file.file_name, loaded: 0, size: file.file_size });
        throw error;
    } finally { activeControllers.delete(file.id); }
}

export function cancelOfflineJob(jobId: string): void {
    if (jobId.startsWith('playlist-')) {
        const control = playlistControls.get(jobId); if (control) control.cancelled = true;
        return;
    }
    const fileId = Number(jobId.replace('file-', ''));
    const queuedIndex = offlineQueue.findIndex(job => job.file.id === fileId);
    if (queuedIndex >= 0) {
        const [job] = offlineQueue.splice(queuedIndex, 1);
        offlinePromises.delete(fileId);
        job.reject(new DOMException('دانلود لغو شد', 'AbortError'));
        emitProgress({id:jobId,kind:'file',title:job.file.file_name,state:'cancelled',done:0,total:1,failed:0,currentName:job.file.file_name,loaded:0,size:job.file.file_size});
    } else activeControllers.get(fileId)?.abort();
}

export function toggleOfflineJobPause(jobId: string): void {
    const control = playlistControls.get(jobId);
    if (control) control.paused = !control.paused;
}

function pumpOfflineQueue() {
    // Keep one transfer active at a time. Telegram-backed streams are long lived
    // and parallel requests make both the UI and constrained Railway instances
    // less responsive. Users can still enqueue as many files as they want.
    while (activeOfflineJobs < 1 && offlineQueue.length) {
        const job = offlineQueue.shift()!;
        activeOfflineJobs += 1;
        void performFileOffline(job.file, job.onProgress, job.options).then(job.resolve, job.reject).finally(() => {
            activeOfflineJobs -= 1;
            offlinePromises.delete(job.file.id);
            pumpOfflineQueue();
        });
    }
}

/** Queue downloads globally; requests are processed one at a time. */
export function saveFileOffline(file: TelegramFile, onProgress?: (loaded: number, total: number) => void, options?: { silentProgress?: boolean }): Promise<void> {
    const existing = offlinePromises.get(file.id);
    if (existing) return existing;
    const promise = new Promise<void>((resolve, reject) => {
        offlineQueue.push({ file, onProgress, options, resolve, reject });
        if (!options?.silentProgress) emitProgress({ id: `file-${file.id}`, kind: 'file', title: file.file_name, state: 'queued', done: 0, total: 1, failed: 0, currentName: 'در صف ذخیره‌سازی', loaded: 0, size: file.file_size });
        pumpOfflineQueue();
    });
    offlinePromises.set(file.id, promise);
    return promise;
}

export async function savePlaylistOffline(playlist: Playlist, onProgress?: (progress: OfflineDownloadProgress) => void): Promise<OfflinePlaylist> {
    const playable = playlist.items.map(item => item.file).filter(file => file.file_type === 'audio' || file.file_type === 'video');
    if (!playable.length) throw new Error('این پلی‌لیست فایل صوتی یا ویدیویی قابل دانلود ندارد.');
    const jobId = `playlist-${playlist.id}`;
    const control = { paused: false, cancelled: false };
    playlistControls.set(jobId, control);
    const totalSize = playable.reduce((sum, file) => sum + (file.file_size || 0), 0);
    const loadedByFile = new Map<number, number>();
    let cursor = 0; let done = 0; let failed = 0; const savedIds: number[] = [];
    const report = (currentName: string) => {
        const progress = { done, total: playable.length, failed, currentName, loaded: [...loadedByFile.values()].reduce((sum, value) => sum + value, 0), size: totalSize };
        onProgress?.(progress);
        emitProgress({ id: jobId, kind: 'playlist', title: playlist.name, state: 'downloading', ...progress });
    };
    report('در حال آماده‌سازی…');
    const worker = async () => {
        while (cursor < playable.length) {
            while (control.paused && !control.cancelled) {
                emitProgress({ id: jobId, kind: 'playlist', title: playlist.name, state: 'paused', done, total: playable.length, failed, currentName: 'دانلود موقتاً متوقف شده', loaded: [...loadedByFile.values()].reduce((sum, value) => sum + value, 0), size: totalSize });
                await new Promise(resolve => window.setTimeout(resolve, 250));
            }
            if (control.cancelled) break;
            const file = playable[cursor++];
            report(file.file_name);
            let saved = false;
            try {
                await saveFileOffline(file, loaded => { loadedByFile.set(file.id, loaded); report(file.file_name); }, { silentProgress: true });
                savedIds.push(file.id);
                saved = true;
            } catch { failed += 1; }
            done += 1;
            if (saved) loadedByFile.set(file.id, file.file_size || loadedByFile.get(file.id) || 0);
            report(file.file_name);
        }
    };
    await worker();
    if (control.cancelled) {
        playlistControls.delete(jobId);
        emitProgress({ id: jobId, kind: 'playlist', title: playlist.name, state: 'cancelled', done, total: playable.length, failed, currentName: '', loaded: [...loadedByFile.values()].reduce((sum, value) => sum + value, 0), size: totalSize });
        throw new DOMException('دانلود پلی‌لیست لغو شد', 'AbortError');
    }
    if (!savedIds.length) {
        emitProgress({ id: jobId, kind: 'playlist', title: playlist.name, state: 'error', done, total: playable.length, failed, currentName: '', loaded: 0, size: totalSize });
        throw new Error('هیچ‌کدام از فایل‌های پلی‌لیست دانلود نشدند؛ اتصال ربات به کانال ذخیره‌سازی را بررسی کن.');
    }
    const previous = (await listOfflinePlaylists()).find(item => item.id === playlist.id);
    const record: OfflinePlaylist = { id: playlist.id, name: playlist.name, description: playlist.description, fileIds: savedIds, totalCount: playable.length, failedCount: failed, savedAt: new Date().toISOString(), folderId: previous?.folderId || null };
    await transaction<IDBValidKey>(PLAYLIST_STORE, 'readwrite', store => store.put(record));
    window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT));
    emitProgress({ id: jobId, kind: 'playlist', title: playlist.name, state: 'done', done, total: playable.length, failed, currentName: '', loaded: [...loadedByFile.values()].reduce((sum, value) => sum + value, 0), size: totalSize });
    playlistControls.delete(jobId);
    return record;
}

export async function offlinePlaylistFiles(playlist: OfflinePlaylist): Promise<TelegramFile[]> {
    const records = await Promise.all(playlist.fileIds.map(getOfflineMedia));
    return Promise.all(records.filter((item): item is OfflineMedia => Boolean(item)).map(offlinePlaybackFile));
}

export async function removeOfflinePlaylist(id: number): Promise<void> {
    await transaction<undefined>(PLAYLIST_STORE, 'readwrite', store => store.delete(id) as IDBRequest<undefined>);
    window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT));
}

export async function removeOfflineMedia(id: number): Promise<void> {
    await transaction<undefined>(MEDIA_STORE, 'readwrite', store => store.delete(id) as IDBRequest<undefined>);
    window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT));
}

export async function removeOfflineText(id: number): Promise<void> {
    await transaction<undefined>(TEXT_STORE, 'readwrite', store => store.delete(id) as IDBRequest<undefined>);
    if (id < 0) await transaction<undefined>(TEXT_OUTBOX_STORE, 'readwrite', store => store.delete(id) as IDBRequest<undefined>);
    window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT));
}

export async function offlinePlaybackFile(record: OfflineMedia): Promise<TelegramFile> {
    return { ...record.file, stream_url: URL.createObjectURL(record.blob) };
}

export async function cacheTextFile(file: TelegramFile, content?: string): Promise<void> {
    const text = content ?? (await api.get<{ content: string }>(`/files/${file.id}/text`)).data.content;
    await transaction<IDBValidKey>(TEXT_STORE, 'readwrite', store => store.put({ id: file.id, file, content: text, savedAt: new Date().toISOString() } satisfies OfflineText));
}

export async function queueOfflineText(name: string, content: string, folderId: number | null): Promise<OfflineTextDraft> {
    const id = -Date.now();
    const createdAt = new Date().toISOString();
    const draft: OfflineTextDraft = { id, name, content, folderId, createdAt };
    const file: TelegramFile = {
        id, user_id: 0, folder_id: folderId, file_id: `offline-${Math.abs(id)}`, file_unique_id: `offline-${Math.abs(id)}`,
        file_name: name, description: 'در انتظار همگام‌سازی', file_size: new Blob([content]).size,
        mime_type: 'text/markdown', file_type: 'text', duration: null, width: null, height: null,
        created_at: createdAt, updated_at: createdAt, stream_url: '', thumbnail_url: null,
    };
    await transaction<IDBValidKey>(TEXT_OUTBOX_STORE, 'readwrite', store => store.put(draft));
    await transaction<IDBValidKey>(TEXT_STORE, 'readwrite', store => store.put({ id, file, content, savedAt: createdAt } satisfies OfflineText));
    window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT));
    return draft;
}

export async function updateOfflineTextDraft(id: number, content: string): Promise<void> {
    const draft = (await listOfflineTextDrafts()).find(item => item.id === id);
    const cached = await getOfflineText(id);
    if (!draft || !cached) throw new Error('یادداشت آفلاین پیدا نشد.');
    await transaction<IDBValidKey>(TEXT_OUTBOX_STORE, 'readwrite', store => store.put({ ...draft, content }));
    await transaction<IDBValidKey>(TEXT_STORE, 'readwrite', store => store.put({ ...cached, content, file: { ...cached.file, file_size: new Blob([content]).size, updated_at: new Date().toISOString() } } satisfies OfflineText));
    window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT));
}

export async function syncOfflineTextOutbox(): Promise<{ synced: number; failed: number }> {
    if (!navigator.onLine) return { synced: 0, failed: 0 };
    if (textOutboxSyncing) return { synced: 0, failed: 0 };
    textOutboxSyncing = true;
    try {
    const drafts = (await listOfflineTextDrafts()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    let synced = 0; let failed = 0;
    for (const draft of drafts) {
        try {
            const form = new FormData();
            form.append('upload', new File([draft.content], draft.name, { type: 'text/markdown;charset=utf-8' }), draft.name);
            if (draft.folderId !== null) form.append('folder_id', String(draft.folderId));
            const { data: file } = await api.post<TelegramFile>('/files/upload', form);
            await transaction<IDBValidKey>(TEXT_STORE, 'readwrite', store => store.put({ id: file.id, file, content: draft.content, savedAt: new Date().toISOString() } satisfies OfflineText));
            await transaction<undefined>(TEXT_STORE, 'readwrite', store => store.delete(draft.id) as IDBRequest<undefined>);
            await transaction<undefined>(TEXT_OUTBOX_STORE, 'readwrite', store => store.delete(draft.id) as IDBRequest<undefined>);
            synced += 1;
        } catch { failed += 1; }
    }
    if (synced) window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT));
    return { synced, failed };
    } finally { textOutboxSyncing = false; }
}

export async function cacheAllTextNotes(): Promise<void> {
    if (!navigator.onLine) return;
    let page = 1;
    while (page <= 20) {
        const { data } = await api.get<{ files: TelegramFile[]; total: number; per_page: number }>('/files', { params: { file_type: 'text', page, per_page: 100 } });
        await Promise.allSettled(data.files.map(file => cacheTextFile(file)));
        if (page * data.per_page >= data.total) break;
        page += 1;
    }
}
