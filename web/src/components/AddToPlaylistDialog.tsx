import { useState } from 'react';
import { ListMusic, Plus } from 'lucide-react';
import { api, Playlist, useAddPlaylistItems, useCreatePlaylist, usePlaylists } from '../lib/api';
import { useAppStore } from '../lib/store';
import ModalShell from './ModalShell';

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

    return <ModalShell title="افزودن به پلی‌لیست" subtitle={`${files.length.toLocaleString('fa-IR')} فایل انتخاب شده`} icon={<ListMusic/>} onClose={()=>setPlaylistFile(null)} zIndex={190}><div className="border-b border-white/[.07] pb-3">{creating?<div className="flex gap-2"><input autoFocus value={name} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void createAndAdd()}} className="input min-w-0 flex-1 text-sm" placeholder="نام پلی‌لیست تازه"/><button disabled={!name.trim()||create.isPending||add.isPending} onClick={()=>void createAndAdd()} className="btn-primary shrink-0 px-4 text-xs disabled:opacity-40">ساخت</button></div>:<button onClick={()=>setCreating(true)} className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-primary-400/35 bg-primary-500/[.08] text-sm font-semibold text-primary-200 hover:bg-primary-500/[.14]"><Plus className="h-4 w-4"/>ساخت پلی‌لیست تازه</button>}</div><div className="mt-3 max-h-80 space-y-1 overflow-y-auto">{playlists.map(item => <button key={item.id} disabled={add.isPending} onClick={() => void addTo(item.id)} className="flex w-full items-center gap-3 rounded-xl p-3 text-right hover:bg-white/[.05]"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/15"><ListMusic className="h-5 w-5 text-primary-300"/></span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.name}</strong><small className="text-dark-500">{item.item_count.toLocaleString('fa-IR')} مورد</small></span><Plus className="h-4 w-4"/></button>)}{!playlists.length && <p className="py-8 text-center text-sm text-dark-400">هنوز پلی‌لیستی نداری.</p>}</div></ModalShell>;
}
