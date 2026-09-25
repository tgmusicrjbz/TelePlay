import { useEffect, useMemo, useState } from 'react';
import { DndContext, DragEndEvent, PointerSensor, TouchSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Film, GripVertical, ListMusic, MoreVertical, Music, Pencil, Play, Plus, Save, Search, Shuffle, Trash2, X } from 'lucide-react';
import { formatDuration, Playlist, PlaylistItem, PlaylistSummary, useActivityFeed, useAddPlaylistItems, useCreatePlaylist, useDeletePlaylist, useFiles, useFolders, usePlaylist, usePlaylists, useRemovePlaylistItem, useReorderPlaylist, useShufflePlaylist, useUpdatePlaylist } from '../lib/api';
import { useAppStore } from '../lib/store';

type Kind = 'all' | 'audio' | 'video';
const telegram = () => (window as Window & { Telegram?: { WebApp?: any } }).Telegram?.WebApp;
const openPath = (path: string) => { if (location.pathname !== path) history.pushState({}, '', path); window.dispatchEvent(new PopStateEvent('popstate')); };

export default function PlaylistBrowser() {
    const [path, setPath] = useState(location.pathname);
    const selectedId = Number(path.match(/^\/playlist\/(\d+)/)?.[1]) || null;
    useEffect(() => { const sync = () => setPath(location.pathname); addEventListener('popstate', sync); return () => removeEventListener('popstate', sync); }, []);
    useEffect(() => {
        const back = telegram()?.BackButton;
        if (!back || !selectedId) return;
        const handler = () => openPath('/playlists');
        back.show(); back.onClick(handler);
        return () => { back.offClick(handler); back.hide(); };
    }, [selectedId]);
    return selectedId ? <PlaylistDetail id={selectedId} onBack={() => openPath('/playlists')} /> : <PlaylistIndex />;
}

