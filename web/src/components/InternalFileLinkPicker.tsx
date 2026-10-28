import { ChevronLeft, ChevronRight, File, FileImage, FileText, Film, Headphones, Link2, Loader2, Search } from 'lucide-react';
import { TelegramFile, useFiles } from '../lib/api';
import { useEffect, useState } from 'react';
import ModalShell from './ModalShell';

const fileTypes = [
    {value:'',label:'همه',Icon:File},
    {value:'text',label:'متن',Icon:FileText},
    {value:'image',label:'عکس',Icon:FileImage},
    {value:'audio',label:'صدا',Icon:Headphones},
    {value:'video',label:'ویدیو',Icon:Film},
    {value:'document',label:'فایل',Icon:File},
];

export default function InternalFileLinkPicker({ onClose, onSelect }: { onClose: () => void; onSelect: (file: TelegramFile) => void }) {
    const [query, setQuery] = useState('');
    const [type,setType]=useState('');
    const [page,setPage]=useState(1);
    const { data, isLoading } = useFiles(undefined, type || undefined, query.trim() || undefined, page, 'updated:desc');
    useEffect(()=>setPage(1),[query,type]);
    return <ModalShell title="پیوند به فایل کمد" subtitle="این پیوند با جابه‌جایی فایل از بین نمی‌رود." icon={<Link2/>} width="lg" zIndex={300} onClose={onClose} bodyClassName="!p-0">
            <label className="relative m-3 mb-0 block"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-500"/><input autoFocus dir="auto" className="input w-full !pr-10 text-right" value={query} onChange={event=>setQuery(event.target.value)} placeholder="نام فایل یا توضیحات را جست‌وجو کن"/></label>
            <div className="flex shrink-0 gap-1.5 overflow-x-auto px-3 pt-3 pb-1">{fileTypes.map(({value,label,Icon})=><button type="button" key={value||'all'} onClick={()=>setType(value)} className={`flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs transition ${type===value?'bg-primary-500 text-white':'bg-white/[.045] text-dark-300 hover:bg-white/[.08]'}`}><Icon className="h-3.5 w-3.5"/>{label}</button>)}</div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                {isLoading?<div className="flex items-center justify-center gap-2 py-12 text-sm text-dark-400"><Loader2 className="h-4 w-4 animate-spin"/>در حال دریافت فایل‌ها…</div>:(data?.files||[]).length?(data?.files||[]).map(file=><button type="button" key={file.id} onClick={()=>onSelect(file)} className="mb-2 flex w-full items-center gap-3 rounded-2xl border border-white/[.06] bg-white/[.025] p-3 text-right transition hover:border-primary-400/25 hover:bg-primary-500/[.06]"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[.05] text-dark-300"><File className="h-4 w-4"/></span><span className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm">{file.file_name}</strong><small className="text-dark-500">{file.file_type==='audio'?'صدا':file.file_type==='video'?'ویدیو':file.file_type==='image'?'عکس':file.file_type==='text'?'متن':'فایل'}</small></span><Link2 className="h-4 w-4 shrink-0 text-primary-300"/></button>):<p className="py-12 text-center text-sm text-dark-500">فایلی پیدا نشد.</p>}
            </div>
            {data&&data.total>data.per_page&&<footer className="flex shrink-0 items-center justify-center gap-3 border-t border-white/[.07] p-3"><button type="button" disabled={page<=1} onClick={()=>setPage(value=>value-1)} className="btn-icon disabled:opacity-25"><ChevronRight className="h-4 w-4"/></button><span className="text-xs text-dark-400">صفحه {page.toLocaleString('fa-IR')} از {Math.ceil(data.total/data.per_page).toLocaleString('fa-IR')}</span><button type="button" disabled={page*data.per_page>=data.total} onClick={()=>setPage(value=>value+1)} className="btn-icon disabled:opacity-25"><ChevronLeft className="h-4 w-4"/></button></footer>}
    </ModalShell>;
}
