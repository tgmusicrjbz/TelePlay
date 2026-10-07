import { useEffect, useState } from 'react';
import { CalendarDays, Clock3, FileType2, Folder, HardDrive, Hash, Info, Save, X } from 'lucide-react';
import { Folder as FolderType, formatDuration, formatFileSize, formatPersianDate, useFolderTree, useUpdateFile } from '../lib/api';
import { useAppStore } from '../lib/store';

const labels = { video: 'ویدیو', audio: 'صدا و موسیقی', image: 'تصویر', document: 'سند', text: 'متن و یادداشت' };

function findFolder(items: FolderType[], id: number): FolderType | null {
    for (const item of items) {
        if (item.id === id) return item;
        const child = findFolder(item.children || [], id);
        if (child) return child;
    }
    return null;
}

export default function FileDetailsSheet() {
    const { detailsFile: file, setDetailsFile } = useAppStore();
    const { data: folders = [] } = useFolderTree();
    const updateFile = useUpdateFile();
    const [tagsText,setTagsText]=useState('');
    useEffect(()=>setTagsText((file?.tags||[]).join('، ')),[file?.id,file?.tags]);
    if (!file) return null;
    const folder = file.folder_id ? findFolder(folders, file.folder_id) : null;
    const rows = [
        [FileType2, 'نوع فایل', labels[file.file_type]],
        [HardDrive, 'حجم دقیق', `${formatFileSize(file.file_size)} · ${file.file_size.toLocaleString('fa-IR')} بایت`],
        [CalendarDays, 'تاریخ ایجاد', formatPersianDate(file.created_at)],
        [CalendarDays, 'آخرین ویرایش', formatPersianDate(file.updated_at)],
        [Clock3, 'مدت‌زمان', file.duration ? formatDuration(file.duration) : 'ندارد'],
        [Folder, 'کشوی والد', folder?.name || (file.folder_id ? 'کشوی حذف‌شده یا ناشناخته' : 'بیرون از کشو')],
    ] as const;
    return <div className="fixed inset-0 z-[170] flex items-end bg-black/65 backdrop-blur-sm" onClick={() => setDetailsFile(null)}>
        <section className="mx-auto w-full max-w-xl rounded-t-3xl border border-white/10 bg-dark-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl animate-slide-up" onClick={event => event.stopPropagation()}>
            <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-white/20"/>
            <header className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/15 text-primary-200"><Info className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="font-bold">جزئیات فایل</h2><p dir="auto" className="mt-0.5 truncate text-xs text-dark-400">{file.file_name}</p></div><button className="btn-icon" onClick={() => setDetailsFile(null)} aria-label="بستن"><X className="h-5 w-5"/></button></header>
            <div className="mt-5 divide-y divide-white/[.06] overflow-hidden rounded-2xl border border-white/[.07] bg-dark-800/45">{rows.map(([Icon, label, value]) => <div key={label} className="flex items-center gap-3 px-4 py-3.5"><Icon className="h-4 w-4 shrink-0 text-primary-300"/><span className="text-xs text-dark-400">{label}</span><strong dir="auto" className="mr-auto max-w-[58%] text-left text-sm font-medium text-dark-100">{value}</strong></div>)}</div>
            <div className="mt-3 rounded-2xl border border-white/[.07] bg-dark-800/45 p-3"><label className="flex items-center gap-2 text-xs text-dark-300"><Hash className="h-4 w-4 text-primary-300"/> تگ‌ها</label><div className="mt-2 flex gap-2"><input value={tagsText} onChange={event=>setTagsText(event.target.value)} className="input min-w-0 flex-1" placeholder="مثلاً آموزش، موسیقی، مهم"/><button disabled={updateFile.isPending} className="btn-secondary flex h-11 w-11 items-center justify-center" title="ذخیره تگ‌ها" onClick={async()=>{const tags=tagsText.split(/[،,\n]+/).map(tag=>tag.trim()).filter(Boolean);const updated=await updateFile.mutateAsync({id:file.id,tags});setDetailsFile(updated);}}><Save className="h-4 w-4"/></button></div><p className="mt-2 text-[10px] text-dark-500">تگ‌ها با ویرگول جدا می‌شوند و در جست‌وجوی کمد هم پیدا می‌شوند.</p></div>
            {file.mime_type && <p className="mt-3 text-center font-mono text-[11px] text-dark-500" dir="ltr">{file.mime_type}</p>}
        </section>
    </div>;
}
