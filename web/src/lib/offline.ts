import { api, Playlist, TelegramFile } from './api';

const DB_NAME = 'komod-offline';
const DB_VERSION = 2;
const MEDIA_STORE = 'media';
const PLAYLIST_STORE = 'playlists';
const TEXT_STORE = 'texts';
export const OFFLINE_CHANGED_EVENT = 'komod-offline-changed';

export interface OfflineMedia { id: number; file: TelegramFile; blob: Blob; savedAt: string; }
export interface OfflinePlaylist { id: number; name: string; description?: string | null; fileIds: number[]; totalCount: number; savedAt: string; }
export interface OfflineText { id: number; file: TelegramFile; content: string; savedAt: string; }

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(MEDIA_STORE)) db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(PLAYLIST_STORE)) db.createObjectStore(PLAYLIST_STORE, { keyPath: 'id' });
            if (!db.objectStoreNames.contains(TEXT_STORE)) db.createObjectStore(TEXT_STORE, { keyPath: 'id' });
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

export async function saveFileOffline(file: TelegramFile): Promise<void> {
    if (!navigator.onLine) throw new Error('برای ذخیره اولیه باید آنلاین باشی.');
    if (await getOfflineMedia(file.id)) return;
    const token = localStorage.getItem('access_token') || '';
    const source = `${file.stream_url}${file.stream_url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    const response = await fetch(source);
    if (!response.ok) throw new Error('دریافت فایل انجام نشد.');
    const blob = await response.blob();
    if (!blob.size) throw new Error('فایل خالی دریافت شد.');
    await transaction<IDBValidKey>(MEDIA_STORE, 'readwrite', store => store.put({ id: file.id, file, blob, savedAt: new Date().toISOString() } satisfies OfflineMedia));
    window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT));
}

export async function savePlaylistOffline(playlist: Playlist, onProgress?: (done: number, total: number) => void): Promise<OfflinePlaylist> {
    const playable = playlist.items.map(item => item.file).filter(file => file.file_type === 'audio' || file.file_type === 'video');
    let cursor = 0; let done = 0; const savedIds: number[] = [];
    const worker = async () => {
        while (cursor < playable.length) {
            const file = playable[cursor++];
            try { await saveFileOffline(file); savedIds.push(file.id); } catch { /* unavailable items are omitted */ }
            done += 1; onProgress?.(done, playable.length);
        }
    };
    await Promise.all(Array.from({ length: Math.min(2, playable.length) }, worker));
    const record: OfflinePlaylist = { id: playlist.id, name: playlist.name, description: playlist.description, fileIds: savedIds, totalCount: playable.length, savedAt: new Date().toISOString() };
    await transaction<IDBValidKey>(PLAYLIST_STORE, 'readwrite', store => store.put(record));
    window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT));
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

export async function offlinePlaybackFile(record: OfflineMedia): Promise<TelegramFile> {
    return { ...record.file, stream_url: URL.createObjectURL(record.blob) };
}

export async function cacheTextFile(file: TelegramFile, content?: string): Promise<void> {
    const text = content ?? (await api.get<{ content: string }>(`/files/${file.id}/text`)).data.content;
    await transaction<IDBValidKey>(TEXT_STORE, 'readwrite', store => store.put({ id: file.id, file, content: text, savedAt: new Date().toISOString() } satisfies OfflineText));
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
