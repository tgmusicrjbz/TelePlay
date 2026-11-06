import { ChevronUp, Eye, Minus, Upload, X } from 'lucide-react';

export type UploadPanelMode = 'open' | 'collapsed' | 'hidden';
export type UploadProgress = {
    name: string;
    index: number;
    total: number;
    percent: number;
    phase: 'uploading' | 'processing';
};

type Props = {
    progress: UploadProgress | null;
    mode: UploadPanelMode;
    onModeChange: (mode: UploadPanelMode) => void;
    onCancel: () => void;
};

export default function UploadProgressPanel({ progress, mode, onModeChange, onCancel }: Props) {
    if (!progress || mode === 'hidden') return null;
    const percent = Math.min(100, Math.max(0, progress.percent));
    const processing = progress.phase === 'processing';

    if (mode === 'collapsed') {
        return (
            <button onClick={() => onModeChange('open')} className="fixed bottom-24 left-3 z-[175] flex h-12 items-center gap-2 rounded-full border border-primary-500/25 bg-dark-900/95 px-3 text-xs shadow-2xl backdrop-blur-xl" title="نمایش جزئیات آپلود">
                <Upload className="h-4 w-4 animate-pulse text-primary-300" />
                <span>{progress.index.toLocaleString('fa-IR')}/{progress.total.toLocaleString('fa-IR')}</span>
                <span dir="ltr" className="font-bold text-primary-200">{processing ? '…' : `${percent}%`}</span>
                <ChevronUp className="h-3.5 w-3.5" />
            </button>
        );
    }

    return (
        <section aria-label="وضعیت آپلود" className="fixed bottom-24 left-4 right-4 z-[175] mx-auto max-w-md rounded-2xl border border-primary-500/25 bg-dark-900/95 p-3 shadow-2xl backdrop-blur-xl">
            <div className="flex items-center gap-3">
                <Upload className="h-5 w-5 text-primary-300" />
                <div className="min-w-0 flex-1">
                    <div className="flex justify-between gap-2 text-xs"><span className="truncate">{progress.name}</span><span dir="ltr">{progress.index}/{progress.total} · {processing ? '…' : `${percent}%`}</span></div>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-dark-700" role="progressbar" aria-label="پیشرفت آپلود" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}><div className="h-full rounded-full bg-primary-500 transition-[width]" style={{ width: `${percent}%` }} /></div>
                    <p className="mt-1 text-[10px] text-dark-500">{processing ? 'ارسال تمام شد؛ در حال ذخیره نهایی…' : 'در حال ارسال فایل جاری'}</p>
                </div>
                <button className="btn-icon h-8 w-8" onClick={() => onModeChange('collapsed')} title="نمایش خیلی کوچک"><Minus className="h-4 w-4" /></button>
                <button className="btn-icon h-8 w-8" onClick={() => onModeChange('hidden')} title="بستن وضعیت"><Eye className="h-4 w-4" /></button>
                <button onClick={onCancel} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-300 hover:bg-red-500/20" title="لغو آپلود"><X className="h-4 w-4" /></button>
            </div>
        </section>
    );
}
