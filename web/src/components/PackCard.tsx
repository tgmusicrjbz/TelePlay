import { Boxes, ChevronLeft } from 'lucide-react';
import type { PackSummary } from '../lib/api';

export default function PackCard({ pack, viewMode, onOpen }: { pack: PackSummary; viewMode: 'grid'|'dense'|'list'; onOpen: () => void }) {
    const cover = pack.cover_url || pack.cover_urls[0];
    const meta = `${pack.item_count.toLocaleString('fa-IR')} آیتم`;
    if (viewMode === 'list') return <button onClick={onOpen} className="group flex min-h-20 w-full items-center gap-3 rounded-2xl border border-primary-400/15 bg-gradient-to-l from-primary-500/[.09] to-dark-900/80 p-2.5 text-right transition hover:border-primary-400/35 hover:bg-primary-500/[.12]">
        <span className="relative flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-primary-500/15 text-primary-200">{cover?<img src={cover} alt="" className="h-full w-full object-cover" loading="lazy"/>:<Boxes className="h-6 w-6"/>}<span className="absolute bottom-1 right-1 rounded-md bg-black/65 px-1.5 py-0.5 text-[9px] text-white">پک</span></span>
        <span className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm text-white">{pack.name}</strong><small className="mt-1 block text-dark-400">{meta}</small></span>
        <ChevronLeft className="h-4 w-4 shrink-0 text-dark-500 transition group-hover:text-primary-200"/>
    </button>;
    const dense = viewMode === 'dense';
    return <button onClick={onOpen} className={`group relative overflow-hidden border border-primary-400/15 bg-dark-900 text-right shadow-lg transition hover:-translate-y-0.5 hover:border-primary-400/35 ${dense?'rounded-2xl':'rounded-3xl'}`}>
        <span className={`relative flex w-full items-center justify-center overflow-hidden bg-gradient-to-br from-primary-500/20 to-dark-800 ${dense?'aspect-square':'aspect-[4/3]'}`}>{cover?<img src={cover} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy"/>:<Boxes className={`${dense?'h-8 w-8':'h-12 w-12'} text-primary-300/70`}/>}<span className="absolute right-2 top-2 rounded-lg bg-black/65 px-2 py-1 text-[10px] font-bold text-white backdrop-blur">📦 پک</span></span>
        <span className={`block ${dense?'p-2':'p-3'}`}><strong dir="auto" className={`block truncate text-white ${dense?'text-xs':'text-sm'}`}>{pack.name}</strong><small className="mt-1 block text-dark-400">{meta}</small></span>
    </button>;
}
