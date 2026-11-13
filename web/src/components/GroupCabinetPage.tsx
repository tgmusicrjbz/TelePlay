import { useEffect, useMemo, useState } from 'react';
import { ListMusic, Play, Search, Shuffle, Trash2, Users, X } from 'lucide-react';
import { api, TelegramFile } from '../lib/api';
import { useAppStore } from '../lib/store';

type GroupFile = TelegramFile & { name?: string; size?: number };
type GroupCabinet = {
    title: string;
    role: 'owner' | 'editor' | 'viewer';
    can_edit: boolean;
    files: GroupFile[];
    playlists: Array<{ id: number; name: string; item_count: number; file_ids: number[] }>;
};

const playable = (file: TelegramFile) => file.file_type === 'audio' || file.file_type === 'video';

export default function GroupCabinetPage({ chatId }: { chatId: number }) {
    const [data, setData] = useState<GroupCabinet | null>(null);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [selectedPlaylist, setSelectedPlaylist] = useState<number | null>(null);
    const startQueue = useAppStore(state => state.startQueue);
    const addToast = useAppStore(state => state.addToast);
    const load = async (search = '') => {
        setLoading(true); setError('');
        try { const response = await api.get<GroupCabinet>(`/group-cabinets/${chatId}`, { params: { search } }); setData(response.data); }
        catch (reason: any) { setError(reason?.response?.data?.detail || 'کمد گروه در دسترس نیست.'); }
        finally { setLoading(false); }
    };
    useEffect(() => { void load(); }, [chatId]);
    const files = useMemo(() => data?.files || [], [data]);
    const playFiles = (items: TelegramFile[], index = 0, shuffle = false) => {
        const queue = items.filter(playable);
        if (!queue.length) { addToast('فایل قابل پخشی در این انتخاب نیست.', 'error'); return; }
        if (shuffle) queue.sort(() => Math.random() - .5);
        startQueue(queue, Math.min(index, queue.length - 1));
    };
    const playlistFiles = selectedPlaylist === null ? [] : (data?.playlists.find(item => item.id === selectedPlaylist)?.file_ids || []).map(id => files.find(file => file.id === id)).filter((file): file is GroupFile => Boolean(file));
    return <main dir="rtl" className="min-h-screen bg-dark-950 px-3 pb-8 pt-5 text-white sm:px-6">
        <header className="mx-auto flex max-w-3xl items-center gap-3 rounded-3xl border border-primary-400/15 bg-gradient-to-l from-primary-500/15 to-dark-900/90 p-4 shadow-2xl">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-500/20 text-primary-200"><Users className="h-6 w-6" /></span>
            <div className="min-w-0 flex-1"><h1 className="truncate text-lg font-black">{data?.title || 'کمد گروه'}</h1><p className="mt-1 text-xs text-dark-300">پخش مشترک گروه با پلیر اصلی کمد · نقش: {data?.role === 'viewer' ? 'مشاهده‌گر' : data?.role === 'editor' ? 'ویرایشگر' : 'مدیر'}</p></div>
            <button className="btn-icon" onClick={() => window.close()} aria-label="بستن"><X className="h-5 w-5" /></button>
        </header>
        <section className="mx-auto mt-4 max-w-3xl rounded-3xl border border-white/[.07] bg-dark-900/70 p-3 sm:p-4">
            <div className="flex items-center gap-2 rounded-2xl border border-white/[.08] bg-black/20 px-3"><Search className="h-4 w-4 shrink-0 text-dark-500"/><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void load(query); }} className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none" placeholder="جست‌وجو در کمد گروه…"/><button onClick={() => void load(query)} className="rounded-xl px-2 py-1 text-xs text-primary-200">جست‌وجو</button></div>
            {loading && <p className="p-8 text-center text-sm text-dark-400">در حال باز کردن کمد گروه…</p>}
            {!loading && error && <div className="p-8 text-center"><p className="text-sm text-red-300">{error}</p><button className="btn-secondary mt-4" onClick={() => void load(query)}>تلاش دوباره</button></div>}
            {!loading && !error && <>
                <div className="mt-4 flex flex-wrap gap-2"><button onClick={() => setSelectedPlaylist(null)} className={`rounded-xl px-3 py-2 text-xs ${selectedPlaylist === null ? 'bg-primary-500 text-white' : 'bg-white/[.05] text-dark-300'}`}>همهٔ فایل‌ها ({files.length.toLocaleString('fa-IR')})</button>{(data?.playlists || []).map(playlist => <button key={playlist.id} onClick={() => setSelectedPlaylist(playlist.id)} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${selectedPlaylist === playlist.id ? 'bg-primary-500 text-white' : 'bg-white/[.05] text-dark-300'}`}><ListMusic className="h-3.5 w-3.5"/>{playlist.name} · {playlist.item_count.toLocaleString('fa-IR')}</button>)}</div>
                {selectedPlaylist !== null && <div className="mt-4 flex gap-2"><button className="btn-primary flex-1" onClick={() => playFiles(playlistFiles)}><Play className="h-4 w-4"/>پخش پلی‌لیست</button><button className="btn-secondary" onClick={() => playFiles(playlistFiles, 0, true)}><Shuffle className="h-4 w-4"/>شافل</button></div>}
                <div className="mt-4 space-y-2">{(selectedPlaylist === null ? files : playlistFiles).map(file => <div key={file.id} className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/[.06] bg-black/15 p-3"><button onClick={() => playFiles(selectedPlaylist === null ? files : playlistFiles, (selectedPlaylist === null ? files : playlistFiles).findIndex(item => item.id === file.id))} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/15 text-primary-200"><Play className="h-4 w-4"/></button><div className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm">{file.file_name}</strong><span className="text-[10px] text-dark-500">{file.file_type === 'video' ? 'ویدیو' : 'صوت'} · {file.duration ? `${Math.floor(file.duration / 60).toLocaleString('fa-IR')} دقیقه` : 'بدون مدت'}</span></div>{data?.can_edit && <button onClick={async () => { try { await api.delete(`/group-cabinets/${chatId}/items/${file.id}`); addToast('فایل از کمد گروه حذف شد.'); await load(query); } catch { addToast('حذف فایل انجام نشد.', 'error'); } }} className="btn-icon text-red-300" aria-label="حذف"><Trash2 className="h-4 w-4"/></button>}</div>)}{!(selectedPlaylist === null ? files : playlistFiles).length && <p className="p-8 text-center text-sm text-dark-500">فایلی برای نمایش وجود ندارد.</p>}</div>
            </>}
        </section>
    </main>;
}
