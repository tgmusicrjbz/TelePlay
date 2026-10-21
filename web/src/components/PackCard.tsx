import { useState } from 'react';
import { Boxes, ChevronLeft, DownloadCloud, ExternalLink, Loader2, MoreVertical, Pencil, Trash2, X } from 'lucide-react';
import { api, Pack, type PackSummary, useDeletePack } from '../lib/api';
import { savePackOffline } from '../lib/offline';
import { useAppStore } from '../lib/store';

function authenticatedMediaUrl(url:string) {
    if(!url||url.startsWith('blob:')||url.startsWith('data:'))return url;
    if(/[?&]token=/.test(url))return url;
    const token=localStorage.getItem('access_token')||'';
    return `${url}${url.includes('?')?'&':'?'}token=${encodeURIComponent(token)}`;
}

function DefaultPackCover({className=''}:{className?:string}) {
    return <span className={`relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br from-primary-500/35 via-[#17213a] to-sky-500/20 ${className}`}><span className="absolute -right-5 -top-7 h-24 w-24 rounded-full bg-white/10 blur-2xl"/><span className="absolute -bottom-8 -left-5 h-24 w-24 rounded-full bg-primary-400/20 blur-2xl"/><span className="relative flex h-14 w-14 rotate-[-6deg] items-center justify-center rounded-2xl border border-white/15 bg-black/25 text-primary-100 shadow-2xl backdrop-blur"><Boxes className="h-7 w-7"/></span></span>;
}

export default function PackCard({ pack, viewMode, onOpen }: { pack: PackSummary; viewMode: 'grid'|'dense'|'list'; onOpen: () => void }) {
    const [menuOpen,setMenuOpen]=useState(false);
    const [saving,setSaving]=useState(false);
    const [confirmDelete,setConfirmDelete]=useState(false);
    const remove=useDeletePack();
    const addToast=useAppStore(state=>state.addToast);
    const cover=authenticatedMediaUrl(pack.cover_url||pack.cover_urls[0]||'');
    const meta=`${pack.item_count.toLocaleString('fa-IR')} آیتم`;
    const openEdit=()=>{setMenuOpen(false);onOpen();window.setTimeout(()=>window.dispatchEvent(new Event('komod-pack-edit')),80)};
    const saveOffline=async()=>{setMenuOpen(false);setSaving(true);try{const {data}=await api.get<Pack>(`/packs/${pack.id}`);await savePackOffline(data);addToast(`جعبه «${pack.name}» آفلاین شد.`)}catch(error){addToast(error instanceof Error?error.message:'ذخیره جعبه انجام نشد.','error')}finally{setSaving(false)}};
    const menu=<>
        {menuOpen&&<div dir="rtl" className="absolute left-2 top-12 z-30 w-44 overflow-hidden rounded-2xl border border-white/10 bg-dark-900/95 p-1.5 text-right shadow-2xl backdrop-blur-xl" onClick={event=>event.stopPropagation()}>
            <button className="context-menu-item w-full" onClick={()=>{setMenuOpen(false);onOpen()}}><ExternalLink className="h-4 w-4"/> بازکردن</button>
            <button className="context-menu-item w-full" onClick={openEdit}><Pencil className="h-4 w-4"/> ویرایش جعبه</button>
            <button className="context-menu-item w-full" disabled={saving} onClick={()=>void saveOffline()}>{saving?<Loader2 className="h-4 w-4 animate-spin"/>:<DownloadCloud className="h-4 w-4"/>} ذخیره آفلاین</button>
            <button className="context-menu-item w-full text-red-300" onClick={()=>{setMenuOpen(false);setConfirmDelete(true)}}><Trash2 className="h-4 w-4"/> حذف جعبه</button>
        </div>}
        {confirmDelete&&<div className="fixed inset-0 z-[260] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" onClick={event=>{event.stopPropagation();setConfirmDelete(false)}}><section dir="rtl" className="w-full max-w-sm rounded-3xl border border-white/10 bg-dark-900 p-5 text-right shadow-2xl" onClick={event=>event.stopPropagation()}><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/10 text-red-300"><Trash2 className="h-5 w-5"/></span><h3 className="flex-1 font-bold">حذف جعبه</h3><button className="btn-icon" onClick={()=>setConfirmDelete(false)}><X className="h-4 w-4"/></button></div><p dir="auto" className="mt-4 break-words text-sm leading-7 text-dark-300">جعبه «{pack.name}» حذف شود؟ فایل‌های اصلی باقی می‌مانند.</p><div className="mt-5 grid grid-cols-2 gap-2"><button disabled={remove.isPending} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-500/15 text-sm font-semibold text-red-200" onClick={async()=>{await remove.mutateAsync(pack.id);setConfirmDelete(false);addToast('جعبه حذف شد.')}}>{remove.isPending?<Loader2 className="h-4 w-4 animate-spin"/>:<Trash2 className="h-4 w-4"/>}حذف</button><button className="btn-secondary" onClick={()=>setConfirmDelete(false)}>لغو</button></div></section></div>}
    </>;
    const more=<button type="button" title="گزینه‌های جعبه" onClick={event=>{event.stopPropagation();setMenuOpen(value=>!value)}} className="absolute left-2 top-2 z-20 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/60 text-white backdrop-blur hover:bg-primary-500/30"><MoreVertical className="h-4 w-4"/></button>;
    if(viewMode==='list')return <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={event=>{if(event.key==='Enter')onOpen()}} className="group relative flex min-h-20 w-full cursor-pointer items-center gap-3 rounded-2xl border border-primary-400/15 bg-gradient-to-l from-primary-500/[.09] to-dark-900/80 p-2.5 text-right transition hover:border-primary-400/35 hover:bg-primary-500/[.12]"><span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary-500/15 text-primary-200">{cover?<img src={cover} alt="" className="h-full w-full object-cover" style={{objectPosition:`${pack.cover_position_x??50}% ${pack.cover_position_y??50}%`}} loading="lazy"/>:<DefaultPackCover/>}<span className="absolute bottom-1 right-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[9px] text-white">جعبه</span></span><span className="min-w-0 flex-1 pl-10"><strong dir="auto" className="block truncate text-sm text-white">{pack.name}</strong><small className="mt-1 block text-dark-400">{meta}</small></span><ChevronLeft className="h-4 w-4 shrink-0 text-dark-500 transition group-hover:text-primary-200"/>{more}{menu}</div>;
    const dense=viewMode==='dense';
    return <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={event=>{if(event.key==='Enter')onOpen()}} className={`group relative cursor-pointer overflow-visible border border-primary-400/15 bg-dark-900 text-right shadow-lg transition hover:-translate-y-0.5 hover:border-primary-400/35 ${dense?'rounded-2xl':'rounded-3xl'}`}><span className={`relative flex w-full items-center justify-center overflow-hidden bg-gradient-to-br from-primary-500/20 to-dark-800 ${dense?'aspect-square rounded-t-2xl':'aspect-[4/3] rounded-t-3xl'}`}>{cover?<img src={cover} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" style={{objectPosition:`${pack.cover_position_x??50}% ${pack.cover_position_y??50}%`}} loading="lazy"/>:<DefaultPackCover/>}<span className="absolute right-2 top-2 rounded-lg bg-black/65 px-2 py-1 text-[10px] font-bold text-white backdrop-blur">📦 جعبه</span></span><span className={`block ${dense?'p-2':'p-3'}`}><strong dir="auto" className={`block truncate pl-8 text-white ${dense?'text-xs':'text-sm'}`}>{pack.name}</strong><small className="mt-1 block text-dark-400">{meta}</small></span>{more}{menu}</div>;
}
