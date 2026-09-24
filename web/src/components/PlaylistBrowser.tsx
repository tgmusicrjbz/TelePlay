import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Film, ListMusic, Music, Pencil, Play, Plus, Save, Search, Shuffle, Trash2, X } from 'lucide-react';
import {
    formatDuration, Playlist, useAddPlaylistItems, useCreatePlaylist, useDeletePlaylist,
    useFiles, usePlaylist, usePlaylists, useRemovePlaylistItem, useReorderPlaylist,
    useShufflePlaylist, useUpdatePlaylist,
} from '../lib/api';
import { useAppStore } from '../lib/store';

const mediaIcon = (type: string) => type === 'video' ? <Film className="h-4 w-4 text-blue-300" /> : <Music className="h-4 w-4 text-pink-300" />;

export default function PlaylistBrowser() {
    const { data: playlists = [], isLoading } = usePlaylists();
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const { data: playlist } = usePlaylist(selectedId);
    const [showCreate, setShowCreate] = useState(false);
    const [showAdd, setShowAdd] = useState(false);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const { startQueue, addToast } = useAppStore();
    const createPlaylist = useCreatePlaylist();
    const deletePlaylist = useDeletePlaylist();
    const reorderPlaylist = useReorderPlaylist();
    const shufflePlaylist = useShufflePlaylist();
    const removeItem = useRemovePlaylistItem();

    useEffect(() => {
        if (selectedId === null && playlists.length) setSelectedId(playlists[0].id);
        if (selectedId !== null && playlists.length && !playlists.some(item => item.id === selectedId)) setSelectedId(playlists[0]?.id ?? null);
    }, [playlists, selectedId]);

    const move = async (index: number, offset: number) => {
        if (!playlist) return;
        const target = index + offset;
        if (target < 0 || target >= playlist.items.length) return;
        const ids = playlist.items.map(item => item.file.id);
        [ids[index], ids[target]] = [ids[target], ids[index]];
        await reorderPlaylist.mutateAsync({ id: playlist.id, fileIds: ids });
    };

    const play = (index = 0) => {
        if (!playlist?.items.length) return;
        startQueue(playlist.items.map(item => item.file), index);
    };

    const create = async (name: string, description: string) => {
        const result = await createPlaylist.mutateAsync({ name, description });
        setSelectedId(result.id);
        setShowCreate(false);
        addToast('پلی‌لیست تازه ساخته شد 🎶');
    };

    const deleteCurrentPlaylist = async () => {
        if (!playlist) return;
        await deletePlaylist.mutateAsync(playlist.id);
        setSelectedId(null);
        setShowDeleteConfirm(false);
        addToast('پلی‌لیست حذف شد.');
    };

    const requestPlaylistDelete = () => {
        if (!playlist) return;
        const message = `پلی‌لیست «${playlist.name}» حذف شود؟ فایل‌ها پاک نمی‌شوند.`;
        const telegramWebApp = (window as Window & { Telegram?: { WebApp?: { showConfirm?: (message: string, callback: (confirmed: boolean) => void) => void } } }).Telegram?.WebApp;
        if (telegramWebApp?.showConfirm) {
            telegramWebApp.showConfirm(message, confirmed => {
                if (confirmed) void deleteCurrentPlaylist();
            });
            return;
        }
        setShowDeleteConfirm(true);
    };

    return <div className="mx-auto w-full max-w-7xl p-4 sm:p-6 lg:p-8">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div><p className="text-xs font-semibold text-primary-300">🎧 پخش پشت‌سرهم</p><h1 className="mt-2 text-3xl font-bold">پلی‌لیست‌های من</h1><p className="mt-2 text-sm text-dark-400">آهنگ‌ها و ویدیوهای محبوبت را کنار هم بچین و بدون وقفه پخش کن.</p></div>
            <button className="btn-primary flex items-center justify-center gap-2" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> پلی‌لیست تازه</button>
        </div>

        <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)]">
            <aside className="rounded-2xl border border-white/[0.07] bg-dark-900/70 p-3">
                <div className="mb-3 flex items-center gap-2 px-2 text-sm font-semibold"><ListMusic className="h-4 w-4 text-primary-300" /> فهرست پلی‌لیست‌ها</div>
                {isLoading ? <div className="h-20 animate-pulse rounded-xl bg-dark-800" /> : playlists.length ? <div className="max-h-72 space-y-1 overflow-y-auto overscroll-contain pr-1 lg:max-h-[calc(100vh-15rem)]">
                    {playlists.map(item => <button key={item.id} onClick={() => setSelectedId(item.id)} className={`w-full rounded-xl px-3 py-3 text-right transition-colors ${selectedId === item.id ? 'bg-primary-500/15 text-primary-200' : 'text-dark-300 hover:bg-white/[0.05] hover:text-white'}`}>
                        <span className="block truncate font-medium">🎵 {item.name}</span><span className="mt-1 block text-xs text-dark-500">{item.item_count.toLocaleString('fa-IR')} مورد · {formatDuration(item.total_duration) || 'بدون مدت'}</span>
                    </button>)}
                </div> : <div className="rounded-xl border border-dashed border-white/10 p-5 text-center text-sm text-dark-400">هنوز پلی‌لیستی نساختی.</div>}
            </aside>

            <section className="min-w-0 rounded-2xl border border-white/[0.07] bg-dark-900/60 p-4 sm:p-5">
                {playlist ? <PlaylistDetail playlist={playlist} onPlay={play} onMove={move} onAdd={() => setShowAdd(true)} onShuffle={async () => { await shufflePlaylist.mutateAsync(playlist.id); addToast('ترتیب پلی‌لیست شافل شد 🔀'); }} onRemove={async fileId => { await removeItem.mutateAsync({ id: playlist.id, fileId }); }} onDelete={requestPlaylistDelete} /> : <div className="flex min-h-72 flex-col items-center justify-center text-center"><div className="text-5xl">🎶</div><h2 className="mt-4 text-xl font-bold">یک پلی‌لیست بساز</h2><p className="mt-2 text-sm text-dark-400">بعد آهنگ‌ها و ویدیوها را با ترتیب دلخواهت بهش اضافه کن.</p></div>}
            </section>
        </div>

        {showCreate && <PlaylistEditor title="پلی‌لیست تازه" onClose={() => setShowCreate(false)} onSave={create} />}
        {showAdd && playlist && <AddItemsModal playlist={playlist} onClose={() => setShowAdd(false)} />}
        {showDeleteConfirm && playlist && (
            <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setShowDeleteConfirm(false)}>
                <div role="alertdialog" aria-modal="true" aria-labelledby="delete-playlist-title" className="w-full max-w-sm rounded-2xl border border-white/10 bg-dark-900 p-5 shadow-2xl" onClick={event => event.stopPropagation()}>
                    <h2 id="delete-playlist-title" className="text-lg font-bold">حذف پلی‌لیست؟</h2>
                    <p className="mt-2 text-sm leading-6 text-dark-300">پلی‌لیست «{playlist.name}» حذف می‌شود؛ فایل‌های داخلش سر جایشان می‌مانند.</p>
                    <div className="mt-5 flex gap-2">
                        <button className="flex-1 rounded-xl bg-red-500/90 px-4 py-2.5 font-medium text-white hover:bg-red-500" onClick={() => void deleteCurrentPlaylist()}>حذفش کن</button>
                        <button className="btn-secondary flex-1" onClick={() => setShowDeleteConfirm(false)}>بی‌خیال</button>
                    </div>
                </div>
            </div>
        )}
    </div>;
}

