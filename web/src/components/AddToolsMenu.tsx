import { createPortal } from 'react-dom';
import { AudioLines, Cloud, FileAudio, FolderPlus, Link2, StickyNote, Upload, UsersRound, X } from 'lucide-react';

type Props = {
    open: boolean;
    onClose: () => void;
    onUpload: () => void;
    onCreateText: () => void;
    onCreateFolder: () => void;
    onImportLink: () => void;
    onImportDrive: () => void;
    onOpenTTS: () => void;
    onOpenSTT: () => void;
    onWatchTogether: () => void;
};

export default function AddToolsMenu({ open, onClose, onUpload, onCreateText, onCreateFolder, onImportLink, onImportDrive, onOpenTTS, onOpenSTT, onWatchTogether }: Props) {
    if (!open) return null;
    const items = [
        { label: 'آپلود فایل', icon: <Upload className="h-5 w-5" />, action: onUpload },
        { label: 'یادداشت متنی', icon: <StickyNote className="h-5 w-5" />, action: onCreateText },
        { label: 'ساخت کشو', icon: <FolderPlus className="h-5 w-5" />, action: onCreateFolder },
        { label: 'ذخیره از لینک', icon: <Link2 className="h-5 w-5" />, action: onImportLink },
        { label: 'از گوگل درایو', icon: <Cloud className="h-5 w-5" />, action: onImportDrive },
        { label: 'ساخت صدا از متن', icon: <AudioLines className="h-5 w-5" />, action: onOpenTTS },
        { label: 'استخراج متن از صدا', icon: <FileAudio className="h-5 w-5" />, action: onOpenSTT },
        { label: 'هم‌پخش', icon: <UsersRound className="h-5 w-5" />, action: onWatchTogether },
    ];
    return createPortal(
        <div className="fixed inset-0 z-[260] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-5" onClick={onClose}>
            <section role="dialog" aria-modal="true" aria-label="افزودن و ابزارها" className="max-h-[min(86vh,42rem)] w-full max-w-md overflow-y-auto rounded-t-3xl border border-white/10 bg-dark-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl" onClick={event => event.stopPropagation()}>
                <div className="mx-auto mb-4 h-1 w-12 rounded-full bg-white/20 sm:hidden" />
                <div className="flex items-center justify-between"><h2 className="font-bold">افزودن و ابزارها</h2><button className="btn-icon" onClick={onClose} title="بستن"><X className="h-5 w-5" /></button></div>
                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-1">{items.map(item => <button key={item.label} className="flex min-h-16 items-center gap-3 rounded-2xl border border-white/[.07] bg-dark-800/60 px-3 text-right text-sm transition hover:border-primary-400/20 hover:bg-primary-500/[.07] sm:min-h-14" onClick={() => { onClose(); item.action(); }}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-300">{item.icon}</span><span>{item.label}</span></button>)}</div>
            </section>
        </div>,
        document.body,
    );
}
