import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, Eye, File, FileText, Film, HardDriveDownload, Image, ListMusic, Music, Play, Search, Trash2, X } from 'lucide-react';
import { formatFileSize } from '../lib/api';
import { listOfflineMedia, listOfflinePlaylists, listOfflineTexts, OfflineMedia, OfflinePlaylist, OfflineText, OFFLINE_CHANGED_EVENT, offlinePlaybackFile, offlinePlaylistFiles, removeOfflineMedia, removeOfflinePlaylist, removeOfflineText } from '../lib/offline';
import { useAppStore } from '../lib/store';

type Filter = 'all' | 'playlist' | 'audio' | 'video' | 'image' | 'text' | 'document';
type Sort = 'newest' | 'oldest' | 'name' | 'size';
type DeleteTarget = { kind: 'playlist' | 'media' | 'text'; id: number; name: string };

export default function DownloadsPage() {
    const [items, setItems] = useState<OfflineMedia[]>([]);
    const [texts, setTexts] = useState<OfflineText[]>([]);
    const [playlists, setPlaylists] = useState<OfflinePlaylist[]>([]);
    const [filter, setFilter] = useState<Filter>('all');
    const [query, setQuery] = useState('');
    const [sort, setSort] = useState<Sort>('newest');
    const [showSort, setShowSort] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
    const [loading, setLoading] = useState(true);
    const { setPreviewFile, setContentPreviewFile, startQueue, addToast } = useAppStore();
    const load = useCallback(async () => {
        try {
            const [media, savedTexts, savedPlaylists] = await Promise.all([listOfflineMedia(), listOfflineTexts(), listOfflinePlaylists()]);
            setItems(media); setTexts(savedTexts); setPlaylists(savedPlaylists);
        } finally { setLoading(false); }
    }, []);
    useEffect(() => { void load(); window.addEventListener(OFFLINE_CHANGED_EVENT, load); return () => window.removeEventListener(OFFLINE_CHANGED_EVENT, load); }, [load]);

    const counts: Record<Filter, number> = {
        all: playlists.length + items.length + texts.length, playlist: playlists.length,
        audio: items.filter(x => x.file.file_type === 'audio').length, video: items.filter(x => x.file.file_type === 'video').length,
        image: items.filter(x => x.file.file_type === 'image').length, text: texts.length,
        document: items.filter(x => x.file.file_type === 'document').length,
    };
    const filters: Array<[Filter, string, typeof File]> = [['all','همه',HardDriveDownload],['playlist','پلی‌لیست',ListMusic],['audio','صدا',Music],['video','ویدیو',Film],['image','عکس',Image],['text','متن',FileText],['document','فایل',File]];
    const normalizedQuery = query.trim().toLocaleLowerCase('fa');
    const compare = (a: { name: string; savedAt: string; size: number }, b: { name: string; savedAt: string; size: number }) => {
        if (sort === 'name') return a.name.localeCompare(b.name, 'fa');
        if (sort === 'size') return b.size - a.size;
        return sort === 'oldest' ? a.savedAt.localeCompare(b.savedAt) : b.savedAt.localeCompare(a.savedAt);
    };
    const visiblePlaylists = useMemo(() => (filter === 'all' || filter === 'playlist' ? playlists : []).filter(item => !normalizedQuery || item.name.toLocaleLowerCase('fa').includes(normalizedQuery)).sort((a,b) => compare({name:a.name,savedAt:a.savedAt,size:0},{name:b.name,savedAt:b.savedAt,size:0})), [playlists, filter, normalizedQuery, sort]);
    const visibleTexts = useMemo(() => (filter === 'all' || filter === 'text' ? texts : []).filter(item => !normalizedQuery || item.file.file_name.toLocaleLowerCase('fa').includes(normalizedQuery)).sort((a,b) => compare({name:a.file.file_name,savedAt:a.savedAt,size:new Blob([a.content]).size},{name:b.file.file_name,savedAt:b.savedAt,size:new Blob([b.content]).size})), [texts, filter, normalizedQuery, sort]);
    const visibleMedia = useMemo(() => (filter === 'all' ? items : items.filter(item => item.file.file_type === filter)).filter(item => !normalizedQuery || item.file.file_name.toLocaleLowerCase('fa').includes(normalizedQuery)).sort((a,b) => compare({name:a.file.file_name,savedAt:a.savedAt,size:a.blob.size},{name:b.file.file_name,savedAt:b.savedAt,size:b.blob.size})), [items, filter, normalizedQuery, sort]);
    const scopedCount = visiblePlaylists.length + visibleTexts.length + visibleMedia.length;
    const scopedSize = visibleMedia.reduce((sum, item) => sum + item.blob.size, 0) + visibleTexts.reduce((sum, item) => sum + new Blob([item.content]).size, 0);
    const empty = scopedCount === 0;

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
    const confirmDelete = async () => {
        if (!deleteTarget) return;
        if (deleteTarget.kind === 'playlist') await removeOfflinePlaylist(deleteTarget.id);
        else if (deleteTarget.kind === 'text') await removeOfflineText(deleteTarget.id);
        else await removeOfflineMedia(deleteTarget.id);
        setDeleteTarget(null); addToast('از دانلودهای این دستگاه حذف شد.');
    };

    return <div className="mx-auto w-full max-w-5xl p-4 pb-28 sm:p-6 md:pb-8 lg:p-8">
        <header>
            <p className="text-xs font-semibold text-primary-300">📥 بی‌اینترنت هم کنارتن</p>
            <h1 className="mt-1 text-3xl font-bold">دانلودها</h1>
            <p className="mt-2 text-sm text-dark-400">چیزهایی که برای روز مبادا روی همین دستگاه نگه داشتی اینجان.</p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:max-w-sm">
                <div className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-3"><span className="block text-[11px] text-dark-500">در این بخش</span><strong className="mt-1 block text-lg text-primary-200">{scopedCount.toLocaleString('fa-IR')} مورد</strong></div>
                <div className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-3"><span className="block text-[11px] text-dark-500">حجم روی دستگاه</span><strong className="mt-1 block text-lg text-primary-200">{formatFileSize(scopedSize)}</strong></div>
            </div>
        </header>
        <div className="mt-5 grid grid-cols-7 gap-1 rounded-2xl border border-white/[.07] bg-dark-900/70 p-1">{filters.map(([value,label,Icon]) => <button key={value} title={`${label} (${counts[value].toLocaleString('fa-IR')})`} aria-label={label} onClick={() => setFilter(value)} className={`flex h-11 min-w-0 items-center justify-center rounded-xl transition ${filter===value?'bg-primary-500/20 text-primary-200 shadow-inner':'text-dark-400 hover:bg-white/[.04] hover:text-white'}`}><Icon className="h-4 w-4 sm:h-5 sm:w-5"/></button>)}</div>
        <div className="mt-3 flex items-center gap-2">
            <label className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute right-3 top-1/2 z-30 h-4 w-4 -translate-y-1/2 text-dark-500"/><input value={query} onChange={event => setQuery(event.target.value)} className="input relative z-0 w-full !pr-11" placeholder="جست‌وجو بین دانلودها…"/></label>
            <div className="relative"><button className={`btn-icon ${showSort ? 'bg-primary-500/15 text-primary-200' : ''}`} onClick={() => setShowSort(value => !value)} title="مرتب‌سازی"><ArrowDownUp className="h-5 w-5"/></button>{showSort && <div className="absolute left-0 top-full z-40 mt-2 w-44 rounded-2xl border border-white/10 bg-dark-900 p-1.5 shadow-2xl">{([['newest','تازه‌ترین'],['oldest','قدیمی‌ترین'],['name','نام'],['size','حجم']] as [Sort,string][]).map(([value,label]) => <button key={value} onClick={() => { setSort(value); setShowSort(false); }} className={`block w-full rounded-xl px-3 py-2 text-right text-sm ${sort===value?'bg-primary-500/15 text-primary-200':'text-dark-300 hover:bg-white/[.05]'}`}>{label}</button>)}</div>}</div>
        </div>
        {loading ? <div className="mt-7 h-32 animate-pulse rounded-2xl bg-dark-800"/> : <div className="mt-5 space-y-2">
            {visiblePlaylists.map(playlist => <DownloadRow key={`p-${playlist.id}`} icon={<ListMusic/>} name={playlist.name} meta={`${playlist.fileIds.length.toLocaleString('fa-IR')} فایل آفلاین`} onOpen={() => void playPlaylist(playlist)} onDelete={() => setDeleteTarget({kind:'playlist',id:playlist.id,name:playlist.name})}/>)}
            {visibleTexts.map(item => <DownloadRow key={`t-${item.id}`} icon={<FileText/>} name={item.file.file_name} meta={item.id < 0 ? 'در انتظار همگام‌سازی' : 'یادداشت آفلاین'} openIcon={<Eye/>} onOpen={() => setContentPreviewFile(item.file)} onDelete={() => setDeleteTarget({kind:'text',id:item.id,name:item.file.file_name})}/>)}
            {visibleMedia.map(item => <DownloadRow key={`m-${item.id}`} icon={<OfflineTypeIcon type={item.file.file_type}/>} name={item.file.file_name} meta={formatFileSize(item.blob.size)} openIcon={item.file.file_type === 'image' ? <Eye/> : undefined} onOpen={() => void play(item)} onDelete={() => setDeleteTarget({kind:'media',id:item.id,name:item.file.file_name})}/>)}
            {empty && <div className="rounded-3xl border border-dashed border-white/10 py-14 text-center"><HardDriveDownload className="mx-auto h-10 w-10 text-dark-600"/><h2 className="mt-4 font-bold">اینجا فعلاً خالیه</h2><p className="mt-2 text-sm text-dark-500">از منوی فایل یا پلی‌لیست، «ذخیره آفلاین» را بزن.</p></div>}
        </div>}
        {deleteTarget && <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setDeleteTarget(null)}><div className="w-full max-w-sm rounded-3xl border border-white/10 bg-dark-900 p-5" onClick={event => event.stopPropagation()}><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/10 text-red-300"><Trash2 className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="font-bold">از دانلودها حذف بشه؟</h2><p dir="auto" className="mt-1 truncate text-xs text-dark-400">{deleteTarget.name}</p></div><button className="btn-icon" onClick={() => setDeleteTarget(null)}><X className="h-5 w-5"/></button></div><p className="mt-4 text-sm leading-6 text-dark-300">نسخه آفلاین از همین دستگاه پاک می‌شود؛ فایل اصلی داخل کمد باقی می‌ماند.</p><div className="mt-5 flex gap-2"><button className="flex-1 rounded-xl bg-red-500 px-4 py-2.5 font-semibold" onClick={() => void confirmDelete()}>حذف</button><button className="btn-secondary flex-1" onClick={() => setDeleteTarget(null)}>بی‌خیال</button></div></div></div>}
    </div>;
}
function OfflineTypeIcon({ type }: { type: string }) { const Icon = type === 'audio' ? Music : type === 'video' ? Film : type === 'image' ? Image : File; return <Icon className="h-5 w-5"/>; }
function DownloadRow({ icon, name, meta, openIcon, onOpen, onDelete }: { icon: React.ReactNode; name: string; meta: string; openIcon?: React.ReactNode; onOpen: () => void; onDelete: () => void }) {
    return <article className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-dark-900/65 p-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary-500/20 to-pink-500/10 text-primary-300 [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm">{name}</strong><small className="mt-1 block text-dark-500">{meta}</small></div><button onClick={onOpen} className="btn-icon" title="باز کردن">{openIcon || <Play className="h-5 w-5"/>}</button><button onClick={onDelete} className="btn-icon text-red-300" title="حذف نسخه آفلاین"><Trash2 className="h-5 w-5"/></button></article>;
}
