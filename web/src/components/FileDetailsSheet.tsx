import { CalendarDays, Clock3, FileType2, Folder, HardDrive, Info, X } from 'lucide-react';
import { Folder as FolderType, formatDuration, formatFileSize, formatPersianDate, useFolderTree } from '../lib/api';
import { useAppStore } from '../lib/store';

const labels = { video: 'ویدیو', audio: 'صوت و موسیقی', image: 'تصویر', document: 'سند', text: 'متن و یادداشت' };

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
            {file.mime_type && <p className="mt-3 text-center font-mono text-[11px] text-dark-500" dir="ltr">{file.mime_type}</p>}
        </section>
    </div>;
}
