import { useEffect, useRef, useState } from 'react';
import { Boxes, Check, ChevronLeft, DownloadCloud, ExternalLink, Eye, EyeOff, Loader2, MoreVertical, Pencil, Send, Trash2, X } from 'lucide-react';
import { api, Pack, sendFilesToTelegram, type PackSummary, useDeletePack, useUpdatePack } from '../lib/api';
import { savePackOffline } from '../lib/offline';
import { useAppStore } from '../lib/store';
import BlurredPreview, { blurredPreviewStyle } from './BlurredPreview';

function authenticatedMediaUrl(url:string) {
    if(!url||url.startsWith('blob:')||url.startsWith('data:'))return url;
    if(/[?&]token=/.test(url))return url;
    const token=localStorage.getItem('access_token')||'';
    return `${url}${url.includes('?')?'&':'?'}token=${encodeURIComponent(token)}`;
}

function DefaultPackCover({className=''}:{className?:string}) {
    return <span className={`relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br from-primary-500/35 via-[#17213a] to-sky-500/20 ${className}`}><span className="absolute -right-5 -top-7 h-24 w-24 rounded-full bg-white/10 blur-2xl"/><span className="absolute -bottom-8 -left-5 h-24 w-24 rounded-full bg-primary-400/20 blur-2xl"/><span className="relative flex h-14 w-14 rotate-[-6deg] items-center justify-center rounded-2xl border border-white/15 bg-black/25 text-primary-100 shadow-2xl backdrop-blur"><Boxes className="h-7 w-7"/></span></span>;
}

