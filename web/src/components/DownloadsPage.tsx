import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Film, HardDriveDownload, ListMusic, Loader2, Music, Play, Trash2 } from 'lucide-react';
import { api, formatFileSize, formatPersianDate, Playlist, usePlaylists } from '../lib/api';
import { listOfflineMedia, listOfflinePlaylists, OfflineDownloadProgress, OfflineMedia, OfflinePlaylist, OFFLINE_CHANGED_EVENT, offlinePlaybackFile, offlinePlaylistFiles, removeOfflineMedia, removeOfflinePlaylist, savePlaylistOffline } from '../lib/offline';
import { useAppStore } from '../lib/store';

export default function DownloadsPage() {
    const [items, setItems] = useState<OfflineMedia[]>([]);
    const [offlinePlaylists, setOfflinePlaylists] = useState<OfflinePlaylist[]>([]);
    const [loading, setLoading] = useState(true);
    const [downloading, setDownloading] = useState<({ id: number; playlistName: string; phase: 'preparing' | 'downloading' } & OfflineDownloadProgress) | null>(null);
    const { data: playlists = [] } = usePlaylists();
    const { setPreviewFile, startQueue, addToast } = useAppStore();
    const load = useCallback(async () => {
        try {
            const [media, savedPlaylists] = await Promise.all([listOfflineMedia(), listOfflinePlaylists()]);
            setItems(media.sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
            setOfflinePlaylists(savedPlaylists.sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
        } finally { setLoading(false); }
    }, []);
    useEffect(() => { void load(); window.addEventListener(OFFLINE_CHANGED_EVENT, load); return () => window.removeEventListener(OFFLINE_CHANGED_EVENT, load); }, [load]);
    const total = useMemo(() => items.reduce((sum, item) => sum + item.blob.size, 0), [items]);
    const play = async (item: OfflineMedia) => {
        if (item.file.file_type === 'audio' || item.file.file_type === 'video') setPreviewFile(await offlinePlaybackFile(item));
        else window.open(URL.createObjectURL(item.blob), '_blank', 'noopener,noreferrer');
    };
    const downloadPlaylist = async (id: number, playlistName: string, expectedTotal: number) => {
        if (downloading) return addToast('اول بذار دانلود فعلی تموم بشه.', 'error');
        setDownloading({ id, playlistName, phase: 'preparing', done: 0, total: expectedTotal, failed: 0, currentName: '', loaded: 0, size: 0 });
        try {
            await navigator.storage?.persist?.();
            const { data } = await api.get<Playlist>(`/playlists/${id}`);
            const saved = await savePlaylistOffline(data, progress => setDownloading({ id, playlistName, phase: 'downloading', ...progress }));
            addToast(`${saved.fileIds.length.toLocaleString('fa-IR')} فایل پلی‌لیست آفلاین شد${saved.failedCount ? `؛ ${saved.failedCount.toLocaleString('fa-IR')} فایل در دسترس نبود` : ''} 📥`);
        } catch (error: any) {
            const message = error?.response?.data?.detail || error?.message || 'دانلود پلی‌لیست انجام نشد';
            addToast(message, 'error');
        }
        finally { setDownloading(null); }
    };
    const playPlaylist = async (playlist: OfflinePlaylist) => {
        const files = await offlinePlaylistFiles(playlist);
        if (!files.length) return addToast('هیچ فایل آفلاینی از این پلی‌لیست باقی نمانده.', 'error');
        if (files.length < playlist.totalCount) addToast(`${(playlist.totalCount - files.length).toLocaleString('fa-IR')} فایل موجود نبود و رد شد.`);
        startQueue(files, 0);
    };
    return <div className="mx-auto w-full max-w-5xl p-4 pb-28 sm:p-6 md:pb-8 lg:p-8">
        <header><p className="text-xs font-semibold text-primary-300">📥 همیشه همراهت</p><h1 className="mt-1 text-3xl font-bold">دانلودهای آفلاین</h1><p className="mt-2 text-sm text-dark-400">فایل‌ها در حافظه همین مرورگر و همین دستگاه ذخیره می‌شوند.</p>{items.length > 0 && <div className="mt-4 flex gap-2 text-xs"><span className="rounded-full bg-white/[.05] px-3 py-1.5 text-dark-300">{items.length.toLocaleString('fa-IR')} فایل</span><span className="rounded-full bg-white/[.05] px-3 py-1.5 text-dark-300">{formatFileSize(total)}</span></div>}</header>
        {downloading && <section className="mt-6 overflow-hidden rounded-2xl border border-primary-400/25 bg-primary-500/[.07] p-4 shadow-lg shadow-primary-950/20" aria-live="polite"><div className="flex items-center gap-3"><Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary-300"/><div className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm">در حال دانلود «{downloading.playlistName}»</strong><p dir="auto" className="mt-1 truncate text-xs text-dark-300">{downloading.phase === 'preparing' ? 'در حال آماده‌سازی فهرست فایل‌ها…' : downloading.currentName}</p></div><span className="shrink-0 text-xs font-bold text-primary-200">{downloading.done.toLocaleString('fa-IR')} / {downloading.total.toLocaleString('fa-IR')}</span></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-dark-950/70"><div className="h-full rounded-full bg-primary-500 transition-[width] duration-300" style={{width:`${downloading.total ? Math.min(100, downloading.done / downloading.total * 100) : 3}%`}}/></div>{downloading.phase === 'downloading' && <div className="mt-2 flex justify-between text-[11px] text-dark-400"><span>{downloading.failed ? `${downloading.failed.toLocaleString('fa-IR')} فایل رد شد` : 'دانلود در پس‌زمینه ادامه دارد'}</span>{downloading.size > 0 && <span>{formatFileSize(Math.min(downloading.loaded, downloading.size))} از {formatFileSize(downloading.size)}</span>}</div>}</section>}
        {navigator.onLine && playlists.length > 0 && <section className="mt-7"><h2 className="mb-3 font-bold">دانلود یک پلی‌لیست</h2><div className="grid gap-2 sm:grid-cols-2">{playlists.map(playlist => { const job = downloading?.id === playlist.id ? downloading : null; return <article key={playlist.id} className={`relative overflow-hidden rounded-2xl border p-3 ${job ? 'border-primary-400/30 bg-primary-500/[.06]' : 'border-white/[.07] bg-dark-900/65'}`}><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary-500/10 text-primary-300">{job ? <Loader2 className="h-5 w-5 animate-spin"/> : <ListMusic className="h-5 w-5"/>}</span><div className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm">{playlist.name}</strong><small className="text-dark-500">{job ? `${job.done.toLocaleString('fa-IR')} از ${job.total.toLocaleString('fa-IR')} فایل` : `${playlist.item_count.toLocaleString('fa-IR')} ترک`}</small></div><button disabled={Boolean(downloading)} onClick={() => void downloadPlaylist(playlist.id, playlist.name, playlist.item_count)} className="btn-icon disabled:opacity-40" title="دانلود پلی‌لیست">{job ? <Loader2 className="h-5 w-5 animate-spin"/> : <Download className="h-5 w-5"/>}</button></div>{job && <div className="absolute inset-x-0 bottom-0 h-1 bg-dark-950/60"><div className="h-full bg-primary-500 transition-[width] duration-300" style={{width:`${job.total ? job.done / job.total * 100 : 3}%`}}/></div>}</article>; })}</div></section>}
        {offlinePlaylists.length > 0 && <section className="mt-7"><h2 className="mb-3 font-bold">پلی‌لیست‌های آفلاین</h2><div className="space-y-2">{offlinePlaylists.map(playlist => <article key={playlist.id} className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-dark-900/65 p-3"><ListMusic className="h-5 w-5 text-primary-300"/><div className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm">{playlist.name}</strong><small className="text-dark-500">{playlist.fileIds.length.toLocaleString('fa-IR')} از {playlist.totalCount.toLocaleString('fa-IR')} فایل آماده</small></div><button onClick={() => void playPlaylist(playlist)} className="btn-icon" title="پخش آفلاین"><Play className="h-5 w-5"/></button><button onClick={() => void removeOfflinePlaylist(playlist.id)} className="btn-icon text-red-300" title="حذف پلی‌لیست آفلاین"><Trash2 className="h-5 w-5"/></button></article>)}</div></section>}
        <section className="mt-7"><h2 className="mb-3 font-bold">فایل‌های آفلاین</h2>{loading ? <div className="h-28 animate-pulse rounded-2xl bg-dark-800"/> : items.length ? <div className="space-y-2">{items.map(item => <article key={item.id} className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-dark-900/65 p-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-300">{item.file.file_type === 'video' ? <Film className="h-5 w-5"/> : <Music className="h-5 w-5"/>}</span><div className="min-w-0 flex-1"><h2 dir="auto" className="truncate text-sm font-semibold">{item.file.file_name}</h2><p className="mt-1 whitespace-nowrap text-xs text-dark-500">{formatFileSize(item.blob.size)} · {formatPersianDate(item.savedAt)}</p></div><button onClick={() => void play(item)} className="btn-icon" title="پخش آفلاین"><Play className="h-5 w-5"/></button><button onClick={() => void removeOfflineMedia(item.id)} className="btn-icon text-red-300" title="حذف نسخه آفلاین"><Trash2 className="h-5 w-5"/></button></article>)}</div> : <div className="rounded-3xl border border-dashed border-white/10 py-14 text-center"><HardDriveDownload className="mx-auto h-10 w-10 text-dark-600"/><h2 className="mt-4 font-bold">هنوز چیزی ذخیره نکردی</h2></div>}</section>
    </div>;
}
