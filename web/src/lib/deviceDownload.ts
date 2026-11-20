import { api, TelegramFile } from './api';
import { publishLocalTransfer } from './transfers';

const TRACKED_DOWNLOAD_LIMIT = 192 * 1024 * 1024;
const activeDownloads = new Map<string, AbortController>();

function saveBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function nativeDownload(file: TelegramFile) {
    const token = localStorage.getItem('access_token') || '';
    const raw = file.stream_url || `/api/stream/${file.id}`;
    const isBlob = raw.startsWith('blob:');
    const url = new URL(raw, window.location.origin);
    if (!isBlob) {
        url.searchParams.set('download', '1');
        if (token) url.searchParams.set('token', token);
    }
    const anchor = document.createElement('a');
    anchor.href = url.toString();
    anchor.download = file.file_name;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}

export async function downloadFileToDevice(file: TelegramFile): Promise<'tracked'|'browser'> {
    const id = `device-download-${file.id}-${Date.now()}`;
    if (file.file_size > TRACKED_DOWNLOAD_LIMIT || file.stream_url.startsWith('blob:')) {
        publishLocalTransfer({id,kind:'download',title:file.file_name,state:'downloading',percent:0,detail:'در حال تحویل دانلود به مرورگر…'});
        nativeDownload(file);
        publishLocalTransfer({id,kind:'download',title:file.file_name,state:'done',percent:100,detail:'دانلود به مرورگر سپرده شد؛ پیشرفت را در دانلودهای دستگاه ببین.'});
        return 'browser';
    }

    const controller = new AbortController();
    activeDownloads.set(id, controller);
    publishLocalTransfer({id,kind:'download',title:file.file_name,state:'queued',percent:0,detail:'در حال شروع دانلود…'});
    try {
        const response = await api.get<Blob>(file.stream_url || `/stream/${file.id}`, {
            params: {download: 1},
            responseType: 'blob',
            signal: controller.signal,
            onDownloadProgress: event => {
                const total = event.total || file.file_size || 0;
                const percent = total > 0 ? Math.min(99, Math.round((event.loaded / total) * 100)) : 1;
                publishLocalTransfer({id,kind:'download',title:file.file_name,state:'downloading',percent,detail:total>0?`${percent.toLocaleString('fa-IR')}٪ دریافت شده`:'در حال دریافت فایل…'});
            },
        });
        saveBlob(response.data, file.file_name);
        publishLocalTransfer({id,kind:'download',title:file.file_name,state:'done',percent:100,detail:'دانلود کامل شد.'});
        return 'tracked';
    } catch (error: any) {
        const cancelled = error?.code === 'ERR_CANCELED' || controller.signal.aborted;
        publishLocalTransfer({id,kind:'download',title:file.file_name,state:cancelled?'cancelled':'error',percent:0,detail:cancelled?'دانلود لغو شد.':(error?.response?.data?.detail||'دانلود انجام نشد.')});
        throw error;
    } finally {
        activeDownloads.delete(id);
    }
}

export function cancelDeviceDownload(id: string) {
    activeDownloads.get(id)?.abort();
}

export function cancelAllDeviceDownloads() {
    activeDownloads.forEach(controller => controller.abort());
}
