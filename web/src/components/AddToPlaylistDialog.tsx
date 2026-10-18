import { useState } from 'react';
import { ListMusic, Plus, X } from 'lucide-react';
import { api, Playlist, useAddPlaylistItems, useCreatePlaylist, usePlaylists } from '../lib/api';
import { useAppStore } from '../lib/store';

export default function AddToPlaylistDialog() {
    const { playlistFiles: files, setPlaylistFile, addToast } = useAppStore();
    const { data: playlists = [] } = usePlaylists();
    const add = useAddPlaylistItems();
    const create = useCreatePlaylist();
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState('');
    if (!files.length) return null;

    const addTo = async (id: number) => {
        const selected = (await api.get<Playlist>(`/playlists/${id}`)).data;
        const newIds = files.filter(file => !selected.items.some(item => item.file.id === file.id)).map(file => file.id);
        const run = async () => {
            if (!newIds.length) { addToast('همه فایل‌های انتخاب‌شده قبلاً داخل این پلی‌لیست هستند.', 'info'); return; }
            await add.mutateAsync({ id, fileIds: newIds, allowDuplicates: false });
            addToast(`${newIds.length.toLocaleString('fa-IR')} فایل به پلی‌لیست اضافه شد 🎶`);
            setPlaylistFile(null);
        };
        await run();
    };

    const createAndAdd = async () => {
        const cleanName = name.trim();
        if (!cleanName) return;
        try {
            const playlist = await create.mutateAsync({ name: cleanName });
            await add.mutateAsync({ id: playlist.id, fileIds: files.map(file => file.id), allowDuplicates: false });
            addToast(`پلی‌لیست «${cleanName}» ساخته شد و فایل‌ها اضافه شدند 🎶`);
            setPlaylistFile(null);
        } catch (error: any) {
            addToast(error?.response?.data?.detail || 'ساخت پلی‌لیست انجام نشد.', 'error');
        }
    };

    return <div className="fixed inset-0 z-[160] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setPlaylistFile(null)}><div className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-t-3xl border border-white/10 bg-dark-900 p-4 sm:rounded-2xl" onClick={event => event.stopPropagation()}><div className="flex items-center justify-between"><div><h2 className="font-bold">افزودن به پلی‌لیست</h2><p className="mt-1 max-w-xs truncate text-xs text-dark-400">{files.length.toLocaleString('fa-IR')} فایل انتخاب شده</p></div><button className="btn-icon" onClick={() => setPlaylistFile(null)}><X className="h-5 w-5"/></button></div><div className="mt-4 border-b border-white/[.07] pb-3">{creating?<div className="flex gap-2"><input autoFocus value={name} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void createAndAdd()}} className="input min-w-0 flex-1 text-sm" placeholder="نام پلی‌لیست تازه"/><button disabled={!name.trim()||create.isPending||add.isPending} onClick={()=>void createAndAdd()} className="btn-primary shrink-0 px-4 text-xs disabled:opacity-40">ساخت</button></div>:<button onClick={()=>setCreating(true)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary-400/35 bg-primary-500/[.08] text-sm font-semibold text-primary-200 hover:bg-primary-500/[.14]"><Plus className="h-4 w-4"/>ساخت پلی‌لیست تازه</button>}</div><div className="mt-3 max-h-80 space-y-1 overflow-y-auto">{playlists.map(item => <button key={item.id} disabled={add.isPending} onClick={() => void addTo(item.id)} className="flex w-full items-center gap-3 rounded-xl p-3 text-right hover:bg-white/[.05]"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/15"><ListMusic className="h-5 w-5 text-primary-300"/></span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.name}</strong><small className="text-dark-500">{item.item_count.toLocaleString('fa-IR')} مورد</small></span><Plus className="h-4 w-4"/></button>)}{!playlists.length && <p className="py-8 text-center text-sm text-dark-400">هنوز پلی‌لیستی نداری.</p>}</div></div></div>;
}