function PlaylistIndex() {
    const { data: playlists = [], isLoading } = usePlaylists();
    const { data: activity } = useActivityFeed(true, 50);
    const [kind, setKind] = useState<Kind>('all');
    const [creating, setCreating] = useState(false);
    const create = useCreatePlaylist();
    const { startQueue, addToast } = useAppStore();
    const visible = playlists.filter(p => kind === 'all' || (kind === 'audio' ? p.audio_count > 0 : p.video_count > 0));
    const filter = (files: NonNullable<typeof activity>['recent']) => files.filter(file => kind === 'all' || file.file_type === kind);
    const smart = [
        { title: '⭐ نشان‌شده‌ها', subtitle: 'فایل‌هایی که دوستشان داری', files: filter(activity?.favorites || []) },
        { title: '⏱️ ادامه تماشا', subtitle: 'ادامه از همان‌جایی که ماند', files: filter(activity?.continue_watching || []) },
        { title: '🕒 تازه اضافه‌شده‌ها', subtitle: 'تازه‌های کمد', files: filter(activity?.recent || []) },
    ];
    return <div className="mx-auto w-full max-w-7xl p-4 pb-28 sm:p-6 md:pb-8 lg:p-8">
        <header className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-semibold text-primary-300">🎧 پخش پشت‌سرهم</p><h1 className="mt-1 text-3xl font-bold">پلی‌لیست‌ها</h1><p className="mt-2 text-sm text-dark-400">آهنگ‌ها و ویدیوهایت را هر طور دوست داری بچین.</p></div><button className="btn-primary flex items-center gap-2" onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> پلی‌لیست تازه</button></header>
        <div className="mt-5 flex w-fit rounded-xl border border-white/10 bg-dark-900 p-1">{([['all','همه'],['audio','🎵 صوتی'],['video','🎬 ویدیویی']] as [Kind,string][]).map(([id,label]) => <button key={id} onClick={() => setKind(id)} className={`rounded-lg px-4 py-2 text-sm ${kind === id ? 'bg-primary-500/20 text-primary-200' : 'text-dark-400'}`}>{label}</button>)}</div>
        <section className="mt-8"><h2 className="mb-3 text-lg font-bold">پلی‌لیست‌های هوشمند ✨</h2><div className="grid gap-3 sm:grid-cols-3">{smart.map(item => <button key={item.title} disabled={!item.files.length} onClick={() => startQueue(item.files, 0)} className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-4 text-right disabled:opacity-55"><span className="font-bold">{item.title}</span><span className="mt-2 block text-xs text-dark-400">{item.files.length.toLocaleString('fa-IR')} مورد · {item.subtitle}</span></button>)}</div></section>
        <section className="mt-8"><div className="mb-3 flex items-center gap-2"><ListMusic className="h-5 w-5 text-primary-300"/><h2 className="text-lg font-bold">ساخته‌های من</h2></div>{isLoading ? <div className="h-36 animate-pulse rounded-2xl bg-dark-800"/> : visible.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{visible.map(p => <PlaylistCard key={p.id} playlist={p} />)}</div> : <div className="rounded-2xl border border-dashed border-white/10 py-12 text-center text-dark-400">هنوز پلی‌لیستی اینجا نیست.</div>}</section>
        {creating && <PlaylistEditor title="پلی‌لیست تازه" onClose={() => setCreating(false)} onSave={async (name, description) => { const p = await create.mutateAsync({ name, description }); setCreating(false); addToast('پلی‌لیست ساخته شد 🎶'); openPath(`/playlist/${p.id}`); }} />}
    </div>;
}

function PlaylistCard({ playlist }: { playlist: PlaylistSummary }) {
    return <button onClick={() => openPath(`/playlist/${playlist.id}`)} className="group flex gap-4 rounded-2xl border border-white/[.07] bg-dark-900/65 p-3 text-right hover:border-primary-500/30"><Collage urls={playlist.cover_urls} /><span className="min-w-0 flex-1 self-center"><strong className="block truncate text-base">{playlist.name}</strong><span className="mt-2 block text-xs text-dark-400">{playlist.item_count.toLocaleString('fa-IR')} مورد · {formatDuration(playlist.total_duration) || 'بدون مدت'}</span><span className="mt-1 block text-[11px] text-dark-500">{playlist.audio_count.toLocaleString('fa-IR')} صوت · {playlist.video_count.toLocaleString('fa-IR')} ویدیو</span></span></button>;
}

function Collage({ urls }: { urls: string[] }) {
    return <span className="grid h-24 w-24 shrink-0 grid-cols-2 overflow-hidden rounded-xl bg-gradient-to-br from-primary-500/30 to-pink-500/20">{urls.length ? urls.slice(0,4).map((url,i) => <img key={i} src={url} className="h-full w-full object-cover" />) : <span className="col-span-2 flex items-center justify-center text-3xl">🎶</span>}</span>;
}

function PlaylistDetail({ id, onBack }: { id: number; onBack: () => void }) {
    const { data: playlist, isLoading } = usePlaylist(id);
    const reorder = useReorderPlaylist(); const shuffle = useShufflePlaylist(); const remove = useRemovePlaylistItem(); const del = useDeletePlaylist();
    const { startQueue, addToast } = useAppStore();
    const [adding, setAdding] = useState(false); const [editing, setEditing] = useState(false); const [menu, setMenu] = useState(false);
    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }));
    if (isLoading || !playlist) return <div className="m-6 h-52 animate-pulse rounded-3xl bg-dark-800"/>;
    const play = (index = 0) => startQueue(playlist.items.map(x => x.file), index);
    const dragEnd = async ({ active, over }: DragEndEvent) => { if (!over || active.id === over.id) return; const old = playlist.items.findIndex(x => x.id === active.id); const next = playlist.items.findIndex(x => x.id === over.id); await reorder.mutateAsync({ id, itemIds: arrayMove(playlist.items, old, next).map(x => x.id) }); };
    const requestDelete = () => { const run = async () => { await del.mutateAsync(id); addToast('پلی‌لیست حذف شد'); onBack(); }; const message=`پلی‌لیست «${playlist.name}» حذف شود؟ فایل‌ها باقی می‌مانند.`; telegram()?.showConfirm ? telegram().showConfirm(message, (yes: boolean) => yes && void run()) : confirm(message) && void run(); };
    return <div className="mx-auto w-full max-w-5xl p-4 pb-28 sm:p-6 md:pb-8 lg:p-8">
        <button className="mb-4 text-sm text-dark-400 md:hidden" onClick={onBack}>‹ برگشت به پلی‌لیست‌ها</button>
        <header className="relative flex flex-col gap-5 rounded-3xl border border-white/[.08] bg-gradient-to-bl from-primary-500/15 to-dark-900 p-5 sm:flex-row"><Collage urls={playlist.cover_urls}/><div className="min-w-0 flex-1"><h1 className="truncate text-3xl font-black">{playlist.name}</h1>{playlist.description && <p className="mt-2 text-sm leading-6 text-dark-300">{playlist.description}</p>}<p className="mt-3 text-xs text-dark-400">{playlist.item_count.toLocaleString('fa-IR')} مورد · {formatDuration(playlist.total_duration) || 'بدون مدت'}</p><div className="mt-5 flex flex-wrap gap-2"><button disabled={!playlist.items.length} className="btn-primary flex items-center gap-2" onClick={() => play()}><Play className="h-4 w-4"/> پخش همه</button><button disabled={playlist.items.length < 2} className="btn-secondary flex items-center gap-2" onClick={async () => { await shuffle.mutateAsync(id); addToast('ترتیب شافل شد 🔀'); }}><Shuffle className="h-4 w-4"/> شافل</button><button className="btn-secondary flex items-center gap-2" onClick={() => setAdding(true)}><Plus className="h-4 w-4"/> افزودن فایل</button></div></div>
            <div className="absolute left-4 top-4"><button className="btn-icon" onClick={() => setMenu(!menu)}><MoreVertical className="h-5 w-5"/></button>{menu && <div className="absolute left-0 z-20 mt-1 w-44 rounded-xl border border-white/10 bg-dark-800 p-1 shadow-2xl"><button className="context-menu-item w-full" onClick={() => {setEditing(true);setMenu(false)}}><Pencil className="h-4 w-4"/> ویرایش مشخصات</button><button className="context-menu-item w-full text-red-300" onClick={requestDelete}><Trash2 className="h-4 w-4"/> حذف پلی‌لیست</button></div>}</div>
        </header>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}><SortableContext items={playlist.items.map(x => x.id)} strategy={verticalListSortingStrategy}><div className="mt-5 space-y-2">{playlist.items.map((item,index) => <TrackRow key={item.id} item={item} index={index} onPlay={() => play(index)} onRemove={() => remove.mutateAsync({ id, itemId: item.id })}/>)}</div></SortableContext></DndContext>
        {!playlist.items.length && <button onClick={() => setAdding(true)} className="mt-5 w-full rounded-2xl border border-dashed border-white/10 py-14 text-dark-300">این پلی‌لیست هنوز خالیه! <span className="mt-2 block text-primary-300">➕ افزودن اولین آهنگ یا ویدیو</span></button>}
        {adding && <BulkAdd playlist={playlist} onClose={() => setAdding(false)}/>} {editing && <EditPlaylist playlist={playlist} close={() => setEditing(false)}/>}
    </div>;
}

