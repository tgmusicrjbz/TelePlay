import { ListMusic, Plus, X } from 'lucide-react';
import { api, Playlist, useAddPlaylistItems, usePlaylists } from '../lib/api';
import { useAppStore } from '../lib/store';

const telegram = () => (window as Window & { Telegram?: { WebApp?: any } }).Telegram?.WebApp;

export default function AddToPlaylistDialog() {
    const { playlistFile: file, setPlaylistFile, addToast } = useAppStore();
    const { data: playlists = [] } = usePlaylists();
    const add = useAddPlaylistItems();
    if (!file) return null;

    const addTo = async (id: number) => {
        const selected = (await api.get<Playlist>(`/playlists/${id}`)).data;
        const duplicate = selected.items.some(item => item.file.id === file.id);
        const run = async (allowDuplicates: boolean) => {
            await add.mutateAsync({ id, fileIds: [file.id], allowDuplicates });
            addToast('فایل به پلی‌لیست اضافه شد 🎶');
            setPlaylistFile(null);
        };
        if (!duplicate) return run(false);
        const message = 'این فایل قبلاً اضافه شده؛ دوباره هم اضافه شود؟';
        if (telegram()?.showConfirm) telegram().showConfirm(message, (yes: boolean) => yes && void run(true));
        else if (confirm(message)) await run(true);
    };

    return <div className="fixed inset-0 z-[160] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setPlaylistFile(null)}><div className="max-h-[80vh] w-full max-w-md overflow-hidden rounded-t-3xl border border-white/10 bg-dark-900 p-4 sm:rounded-2xl" onClick={event => event.stopPropagation()}><div className="flex items-center justify-between"><div><h2 className="font-bold">افزودن به پلی‌لیست</h2><p className="mt-1 max-w-xs truncate text-xs text-dark-400">{file.file_name}</p></div><button className="btn-icon" onClick={() => setPlaylistFile(null)}><X className="h-5 w-5"/></button></div><div className="mt-4 max-h-96 space-y-1 overflow-y-auto">{playlists.map(item => <button key={item.id} disabled={add.isPending} onClick={() => void addTo(item.id)} className="flex w-full items-center gap-3 rounded-xl p-3 text-right hover:bg-white/[.05]"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/15"><ListMusic className="h-5 w-5 text-primary-300"/></span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.name}</strong><small className="text-dark-500">{item.item_count.toLocaleString('fa-IR')} مورد</small></span><Plus className="h-4 w-4"/></button>)}{!playlists.length && <p className="py-10 text-center text-sm text-dark-400">اول یک پلی‌لیست بساز.</p>}</div></div></div>;
}