function PlaylistDetail({ playlist, onPlay, onMove, onAdd, onShuffle, onRemove, onDelete }: { playlist: Playlist; onPlay: (index?: number) => void; onMove: (index: number, offset: number) => Promise<void>; onAdd: () => void; onShuffle: () => Promise<void>; onRemove: (fileId: number) => Promise<void>; onDelete: () => void | Promise<void> }) {
    const [editing, setEditing] = useState(false);
    const update = useUpdatePlaylist();
    return <>
        <div className="flex flex-col gap-4 border-b border-white/[0.06] pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0"><h2 className="truncate text-2xl font-bold">{playlist.name}</h2>{playlist.description && <p className="mt-2 whitespace-pre-wrap text-sm text-dark-400">{playlist.description}</p>}<p className="mt-2 text-xs text-dark-500">{playlist.item_count.toLocaleString('fa-IR')} مورد · {formatDuration(playlist.total_duration) || 'مدتی ثبت نشده'}</p></div>
            <div className="flex flex-wrap gap-2">
                <button className="btn-primary flex items-center gap-2" disabled={!playlist.items.length} onClick={() => onPlay(0)}><Play className="h-4 w-4" /> پخش همه</button>
                <button className="btn-secondary flex items-center gap-2" disabled={playlist.items.length < 2} onClick={onShuffle}><Shuffle className="h-4 w-4" /> شافل</button>
                <button className="btn-secondary flex items-center gap-2" onClick={onAdd}><Plus className="h-4 w-4" /> افزودن</button>
                <button className="btn-icon" title="ویرایش" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /></button>
                <button className="btn-icon text-red-300" title="حذف پلی‌لیست" onClick={onDelete}><Trash2 className="h-4 w-4" /></button>
            </div>
        </div>
        <div className="mt-4 space-y-2">
            {playlist.items.map((item, index) => <div key={item.id} className="group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-dark-800/50 p-2.5 hover:border-white/[0.12]">
                <button className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-500/15 text-primary-200" onClick={() => onPlay(index)}><Play className="h-4 w-4" /></button>
                <span className="w-6 text-center text-xs text-dark-500">{(index + 1).toLocaleString('fa-IR')}</span>
                <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.file.file_name}</p><p className="mt-1 flex items-center gap-2 text-xs text-dark-500">{mediaIcon(item.file.file_type)} {item.file.file_type === 'video' ? 'ویدیو' : 'آهنگ'} {item.file.duration ? `· ${formatDuration(item.file.duration)}` : ''}</p></div>
                <button className="btn-icon p-1.5" disabled={index === 0} title="بالاتر" onClick={() => onMove(index, -1)}><ArrowUp className="h-4 w-4" /></button>
                <button className="btn-icon p-1.5" disabled={index === playlist.items.length - 1} title="پایین‌تر" onClick={() => onMove(index, 1)}><ArrowDown className="h-4 w-4" /></button>
                <button className="btn-icon p-1.5 text-red-300 opacity-70 sm:opacity-0 sm:group-hover:opacity-100" title="حذف از پلی‌لیست" onClick={() => onRemove(item.file.id)}><X className="h-4 w-4" /></button>
            </div>)}
            {!playlist.items.length && <div className="rounded-xl border border-dashed border-white/10 py-12 text-center text-sm text-dark-400">این پلی‌لیست هنوز خالیه؛ چند آهنگ یا ویدیو بهش اضافه کن 🎵</div>}
        </div>
        {editing && <PlaylistEditor title="ویرایش پلی‌لیست" initialName={playlist.name} initialDescription={playlist.description || ''} onClose={() => setEditing(false)} onSave={async (name, description) => { await update.mutateAsync({ id: playlist.id, name, description }); setEditing(false); }} />}
    </>;
}

