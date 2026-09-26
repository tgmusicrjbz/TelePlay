import { useCallback, useEffect, useMemo, useState } from 'react';
import { Film, HardDriveDownload, Music, Play, Trash2 } from 'lucide-react';
import { formatFileSize, formatPersianDate } from '../lib/api';
import { listOfflineMedia, OfflineMedia, OFFLINE_CHANGED_EVENT, offlinePlaybackFile, removeOfflineMedia } from '../lib/offline';
import { useAppStore } from '../lib/store';

export default function DownloadsPage() {
    const [items, setItems] = useState<OfflineMedia[]>([]);
    const [loading, setLoading] = useState(true);
    const { setPreviewFile, addToast } = useAppStore();
    const load = useCallback(async () => {
        try { setItems((await listOfflineMedia()).sort((a, b) => b.savedAt.localeCompare(a.savedAt))); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => {
        void load();
        window.addEventListener(OFFLINE_CHANGED_EVENT, load);
        return () => window.removeEventListener(OFFLINE_CHANGED_EVENT, load);
    }, [load]);
    const total = useMemo(() => items.reduce((sum, item) => sum + item.blob.size, 0), [items]);
    const play = async (item: OfflineMedia) => {
        if (item.file.file_type === 'audio' || item.file.file_type === 'video') setPreviewFile(await offlinePlaybackFile(item));
        else {
            const url = URL.createObjectURL(item.blob);
            window.open(url, '_blank', 'noopener,noreferrer');
        }
    };
    const remove = async (item: OfflineMedia) => {
        await removeOfflineMedia(item.id);
        addToast('نسخه آفلاین حذف شد');
    };
    return <div className="mx-auto w-full max-w-5xl p-4 pb-28 sm:p-6 md:pb-8 lg:p-8">
        <header><p className="text-xs font-semibold text-primary-300">📥 همیشه همراهت</p><h1 className="mt-1 text-3xl font-bold">دانلودهای آفلاین</h1><p className="mt-2 text-sm text-dark-400">فایل‌هایی که روی همین دستگاه ذخیره کرده‌ای، بدون اینترنت هم پخش می‌شوند.</p>{items.length > 0 && <div className="mt-4 flex gap-2 text-xs"><span className="rounded-full bg-white/[.05] px-3 py-1.5 text-dark-300">{items.length.toLocaleString('fa-IR')} فایل</span><span className="rounded-full bg-white/[.05] px-3 py-1.5 text-dark-300">{formatFileSize(total)}</span></div>}</header>
        {loading ? <div className="mt-8 h-28 animate-pulse rounded-2xl bg-dark-800"/> : items.length ? <div className="mt-7 space-y-2">{items.map(item => <article key={item.id} className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-dark-900/65 p-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-300">{item.file.file_type === 'video' ? <Film className="h-5 w-5"/> : <Music className="h-5 w-5"/>}</span><div className="min-w-0 flex-1"><h2 dir="auto" className="truncate text-sm font-semibold">{item.file.file_name}</h2><p className="mt-1 text-xs text-dark-500">{formatFileSize(item.blob.size)} · ذخیره در {formatPersianDate(item.savedAt)}</p></div><button onClick={() => void play(item)} className="btn-icon" title="پخش آفلاین"><Play className="h-5 w-5"/></button><button onClick={() => void remove(item)} className="btn-icon text-red-300" title="حذف نسخه آفلاین"><Trash2 className="h-5 w-5"/></button></article>)}</div> : <div className="mt-8 rounded-3xl border border-dashed border-white/10 py-14 text-center"><HardDriveDownload className="mx-auto h-10 w-10 text-dark-600"/><h2 className="mt-4 font-bold">هنوز چیزی ذخیره نکردی</h2><p className="mx-auto mt-2 max-w-sm text-sm leading-7 text-dark-400">از منوی سه‌نقطه هر فایل، «ذخیره برای پخش آفلاین» را بزن.</p></div>}
    </div>;
}