export default function PackCard({ pack, viewMode, onOpen, selected=false, selectionMode=false, onSelect }: { pack: PackSummary; viewMode: 'grid'|'dense'|'list'; onOpen: () => void; selected?:boolean; selectionMode?:boolean; onSelect?:(multi:boolean)=>void }) {
    const [menuOpen,setMenuOpen]=useState(false);
    const [saving,setSaving]=useState(false);
    const [sending,setSending]=useState(false);
    const [confirmDelete,setConfirmDelete]=useState(false);
    const remove=useDeletePack();
    const update=useUpdatePack();
    const menuRef=useRef<HTMLDivElement>(null);
    const addToast=useAppStore(state=>state.addToast);
    const cover=authenticatedMediaUrl(pack.cover_url||pack.cover_urls[0]||'');
    const meta=`${pack.item_count.toLocaleString('fa-IR')} آیتم`;
    const activate=(event?:React.MouseEvent|React.KeyboardEvent)=>{event?.stopPropagation();if(selectionMode)onSelect?.(true);else onOpen()};
    const openEdit=()=>{setMenuOpen(false);onOpen();window.setTimeout(()=>window.dispatchEvent(new Event('komod-pack-edit')),80)};
    const saveOffline=async()=>{setMenuOpen(false);setSaving(true);try{const {data}=await api.get<Pack>(`/packs/${pack.id}`);await savePackOffline(data);addToast(`جعبه «${pack.name}» آفلاین شد.`)}catch(error){addToast(error instanceof Error?error.message:'ذخیره جعبه انجام نشد.','error')}finally{setSaving(false)}};
    const sendToTelegram=async()=>{setMenuOpen(false);setSending(true);try{const {data}=await api.get<Pack>(`/packs/${pack.id}`);await sendFilesToTelegram(data.items.map(item=>item.file.id));addToast('محتوای جعبه به تلگرام فرستاده شد.')}catch(error:any){addToast(error?.response?.data?.detail||'ارسال جعبه انجام نشد.','error')}finally{setSending(false)}};
    const toggleBlur=async()=>{setMenuOpen(false);try{await update.mutateAsync({id:pack.id,is_blurred:!pack.is_blurred});addToast(pack.is_blurred?'نمای جعبه واضح شد.':'پیش‌نمایش جعبه محو شد.')}catch(error:any){addToast(error?.response?.data?.detail||'تغییر نمایش جعبه انجام نشد.','error')}};
    useEffect(()=>{if(!menuOpen)return;const close=(event:PointerEvent)=>{if(!menuRef.current?.contains(event.target as Node))setMenuOpen(false)};document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[menuOpen]);
    const menu=<>
        {menuOpen&&<div ref={menuRef} dir="rtl" className="absolute left-2 top-12 z-30 w-52 overflow-hidden rounded-2xl border border-white/10 bg-dark-900/95 p-1.5 text-right shadow-2xl backdrop-blur-xl" onClick={event=>event.stopPropagation()}>
            <button className="context-menu-item w-full" onClick={()=>{setMenuOpen(false);onOpen()}}><ExternalLink className="h-4 w-4"/> بازکردن</button>
            <button className="context-menu-item w-full" onClick={openEdit}><Pencil className="h-4 w-4"/> ویرایش جعبه</button>
            <button className="context-menu-item w-full" disabled={sending} onClick={()=>void sendToTelegram()}>{sending?<Loader2 className="h-4 w-4 animate-spin"/>:<Send className="h-4 w-4"/>} ارسال به تلگرام</button>
            <button className="context-menu-item w-full" disabled={saving} onClick={()=>void saveOffline()}>{saving?<Loader2 className="h-4 w-4 animate-spin"/>:<DownloadCloud className="h-4 w-4"/>} ذخیره آفلاین</button>
            <button className="context-menu-item w-full" disabled={update.isPending} onClick={()=>void toggleBlur()}>{pack.is_blurred?<Eye className="h-4 w-4"/>:<EyeOff className="h-4 w-4"/>} {pack.is_blurred?'برداشتن محوشدگی':'محو کردن کارت'}</button>
            <button className="context-menu-item w-full text-red-300" onClick={()=>{setMenuOpen(false);setConfirmDelete(true)}}><Trash2 className="h-4 w-4"/> حذف جعبه</button>
        </div>}
        {confirmDelete&&<div className="fixed inset-0 z-[260] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" onClick={event=>{event.stopPropagation();setConfirmDelete(false)}}><section dir="rtl" className="w-full max-w-sm rounded-3xl border border-white/10 bg-dark-900 p-5 text-right shadow-2xl" onClick={event=>event.stopPropagation()}><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/10 text-red-300"><Trash2 className="h-5 w-5"/></span><h3 className="flex-1 font-bold">حذف جعبه</h3><button className="btn-icon" onClick={()=>setConfirmDelete(false)}><X className="h-4 w-4"/></button></div><p dir="auto" className="mt-4 break-words text-sm leading-7 text-dark-300">جعبه «{pack.name}» حذف شود؟ فایل‌های اصلی باقی می‌مانند.</p><div className="mt-5 grid grid-cols-2 gap-2"><button disabled={remove.isPending} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-500/15 text-sm font-semibold text-red-200" onClick={async event=>{event.stopPropagation();try{await remove.mutateAsync(pack.id);setConfirmDelete(false);addToast('جعبه حذف شد.')}catch(error:any){addToast(error?.response?.data?.detail||'حذف جعبه انجام نشد.','error')}}}>{remove.isPending?<Loader2 className="h-4 w-4 animate-spin"/>:<Trash2 className="h-4 w-4"/>}حذف</button><button className="btn-secondary" onClick={()=>setConfirmDelete(false)}>لغو</button></div></section></div>}
    </>;
    const more=<button type="button" title="گزینه‌های جعبه" onClick={event=>{event.stopPropagation();setMenuOpen(value=>!value)}} className="absolute left-2 top-2 z-20 flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-black/60 text-white backdrop-blur hover:bg-primary-500/30"><MoreVertical className="h-4 w-4"/></button>;
    const selectionMark=selectionMode?<span className={`absolute right-2 top-2 z-30 flex h-6 w-6 items-center justify-center rounded-md border ${selected?'border-primary-400 bg-primary-500 text-white':'border-white/30 bg-dark-950/85'}`}>{selected&&<Check className="h-4 w-4"/>}</span>:null;
    if(viewMode==='list')return <div role="button" tabIndex={0} onClick={activate} onKeyDown={event=>{if(event.key==='Enter')activate(event)}} className={`group relative flex min-h-20 w-full cursor-pointer items-center gap-3 rounded-2xl border bg-gradient-to-l p-2.5 text-right transition ${selected?'border-primary-400/45 from-primary-500/20 to-dark-900':'border-primary-400/15 from-primary-500/[.09] to-dark-900/80 hover:border-primary-400/35 hover:bg-primary-500/[.12]'}`}>{selectionMark}<span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary-500/15 text-primary-200"><span className="absolute inset-0 transition duration-300" style={blurredPreviewStyle(pack.is_blurred)}>{cover?<img src={cover} alt="" className="h-full w-full object-cover" style={{objectPosition:`${pack.cover_position_x??50}% ${pack.cover_position_y??50}%`,transform:`scale(${(pack.cover_zoom??100)/100})`}} loading="lazy"/>:<DefaultPackCover/>}</span><BlurredPreview active={pack.is_blurred} compact/><span className="absolute bottom-1 right-1 z-20 rounded-md bg-black/65 px-1.5 py-0.5 text-[9px] text-white">جعبه</span></span><span className="min-w-0 flex-1 pl-10"><strong dir="auto" className="block truncate text-sm text-white">{pack.name}</strong><small className="mt-1 block text-dark-400">{meta}</small></span><ChevronLeft className="h-4 w-4 shrink-0 text-dark-500 transition group-hover:text-primary-200"/>{!selectionMode&&more}{menu}</div>;
    const dense=viewMode==='dense';
    return <div role="button" tabIndex={0} onClick={activate} onKeyDown={event=>{if(event.key==='Enter')activate(event)}} className={`group relative cursor-pointer overflow-visible border bg-dark-900 text-right shadow-lg transition hover:-translate-y-0.5 ${selected?'border-primary-400/50 ring-2 ring-primary-500/20':'border-primary-400/15 hover:border-primary-400/35'} ${dense?'rounded-2xl':'rounded-3xl'}`}>{selectionMark}<span className={`relative flex w-full items-center justify-center overflow-hidden bg-gradient-to-br from-primary-500/20 to-dark-800 ${dense?'aspect-square rounded-t-2xl':'aspect-[4/3] rounded-t-3xl'}`}><span className="absolute inset-0 transition duration-300" style={blurredPreviewStyle(pack.is_blurred)}>{cover?<img src={cover} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" style={{objectPosition:`${pack.cover_position_x??50}% ${pack.cover_position_y??50}%`,transform:`scale(${(pack.cover_zoom??100)/100})`}} loading="lazy"/>:<DefaultPackCover/>}</span><BlurredPreview active={pack.is_blurred}/><span className="absolute right-2 top-2 z-20 rounded-lg bg-black/65 px-2 py-1 text-[10px] font-bold text-white backdrop-blur">📦 جعبه</span></span><span className={`block ${dense?'p-2':'p-3'}`}><strong dir="auto" className={`block truncate pl-8 text-white ${dense?'text-xs':'text-sm'}`}>{pack.name}</strong><small className="mt-1 block text-dark-400">{meta}</small></span>{!selectionMode&&more}{menu}</div>;
}
