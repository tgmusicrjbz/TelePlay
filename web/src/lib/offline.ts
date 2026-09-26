import { TelegramFile } from './api';

const DB_NAME = 'komod-offline';
const DB_VERSION = 1;
const STORE = 'media';
export const OFFLINE_CHANGED_EVENT = 'komod-offline-changed';

export interface OfflineMedia {
    id: number;
    file: TelegramFile;
    blob: Blob;
    savedAt: string;
}

function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('باز کردن حافظه آفلاین انجام نشد'));
    });
}

async function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDatabase();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = action(tx.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('عملیات حافظه آفلاین انجام نشد'));
        tx.oncomplete = () => db.close();
        tx.onerror = () => reject(tx.error || new Error('عملیات حافظه آفلاین انجام نشد'));
    });
}

export const listOfflineMedia = () => transaction<OfflineMedia[]>('readonly', store => store.getAll());
export const getOfflineMedia = (id: number) => transaction<OfflineMedia | undefined>('readonly', store => store.get(id));

export async function saveFileOffline(file: TelegramFile): Promise<void> {
    if (!navigator.onLine) throw new Error('برای ذخیره اولیه باید آنلاین باشی.');
    const token = localStorage.getItem('access_token') || '';
    const source = `${file.stream_url}${file.stream_url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
    const response = await fetch(source);
    if (!response.ok) throw new Error('دریافت فایل انجام نشد.');
    const blob = await response.blob();
    if (!blob.size) throw new Error('فایل خالی دریافت شد.');
    await transaction<IDBValidKey>('readwrite', store => store.put({ id: file.id, file, blob, savedAt: new Date().toISOString() } satisfies OfflineMedia));
    window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT));
}

export async function removeOfflineMedia(id: number): Promise<void> {
    await transaction<undefined>('readwrite', store => store.delete(id) as IDBRequest<undefined>);
    window.dispatchEvent(new Event(OFFLINE_CHANGED_EVENT));
}

export async function offlinePlaybackFile(record: OfflineMedia): Promise<TelegramFile> {
    return { ...record.file, stream_url: URL.createObjectURL(record.blob) };
}
