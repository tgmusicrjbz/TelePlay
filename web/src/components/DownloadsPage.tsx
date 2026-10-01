import { useCallback, useEffect, useMemo, useState } from 'react';
import { File, FileText, Film, HardDriveDownload, Image, ListMusic, Music, Play, Trash2 } from 'lucide-react';
import { formatFileSize, formatPersianDate } from '../lib/api';
import { listOfflineMedia, listOfflinePlaylists, listOfflineTexts, OfflineMedia, OfflinePlaylist, OfflineText, OFFLINE_CHANGED_EVENT, offlinePlaybackFile, offlinePlaylistFiles, removeOfflineMedia, removeOfflinePlaylist, removeOfflineText } from '../lib/offline';
import { useAppStore } from '../lib/store';

type Filter = 'all' | 'playlist' | 'audio' | 'video' | 'image' | 'text' | 'document';

export default function DownloadsPage() {
    const [items, setItems] = useState<OfflineMedia[]>([]);
    const [texts, setTexts] = useState<OfflineText[]>([]);
    const [playlists, setPlaylists] = useState<OfflinePlaylist[]>([]);
    const [filter, setFilter] = useState<Filter>('all');
    const [loading, setLoading] = useState(true);
    const { setPreviewFile, setContentPreviewFile, startQueue, addToast } = useAppStore();
    const load = useCallback(async () => {
        try {
            const [media, savedTexts, savedPlaylists] = await Promise.all([listOfflineMedia(), listOfflineTexts(), listOfflinePlaylists()]);
            setItems(media.sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
            setTexts(savedTexts.sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
            setPlaylists(savedPlaylists.sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
        } finally { setLoading(false); }
    }, []);
    useEffect(() => { void load(); window.addEventListener(OFFLINE_CHANGED_EVENT, load); return () => window.removeEventListener(OFFLINE_CHANGED_EVENT, load); }, [load]);
    const total = useMemo(() => items.reduce((sum, item) => sum + item.blob.size, 0) + texts.reduce((sum, item) => sum + new Blob([item.content]).size, 0), [items, texts]);
    const visibleMedia = filter === 'all' ? items : items.filter(item => item.file.file_type === filter);
    const showPlaylists = filter === 'all' || filter === 'playlist';
    const showTexts = filter === 'all' || filter === 'text';
    const play = async (item: OfflineMedia) => {
        if (item.file.file_type === 'audio' || item.file.file_type === 'video') setPreviewFile(await offlinePlaybackFile(item));
        else if (item.file.file_type === 'image') setContentPreviewFile({ ...item.file, stream_url: URL.createObjectURL(item.blob) });
        else window.open(URL.createObjectURL(item.blob), '_blank', 'noopener,noreferrer');
    };
    const playPlaylist = async (playlist: OfflinePlaylist) => {
        const files = await offlinePlaylistFiles(playlist);
        if (!files.length) return addToast('هیچ فایل آفلاینی از این پلی‌لیست باقی نمانده.', 'error');
        if (files.length < playlist.totalCount) addToast(`${(playlist.totalCount - files.length).toLocaleString('fa-IR')} فایل موجود نبود و رد شد.`);
        startQueue(files, 0);
    };
    const counts: Record<Filter, number> = { all: playlists.length + items.length + texts.length, playlist: playlists.length, audio: items.filter(x=>x.file.file_type==='audio').length, video: items.filter(x=>x.file.file_type==='video').length, image: items.filter(x=>x.file.file_type==='image').length, text: texts.length, document: items.filter(x=>x.file.file_type==='document').length };
    const filters: Array<[Filter,string,typeof File]> = [['all','همه',HardDriveDownload],['playlist','پلی‌لیست',ListMusic],['audio','صدا',Music],['video','ویدیو',Film],['image','عکس',Image],['text','متن',FileText],['document','فایل',File]];
    const empty = (!showPlaylists || !playlists.length) && (!showTexts || !texts.length) && !visibleMedia.length;
    return <div className="mx-auto w-full max-w-5xl p-4 pb-28 sm:p-6 md:pb-8 lg:p-8">
        <header><p className="text-xs font-semibold text-primary-300">📥 همیشه همراهت</p><h1 className="mt-1 text-3xl font-bold">دانلودها</h1><p className="mt-2 text-sm text-dark-400">فقط چیزهایی که روی همین دستگاه ذخیره شده‌اند اینجا دیده می‌شوند.</p><div className="mt-4 flex gap-2 text-xs"><span className="rounded-full bg-white/[.05] px-3 py-1.5 text-dark-300">{counts.all.toLocaleString('fa-IR')} مورد</span><span className="rounded-full bg-white/[.05] px-3 py-1.5 text-dark-300">{formatFileSize(total)}</span></div></header>
        <div className="mt-5 grid grid-cols-7 gap-1 rounded-2xl border border-white/[.07] bg-dark-900/70 p-1">{filters.map(([value,label,Icon]) => <button key={value} title={label} aria-label={label} onClick={() => setFilter(value)} className={`relative flex h-11 min-w-0 items-center justify-center rounded-xl transition ${filter===value?'bg-primary-500/20 text-primary-200 shadow-inner':'text-dark-400 hover:bg-white/[.04] hover:text-white'}`}><Icon className="h-4 w-4 sm:h-5 sm:w-5"/>{filter===value&&<span className="absolute -left-1 -top-1 min-w-5 rounded-full border border-dark-900 bg-primary-500 px-1 text-center text-[9px] font-bold leading-5 text-white">{counts[value].toLocaleString('fa-IR')}</span>}</button>)}</div>
        {loading ? <div className="mt-7 h-32 animate-pulse rounded-2xl bg-dark-800"/> : <div className="mt-7 space-y-2">
            {showPlaylists && playlists.map(playlist => <article key={`p-${playlist.id}`} className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-dark-900/65 p-3"><OfflineIcon type="playlist"/><div className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm">{playlist.name}</strong><small className="text-dark-500">{playlist.fileIds.length.toLocaleString('fa-IR')} فایل آماده · پلی‌لیست</small></div><button onClick={() => void playPlaylist(playlist)} className="btn-icon" title="پخش آفلاین"><Play className="h-5 w-5"/></button><button onClick={() => void removeOfflinePlaylist(playlist.id)} className="btn-icon text-red-300" title="حذف نسخه آفلاین"><Trash2 className="h-5 w-5"/></button></article>)}
            {showTexts && texts.map(item => <article key={`t-${item.id}`} className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-dark-900/65 p-3"><OfflineIcon type="text"/><div className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm">{item.file.file_name}</strong><small className="text-dark-500">متن · {formatPersianDate(item.savedAt)}</small></div><button onClick={() => setContentPreviewFile(item.file)} className="btn-icon" title="باز کردن"><FileText className="h-5 w-5"/></button><button onClick={() => void removeOfflineText(item.id)} className="btn-icon text-red-300" title="حذف نسخه آفلاین"><Trash2 className="h-5 w-5"/></button></article>)}
            {visibleMedia.map(item => <article key={`m-${item.id}`} className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-dark-900/65 p-3"><OfflineIcon type={item.file.file_type}/><div className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm">{item.file.file_name}</strong><small className="text-dark-500">{formatFileSize(item.blob.size)} · {formatPersianDate(item.savedAt)}</small></div><button onClick={() => void play(item)} className="btn-icon" title="باز کردن آفلاین"><Play className="h-5 w-5"/></button><button onClick={() => void removeOfflineMedia(item.id)} className="btn-icon text-red-300" title="حذف نسخه آفلاین"><Trash2 className="h-5 w-5"/></button></article>)}
            {empty && <div className="rounded-3xl border border-dashed border-white/10 py-14 text-center"><HardDriveDownload className="mx-auto h-10 w-10 text-dark-600"/><h2 className="mt-4 font-bold">چیزی در این دسته ذخیره نشده</h2><p className="mt-2 text-sm text-dark-500">از منوی فایل یا پلی‌لیست، «ذخیره آفلاین» را بزن.</p></div>}
        </div>}
    </div>;
}

function OfflineIcon({type}:{type:string}) { const Icon = type==='playlist'?ListMusic:type==='audio'?Music:type==='video'?Film:type==='image'?Image:type==='text'?FileText:File; return <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500/20 to-pink-500/10 text-primary-300"><Icon className="h-5 w-5"/></span>; }