function TrackRow({ item, index, onPlay, onRemove }: { item: PlaylistItem; index: number; onPlay: () => void; onRemove: () => void }) {
    const [menu,setMenu] = useState(false); const sortable = useSortable({ id: item.id });
    return <div ref={sortable.setNodeRef} style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }} className="flex items-center gap-2 rounded-xl border border-white/[.06] bg-dark-900/65 p-2.5"><button className="h-10 w-10 shrink-0 rounded-lg bg-primary-500/15" onClick={onPlay}><Play className="mx-auto h-4 w-4"/></button><span className="w-6 text-center text-xs text-dark-500">{(index+1).toLocaleString('fa-IR')}</span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{item.file.file_name}</p><p className="mt-1 text-xs text-dark-500">{item.file.file_type === 'video' ? 'ویدیو' : 'صوت'} {item.file.duration ? `· ${formatDuration(item.file.duration)}` : ''}</p></div><button className="relative btn-icon" onClick={() => setMenu(!menu)}><MoreVertical className="h-4 w-4"/>{menu && <span className="absolute left-0 top-full z-20 mt-1 w-36 rounded-xl border border-white/10 bg-dark-800 p-1"><span role="button" onClick={e => {e.stopPropagation();onRemove()}} className="context-menu-item text-red-300"><Trash2 className="h-4 w-4"/> حذف از فهرست</span></span>}</button><button {...sortable.attributes} {...sortable.listeners} className="flex h-11 w-11 touch-none items-center justify-center rounded-lg text-dark-400" title="برای جابه‌جایی بکش"><GripVertical className="h-5 w-5"/></button></div>;
}

