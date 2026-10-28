import { useEffect, useState } from 'react';
import { CalendarDays, Clock3, FileType2, Folder, HardDrive, Hash, Info, Save } from 'lucide-react';
import { Folder as FolderType, formatDuration, formatFileSize, formatPersianDate, useFolderTree, useUpdateFile } from '../lib/api';
import { useAppStore } from '../lib/store';
import TagChips, { getTagPresets } from './TagChips';
import ModalShell from './ModalShell';

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
    const [tagsText, setTagsText] = useState('');
    useEffect(() => setTagsText((file?.tags || []).join('، ')), [file?.id, file?.tags]);
    if (!file) return null;
    const folder = file.folder_id ? findFolder(folders, file.folder_id) : null;
    const rows = [
        [FileType2, 'نوع فایل', labels[file.file_type]],
        [HardDrive, 'حجم دقیق', `${formatFileSize(file.file_size)} · ${file.file_size.toLocaleString('fa-IR')} بایت`],
        [CalendarDays, 'تاریخ ایجاد', formatPersianDate(file.created_at)],
        [CalendarDays, 'آخرین ویرایش', formatPersianDate(file.updated_at)],
        [Clock3, 'مدت‌زمان', file.duration ? formatDuration(file.duration) : 'ندارد'],
        [Folder, 'کشوی والد', folder?.name || (file.folder_id ? 'کشوی ناشناخته' : 'بیرون از کشو')],
    ] as const;
    return <ModalShell title="جزئیات فایل" subtitle={file.file_name} icon={<Info/>} onClose={()=>setDetailsFile(null)} width="lg" zIndex={190}>
            <div className="divide-y divide-white/[.06] overflow-hidden rounded-2xl border border-white/[.07] bg-dark-800/45">{rows.map(([Icon, label, value]) => <div key={label} className="flex items-center gap-3 px-4 py-3.5"><Icon className="h-4 w-4 shrink-0 text-primary-300"/><span className="text-xs text-dark-400">{label}</span><strong dir="auto" className="mr-auto max-w-[58%] text-left text-sm font-medium text-dark-100">{value}</strong></div>)}</div>
            <div className="mt-3 rounded-2xl border border-white/[.07] bg-dark-800/45 p-3"><label className="flex items-center gap-2 text-xs text-dark-300"><Hash className="h-4 w-4 text-primary-300"/>تگ‌ها</label><TagChips tags={file.tags} editable/><div className="mt-2 flex gap-2"><input value={tagsText} onChange={event=>setTagsText(event.target.value)} className="input min-w-0 flex-1" placeholder="تگ‌ها را وارد کن"/><button disabled={updateFile.isPending} className="btn-secondary flex h-11 w-11 items-center justify-center" title="ذخیره تگ‌ها" onClick={async()=>{const tags=tagsText.split(/[،,\n]+/).map(tag=>tag.trim().replace(/^#/, '')).filter(Boolean);const updated=await updateFile.mutateAsync({id:file.id,tags});setDetailsFile(updated);}}><Save className="h-4 w-4"/></button></div><div className="mt-2 flex flex-wrap gap-1">{getTagPresets().slice(0,8).map(tag=><button key={tag} onClick={()=>{const current=tagsText.split(/[،,\n]+/).map(item=>item.trim()).filter(Boolean);if(!current.includes(tag))setTagsText([...current,tag].join('، '));}} className="rounded-full border border-white/[.08] bg-white/[.035] px-2.5 py-1 text-[10px] text-dark-300 hover:border-primary-400/30 hover:text-primary-200">+ {tag}</button>)}</div></div>
            {file.mime_type && <p className="mt-3 text-center font-mono text-[11px] text-dark-500" dir="ltr">{file.mime_type}</p>}
    </ModalShell>;
}
