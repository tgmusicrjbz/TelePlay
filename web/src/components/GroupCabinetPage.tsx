import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, ListMusic, Pencil, Play, Plus, Search, Shuffle, Trash2, Users, X } from 'lucide-react';
import { api, TelegramFile } from '../lib/api';
import { useAppStore } from '../lib/store';

type GroupFile = TelegramFile & { name?: string; size?: number; in_cabinet?: boolean };
type GroupPlaylist = { id: number; name: string; item_count: number; file_ids: number[] };
type GroupCabinet = { title: string; role: 'owner' | 'editor' | 'viewer'; can_edit: boolean; can_contribute: boolean; files: GroupFile[]; playlists: GroupPlaylist[] };

const playable = (file: TelegramFile) => file.file_type === 'audio' || file.file_type === 'video';
const mediaLabel = (file: TelegramFile) => file.file_type === 'video' ? 'ویدیو' : file.file_type === 'audio' ? 'صوت' : 'فایل';
const durationLabel = (seconds?: number | null) => {
    if (!seconds) return 'مدت نامشخص';
    const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60);
    return hours ? `${hours.toLocaleString('fa-IR')}:${minutes.toString().padStart(2, '0')}` : `${Math.max(1, minutes).toLocaleString('fa-IR')} دقیقه`;
};