function BulkAdd({ playlist, onClose }: { playlist: Playlist; onClose: () => void }) {
    const [query,setQuery] = useState(''); const [folder,setFolder] = useState<number|null>(null); const [selected,setSelected] = useState<Set<number>>(new Set());
    const { data } = useFiles(folder, 'audio,video', query || undefined, 1, 'name:asc'); const { data: folders=[] } = useFolders(null); const add = useAddPlaylistItems();
    const existing = useMemo(() => new Set(playlist.items.map(x => x.file.id)), [playlist]);
    const submit = async () => { const ids=[...selected]; const duplicates=ids.filter(fileId => existing.has(fileId)); const run=async(allowDuplicates:boolean)=>{await add.mutateAsync({id:playlist.id,fileIds:ids,allowDuplicates});onClose()}; if (!duplicates.length) return run(false); const message='بعضی فایل‌ها قبلاً اضافه شده‌اند؛ دوباره هم اضافه شوند؟'; if(telegram()?.showConfirm) telegram().showConfirm(message,(yes:boolean)=>void run(yes)); else void run(confirm(message)); };
    return <div className="fixed inset-0 z-[150] flex items-end bg-black/70 backdrop-blur-sm" onClick={onClose}><div className="mx-auto flex max-h-[88vh] w-full max-w-2xl flex-col rounded-t-3xl border border-white/10 bg-dark-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]" onClick={e=>e.stopPropagation()}><div className="mx-auto mb-3 h-1 w-12 rounded-full bg-white/20"/><div className="flex items-center justify-between"><h2 className="text-lg font-bold">افزودن فایل‌ها</h2><button className="btn-icon" onClick={onClose}><X className="h-5 w-5"/></button></div><div className="relative mt-4"><Search className="absolute right-3 top-3 h-4 w-4 text-dark-500"/><input className="input w-full pr-9" placeholder="جست‌وجوی آهنگ یا ویدیو…" value={query} onChange={e=>setQuery(e.target.value)}/></div><div className="mt-3 flex gap-2 overflow-x-auto pb-2"><button onClick={()=>setFolder(null)} className={`shrink-0 rounded-full px-3 py-2 text-xs ${folder===null?'bg-primary-500/20 text-primary-200':'bg-dark-800 text-dark-400'}`}>همه کشوها</button>{folders.map(f=><button key={f.id} onClick={()=>setFolder(f.id)} className={`shrink-0 rounded-full px-3 py-2 text-xs ${folder===f.id?'bg-primary-500/20 text-primary-200':'bg-dark-800 text-dark-400'}`}>{f.name}</button>)}</div><div className="min-h-0 flex-1 space-y-1 overflow-y-auto">{(data?.files||[]).map(file=><button key={file.id} onClick={()=>setSelected(prev=>{const n=new Set(prev);n.has(file.id)?n.delete(file.id):n.add(file.id);return n})} className={`flex w-full items-center gap-3 rounded-xl border p-3 text-right ${selected.has(file.id)?'border-primary-500/40 bg-primary-500/10':'border-transparent hover:bg-white/[.04]'}`}><span className={`h-5 w-5 rounded border ${selected.has(file.id)?'border-primary-400 bg-primary-500':'border-white/20'}`}/><span>{file.file_type==='video'?<Film className="h-4 w-4"/>:<Music className="h-4 w-4"/>}</span><span className="min-w-0 flex-1 truncate text-sm">{file.file_name}</span>{existing.has(file.id)&&<span className="text-[10px] text-amber-300">قبلاً افزوده شده</span>}</button>)}</div><button disabled={!selected.size||add.isPending} className="btn-primary mt-4" onClick={submit}>افزودن ({selected.size.toLocaleString('fa-IR')})</button></div></div>;
}

function EditPlaylist({ playlist, close }: { playlist: Playlist; close: () => void }) { const update=useUpdatePlaylist(); return <PlaylistEditor title="ویرایش پلی‌لیست" initialName={playlist.name} initialDescription={playlist.description||''} onClose={close} onSave={async(name,description)=>{await update.mutateAsync({id:playlist.id,name,description});close()}}/>; }
function PlaylistEditor({ title, initialName='', initialDescription='', onClose, onSave }: { title:string; initialName?:string; initialDescription?:string; onClose:()=>void; onSave:(name:string,description:string)=>Promise<void> }) {
    const [name,setName]=useState(initialName); const [description,setDescription]=useState(initialDescription); const [saving,setSaving]=useState(false);
    return <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/70 p-4" onClick={onClose}><form className="w-full max-w-md rounded-2xl border border-white/10 bg-dark-900 p-5" onClick={e=>e.stopPropagation()} onSubmit={async e=>{e.preventDefault();if(!name.trim())return;setSaving(true);try{await onSave(name.trim(),description.trim())}finally{setSaving(false)}}}>
        <div className="flex items-center justify-between"><h2 className="text-lg font-bold">{title}</h2><button type="button" className="btn-icon" onClick={onClose}><X className="h-5 w-5"/></button></div><input autoFocus maxLength={255} className="input mt-4 w-full" placeholder="نام پلی‌لیست" value={name} onChange={e=>setName(e.target.value)}/><textarea maxLength={1024} className="input mt-3 min-h-24 w-full" placeholder="توضیحات (اختیاری)" value={description} onChange={e=>setDescription(e.target.value)}/><button disabled={saving||!name.trim()} className="btn-primary mt-4 flex w-full items-center justify-center gap-2"><Save className="h-4 w-4"/>{saving?'در حال ذخیره…':'ذخیره'}</button>
    </form></div>;
}