function PlaylistEditor({ title, initialName = '', initialDescription = '', onClose, onSave }: { title: string; initialName?: string; initialDescription?: string; onClose: () => void; onSave: (name: string, description: string) => Promise<void> }) {
    const [name, setName] = useState(initialName);
    const [description, setDescription] = useState(initialDescription);
    const [saving, setSaving] = useState(false);
    return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}><form className="w-full max-w-md rounded-2xl border border-white/10 bg-dark-900 p-5" onClick={event => event.stopPropagation()} onSubmit={async event => { event.preventDefault(); if (!name.trim()) return; setSaving(true); try { await onSave(name.trim(), description.trim()); } finally { setSaving(false); } }}>
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">{title} 🎼</h2><button type="button" className="btn-icon" onClick={onClose}><X className="h-5 w-5" /></button></div>
        <input className="input mt-5 w-full" maxLength={255} autoFocus placeholder="نام پلی‌لیست" value={name} onChange={event => setName(event.target.value)} />
        <textarea className="input mt-3 min-h-24 w-full resize-y" maxLength={1024} placeholder="توضیحات (اختیاری)" value={description} onChange={event => setDescription(event.target.value)} />
        <div className="mt-4 flex gap-2"><button className="btn-primary flex flex-1 items-center justify-center gap-2" disabled={saving || !name.trim()}><Save className="h-4 w-4" /> {saving ? 'در حال ذخیره…' : 'ذخیره'}</button><button type="button" className="btn-secondary" onClick={onClose}>لغو</button></div>
    </form></div>;
}

function AddItemsModal({ playlist, onClose }: { playlist: Playlist; onClose: () => void }) {
    const [query, setQuery] = useState('');
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const { data } = useFiles(null, 'audio,video', query || undefined, 1, 'name:asc');
    const addItems = useAddPlaylistItems();
    const existing = useMemo(() => new Set(playlist.items.map(item => item.file.id)), [playlist.items]);
    const files = data?.files.filter(file => !existing.has(file.id)) || [];
    return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}><div className="flex max-h-[85vh] w-full max-w-xl flex-col rounded-2xl border border-white/10 bg-dark-900 p-5" onClick={event => event.stopPropagation()}>
        <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">افزودن به «{playlist.name}»</h2><p className="mt-1 text-xs text-dark-400">آهنگ و ویدیو را می‌تونی با هم انتخاب کنی.</p></div><button className="btn-icon" onClick={onClose}><X className="h-5 w-5" /></button></div>
        <div className="relative mt-4"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-500" /><input className="input w-full pr-9" placeholder="جست‌وجوی آهنگ یا ویدیو…" value={query} onChange={event => setQuery(event.target.value)} /></div>
        <div className="mt-3 flex-1 space-y-1 overflow-y-auto">
            {files.map(file => <button key={file.id} onClick={() => setSelected(previous => { const next = new Set(previous); if (next.has(file.id)) next.delete(file.id); else next.add(file.id); return next; })} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-right ${selected.has(file.id) ? 'border-primary-500/40 bg-primary-500/10' : 'border-transparent hover:bg-white/[0.04]'}`}>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-dark-800">{mediaIcon(file.file_type)}</span><span className="min-w-0 flex-1 truncate text-sm">{file.file_name}</span><span className="text-xs text-dark-500">{file.duration ? formatDuration(file.duration) : ''}</span>
            </button>)}
            {!files.length && <p className="py-10 text-center text-sm text-dark-400">فایل تازه‌ای برای افزودن پیدا نشد.</p>}
        </div>
        <button className="btn-primary mt-4" disabled={!selected.size || addItems.isPending} onClick={async () => { await addItems.mutateAsync({ id: playlist.id, fileIds: Array.from(selected) }); onClose(); }}>{addItems.isPending ? 'در حال افزودن…' : `افزودن ${selected.size.toLocaleString('fa-IR')} مورد`}</button>
    </div></div>;
}