export default function GroupCabinetPage({ chatId }: { chatId: number }) {
    const [data, setData] = useState<GroupCabinet | null>(null);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [selectedPlaylist, setSelectedPlaylist] = useState<number | null>(null);
    const [nameDialog, setNameDialog] = useState<'create' | 'rename' | null>(null);
    const [newName, setNewName] = useState('');
    const [addOpen, setAddOpen] = useState(false);
    const [selectedFiles, setSelectedFiles] = useState<Set<number>>(new Set());
    const [deletePlaylist, setDeletePlaylist] = useState(false);
    const startQueue = useAppStore(state => state.startQueue);
    const addToast = useAppStore(state => state.addToast);

    const load = async (search = '', quiet = false) => {
        if (!quiet) setLoading(true);
        setError('');
        try {
            const response = await api.get<GroupCabinet>(`/group-cabinets/${chatId}`, { params: { search } });
            setData(response.data);
            if (selectedPlaylist !== null && !response.data.playlists.some(item => item.id === selectedPlaylist)) setSelectedPlaylist(null);
        } catch (reason: any) { setError(reason?.response?.data?.detail || 'کمد گروه در دسترس نیست.'); }
        finally { if (!quiet) setLoading(false); }
    };
    useEffect(() => { void load(); }, [chatId]);

    const files = useMemo(() => data?.files || [], [data]);
    const currentPlaylist = data?.playlists.find(item => item.id === selectedPlaylist) || null;
    const playlistFiles = useMemo(() => {
        if (!currentPlaylist) return [];
        const byId = new Map(files.map(file => [file.id, file]));
        return currentPlaylist.file_ids.map(id => byId.get(id)).filter((file): file is GroupFile => Boolean(file));
    }, [currentPlaylist, files]);
    const availableFiles = useMemo(() => {
        const existing = new Set(currentPlaylist?.file_ids || []);
        return files.filter(file => playable(file) && !existing.has(file.id));
    }, [currentPlaylist, files]);

    const playFiles = (items: TelegramFile[], targetId?: number, shuffle = false) => {
        const queue = items.filter(playable);
        if (!queue.length) { addToast('فایل قابل پخشی در این انتخاب نیست.', 'error'); return; }
        if (shuffle) for (let index = queue.length - 1; index > 0; index--) { const target = Math.floor(Math.random() * (index + 1)); [queue[index], queue[target]] = [queue[target], queue[index]]; }
        const index = targetId === undefined ? 0 : Math.max(0, queue.findIndex(file => file.id === targetId));
        startQueue(queue, index);
    };
    const mutate = async (request: () => Promise<unknown>, success: string, after?: () => void) => {
        if (busy) return;
        setBusy(true);
        try { await request(); after?.(); addToast(success); await load(query, true); }
        catch (reason: any) { addToast(reason?.response?.data?.detail || 'انجام تغییر ممکن نشد.', 'error'); }
        finally { setBusy(false); }
    };
    const move = (fileId: number, offset: number) => {
        if (!currentPlaylist) return;
        const order = [...currentPlaylist.file_ids], index = order.indexOf(fileId), target = index + offset;
        if (index < 0 || target < 0 || target >= order.length) return;
        [order[index], order[target]] = [order[target], order[index]];
        void mutate(() => api.put(`/group-cabinets/${chatId}/playlists/${currentPlaylist.id}/order`, { file_ids: order }), 'ترتیب پلی‌لیست به‌روز شد.');
    };

    return <main dir="rtl" className="min-h-screen bg-dark-950 px-3 pb-10 pt-4 text-white sm:px-6">
        <header className="mx-auto flex max-w-4xl items-center gap-3 rounded-3xl border border-primary-400/15 bg-gradient-to-l from-primary-500/15 to-dark-900/90 p-3.5 shadow-xl sm:p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-500/20 text-primary-200"><Users className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1"><h1 className="truncate text-base font-black sm:text-lg">{data?.title || 'کمد گروه'}</h1><p className="mt-0.5 text-[11px] text-dark-400">{(data?.playlists.length || 0).toLocaleString('fa-IR')} پلی‌لیست · {files.length.toLocaleString('fa-IR')} فایل</p></div>
            <button className="btn-icon" onClick={() => window.close()} aria-label="بستن"><X className="h-5 w-5" /></button>
        </header>

        <section className="mx-auto mt-3 max-w-4xl rounded-3xl border border-white/[.07] bg-dark-900/70 p-3 sm:p-4">
            <div className="flex items-center gap-2 rounded-2xl border border-white/[.08] bg-black/20 px-3"><Search className="h-4 w-4 shrink-0 text-dark-500"/><input value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void load(query); }} className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none" placeholder="جست‌وجوی فایل…"/><button onClick={() => void load(query)} className="rounded-xl px-2 py-1 text-xs text-primary-200">جست‌وجو</button></div>
            {loading && <p className="p-10 text-center text-sm text-dark-400">در حال باز کردن کمد گروه…</p>}
            {!loading && error && <div className="p-8 text-center"><p className="text-sm text-red-300">{error}</p><button className="btn-secondary mt-4" onClick={() => void load(query)}>تلاش دوباره</button></div>}
            {!loading && !error && data && <>
                <div className="mt-3 flex items-center gap-2 overflow-x-auto pb-1"><button onClick={() => setSelectedPlaylist(null)} className={`shrink-0 rounded-xl px-3 py-2 text-xs ${selectedPlaylist === null ? 'bg-primary-500 text-white' : 'bg-white/[.05] text-dark-300'}`}>همه فایل‌ها</button>{data.playlists.map(playlist => <button key={playlist.id} onClick={() => setSelectedPlaylist(playlist.id)} className={`flex max-w-52 shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-xs ${selectedPlaylist === playlist.id ? 'bg-primary-500 text-white' : 'bg-white/[.05] text-dark-300'}`}><ListMusic className="h-3.5 w-3.5 shrink-0"/><span className="truncate">{playlist.name}</span><span className="opacity-70">{playlist.item_count.toLocaleString('fa-IR')}</span></button>)}{data.can_contribute && <button onClick={() => { setNewName(''); setNameDialog('create'); }} className="flex shrink-0 items-center gap-1 rounded-xl border border-primary-400/20 px-3 py-2 text-xs text-primary-200"><Plus className="h-3.5 w-3.5"/>تازه</button>}</div>

                {currentPlaylist && <div className="mt-4 rounded-2xl border border-primary-400/15 bg-primary-500/[.06] p-3"><div className="flex min-w-0 items-center gap-2"><div className="min-w-0 flex-1"><h2 dir="auto" className="truncate font-bold">{currentPlaylist.name}</h2><p className="mt-1 text-[11px] text-dark-400">{currentPlaylist.item_count.toLocaleString('fa-IR')} مورد</p></div>{data.can_edit && <><button onClick={() => { setNewName(currentPlaylist.name); setNameDialog('rename'); }} className="btn-icon h-9 w-9" aria-label="تغییر نام"><Pencil className="h-4 w-4"/></button><button onClick={() => setDeletePlaylist(true)} className="btn-icon h-9 w-9 text-red-300" aria-label="حذف پلی‌لیست"><Trash2 className="h-4 w-4"/></button></>}</div><div className="mt-3 grid grid-cols-3 gap-2"><button className="btn-primary min-w-0 px-2 text-xs" onClick={() => playFiles(playlistFiles)}><Play className="h-4 w-4"/>پخش</button><button className="btn-secondary min-w-0 px-2 text-xs" onClick={() => playFiles(playlistFiles, undefined, true)}><Shuffle className="h-4 w-4"/>تصادفی</button>{data.can_contribute && <button className="btn-secondary min-w-0 px-2 text-xs" onClick={() => { setSelectedFiles(new Set()); setAddOpen(true); }}><Plus className="h-4 w-4"/>افزودن</button>}</div></div>}

                <div className="mt-4 space-y-2">{(currentPlaylist ? playlistFiles : files).map((file, index) => <article key={file.id} className="flex min-w-0 items-center gap-2.5 rounded-2xl border border-white/[.06] bg-black/15 p-2.5"><button onClick={() => playFiles(currentPlaylist ? playlistFiles : files, file.id)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/15 text-primary-200" aria-label="پخش"><Play className="h-4 w-4"/></button><div className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm">{file.file_name}</strong><span className="mt-1 block text-[10px] text-dark-500">{mediaLabel(file)} · {durationLabel(file.duration)}</span></div>{currentPlaylist && data.can_contribute && <div className="flex shrink-0 items-center"><button disabled={busy || index === 0} onClick={() => move(file.id, -1)} className="btn-icon h-8 w-8 disabled:opacity-25" aria-label="بالاتر"><ChevronUp className="h-4 w-4"/></button><button disabled={busy || index === playlistFiles.length - 1} onClick={() => move(file.id, 1)} className="btn-icon h-8 w-8 disabled:opacity-25" aria-label="پایین‌تر"><ChevronDown className="h-4 w-4"/></button><button disabled={busy} onClick={() => void mutate(() => api.delete(`/group-cabinets/${chatId}/playlists/${currentPlaylist.id}/items/${file.id}`), 'از پلی‌لیست حذف شد.')} className="btn-icon h-8 w-8 text-red-300" aria-label="حذف"><Trash2 className="h-4 w-4"/></button></div>}{!currentPlaylist && data.can_edit && file.in_cabinet && <button disabled={busy} onClick={() => void mutate(() => api.delete(`/group-cabinets/${chatId}/items/${file.id}`), 'فایل از کمد گروه حذف شد.')} className="btn-icon h-8 w-8 shrink-0 text-red-300" aria-label="حذف از کمد گروه"><Trash2 className="h-4 w-4"/></button>}</article>)}{!(currentPlaylist ? playlistFiles : files).length && <p className="p-10 text-center text-sm text-dark-500">{currentPlaylist ? 'این پلی‌لیست هنوز خالی است.' : 'فایلی برای نمایش وجود ندارد.'}</p>}</div>
            </>}
        </section>

        {nameDialog && <div className="fixed inset-0 z-[220] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" onClick={() => setNameDialog(null)}><form onSubmit={event => { event.preventDefault(); const name = newName.trim(); if (!name) return; if (nameDialog === 'rename' && currentPlaylist) void mutate(() => api.patch(`/group-cabinets/${chatId}/playlists/${currentPlaylist.id}`, { name }), 'نام پلی‌لیست عوض شد.', () => setNameDialog(null)); else void mutate(() => api.post(`/group-cabinets/${chatId}/playlists`, { name }), 'پلی‌لیست ساخته شد.', () => setNameDialog(null)); }} onClick={event => event.stopPropagation()} className="w-full max-w-sm rounded-3xl border border-white/10 bg-dark-900 p-5"><h2 className="font-bold">{nameDialog === 'rename' ? 'تغییر نام پلی‌لیست' : 'پلی‌لیست تازه'}</h2><input autoFocus value={newName} maxLength={80} onChange={event => setNewName(event.target.value)} className="input mt-4 w-full" placeholder="نام پلی‌لیست"/><div className="mt-4 grid grid-cols-2 gap-2"><button disabled={busy || !newName.trim()} className="btn-primary">ذخیره</button><button type="button" className="btn-secondary" onClick={() => setNameDialog(null)}>انصراف</button></div></form></div>}

        {addOpen && currentPlaylist && <div className="fixed inset-0 z-[220] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" onClick={() => setAddOpen(false)}><section onClick={event => event.stopPropagation()} className="flex max-h-[80vh] w-full max-w-md flex-col rounded-3xl border border-white/10 bg-dark-900 p-4"><div className="flex items-center gap-2"><h2 className="min-w-0 flex-1 truncate font-bold">افزودن به {currentPlaylist.name}</h2><button className="btn-icon" onClick={() => setAddOpen(false)}><X className="h-4 w-4"/></button></div><div className="mt-3 min-h-0 flex-1 space-y-2 overflow-y-auto">{availableFiles.map(file => <label key={file.id} className="flex cursor-pointer items-center gap-3 rounded-2xl bg-white/[.04] p-3"><input type="checkbox" checked={selectedFiles.has(file.id)} onChange={() => setSelectedFiles(current => { const next = new Set(current); next.has(file.id) ? next.delete(file.id) : next.add(file.id); return next; })}/><span dir="auto" className="min-w-0 flex-1 truncate text-sm">{file.file_name}</span></label>)}{!availableFiles.length && <p className="p-8 text-center text-sm text-dark-500">همه فایل‌های قابل پخش قبلاً اضافه شده‌اند.</p>}</div><button disabled={busy || !selectedFiles.size} onClick={() => void mutate(() => api.post(`/group-cabinets/${chatId}/playlists/${currentPlaylist.id}/items`, { file_ids: [...selectedFiles] }), `${selectedFiles.size.toLocaleString('fa-IR')} فایل اضافه شد.`, () => setAddOpen(false))} className="btn-primary mt-3 w-full">افزودن فایل‌های انتخاب‌شده</button></section></div>}

        {deletePlaylist && currentPlaylist && <div className="fixed inset-0 z-[230] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" onClick={() => setDeletePlaylist(false)}><section onClick={event => event.stopPropagation()} className="w-full max-w-sm rounded-3xl border border-white/10 bg-dark-900 p-5"><Trash2 className="h-6 w-6 text-red-300"/><h2 className="mt-4 font-bold">پلی‌لیست حذف شود؟</h2><p className="mt-2 text-xs leading-6 text-dark-400">فایل‌های اصلی داخل کمد گروه باقی می‌مانند.</p><div className="mt-4 grid grid-cols-2 gap-2"><button disabled={busy} onClick={() => void mutate(() => api.delete(`/group-cabinets/${chatId}/playlists/${currentPlaylist.id}`), 'پلی‌لیست حذف شد.', () => { setDeletePlaylist(false); setSelectedPlaylist(null); })} className="min-h-11 rounded-xl bg-red-600 text-sm font-bold">حذف</button><button className="btn-secondary" onClick={() => setDeletePlaylist(false)}>انصراف</button></div></section></div>}
    </main>;
}
