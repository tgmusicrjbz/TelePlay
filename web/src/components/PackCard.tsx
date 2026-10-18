import { Boxes, ChevronLeft } from 'lucide-react';
import type { PackSummary } from '../lib/api';

function DefaultPackCover({className=''}:{className?:string}) {
    return <span className={`relative flex h-full w-full items-center justify-center overflow-hidden bg-gradient-to-br from-primary-500/35 via-[#17213a] to-sky-500/20 ${className}`}><span className="absolute -right-5 -top-7 h-24 w-24 rounded-full bg-white/10 blur-2xl"/><span className="absolute -bottom-8 -left-5 h-24 w-24 rounded-full bg-primary-400/20 blur-2xl"/><span className="relative flex h-14 w-14 rotate-[-6deg] items-center justify-center rounded-2xl border border-white/15 bg-black/25 text-primary-100 shadow-2xl backdrop-blur"><Boxes className="h-7 w-7"/></span></span>;
}

export default function PackCard({ pack, viewMode, onOpen }: { pack: PackSummary; viewMode: 'grid'|'dense'|'list'; onOpen: () => void }) {
    const cover = pack.cover_url || pack.cover_urls[0];
    const meta = `${pack.item_count.toLocaleString('fa-IR')} آیتم`;
    if (viewMode === 'list') return <button onClick={onOpen} className="group flex min-h-20 w-full items-center gap-3 rounded-2xl border border-primary-400/15 bg-gradient-to-l from-primary-500/[.09] to-dark-900/80 p-2.5 text-right transition hover:border-primary-400/35 hover:bg-primary-500/[.12]">
        <span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary-500/15 text-primary-200">{cover?<img src={cover} alt="" className="h-full w-full object-cover" loading="lazy"/>:<DefaultPackCover/>}<span className="absolute bottom-1 right-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[9px] text-white">جعبه</span></span>
        <span className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm text-white">{pack.name}</strong><small className="mt-1 block text-dark-400">{meta}</small></span>
        <ChevronLeft className="h-4 w-4 shrink-0 text-dark-500 transition group-hover:text-primary-200"/>
    </button>;
    const dense = viewMode === 'dense';
    return <button onClick={onOpen} className={`group relative overflow-hidden border border-primary-400/15 bg-dark-900 text-right shadow-lg transition hover:-translate-y-0.5 hover:border-primary-400/35 ${dense?'rounded-2xl':'rounded-3xl'}`}>
        <span className={`relative flex w-full items-center justify-center overflow-hidden bg-gradient-to-br from-primary-500/20 to-dark-800 ${dense?'aspect-square':'aspect-[4/3]'}`}>{cover?<img src={cover} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy"/>:<DefaultPackCover/>}<span className="absolute right-2 top-2 rounded-lg bg-black/65 px-2 py-1 text-[10px] font-bold text-white backdrop-blur">📦 جعبه</span></span>
        <span className={`block ${dense?'p-2':'p-3'}`}><strong dir="auto" className={`block truncate text-white ${dense?'text-xs':'text-sm'}`}>{pack.name}</strong><small className="mt-1 block text-dark-400">{meta}</small></span>
    </button>;
}
