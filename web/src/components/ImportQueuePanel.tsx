import { ChevronDown, ChevronUp, Link2, RefreshCw, Square, Trash2, X } from 'lucide-react';
import { importSourceLabel, type ImportStatus } from '../lib/importQueue';

export type ImportPanelMode = 'open' | 'collapsed' | 'hidden';
type ImportJobAction = 'retry' | 'cancel';

const activeStates = new Set<ImportStatus['state']>(['queued', 'downloading', 'saving', 'paused']);
const stateLabels: Record<ImportStatus['state'], string> = {
    queued: 'در صف',
    downloading: 'در حال دریافت',
    saving: 'در حال ذخیره',
    paused: 'متوقف',
    cancelled: 'لغو شد',
    done: 'آماده شد',
    error: 'ناموفق',
};

type Props = {
    jobs: ImportStatus[];
    mode: ImportPanelMode;
    onModeChange: (mode: ImportPanelMode) => void;
    onCancelAll: () => void;
    onClearFinished: () => void;
    onControl: (jobId: string, action: ImportJobAction) => void;
};

export default function ImportQueuePanel({ jobs, mode, onModeChange, onCancelAll, onClearFinished, onControl }: Props) {
    if (!jobs.length || mode === 'hidden') return null;
    const activeCount = jobs.filter(job => activeStates.has(job.state)).length;

    if (mode === 'collapsed') {
        return (
            <button onClick={() => onModeChange('open')} className="fixed bottom-24 left-3 z-[174] flex h-12 items-center gap-2 rounded-full border border-white/10 bg-dark-900/95 px-3 text-xs shadow-2xl backdrop-blur-xl" title="نمایش صف لینک‌ها">
                <Link2 className="h-4 w-4 animate-pulse text-primary-300" />
                <span>{activeCount.toLocaleString('fa-IR')} فعال</span>
                <ChevronUp className="h-3.5 w-3.5" />
            </button>
        );
    }

    return (
        <section aria-label="صف انتقال به کمد" className="fixed bottom-24 left-3 z-[174] w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-white/10 bg-dark-900/95 shadow-2xl backdrop-blur-xl">
            <header className="flex min-h-11 items-center gap-1 border-b border-white/[.06] px-2.5">
                <Link2 className="h-4 w-4 shrink-0 text-primary-300" />
                <strong className="min-w-0 flex-1 truncate text-sm">صف انتقال به کمد</strong>
                {activeCount > 0 && <button className="btn-icon h-8 w-8 text-red-300" onClick={onCancelAll} title="لغو همه موارد صف"><Square className="h-4 w-4" /></button>}
                <button className="btn-icon h-8 w-8" onClick={onClearFinished} title="پاک‌کردن موارد پایان‌یافته"><Trash2 className="h-4 w-4" /></button>
                <button className="btn-icon h-8 w-8" onClick={() => onModeChange('collapsed')} title="جمع‌کردن وضعیت"><ChevronDown className="h-4 w-4" /></button>
                <button className="btn-icon h-8 w-8" onClick={() => onModeChange('hidden')} title="پنهان‌کردن وضعیت"><X className="h-4 w-4" /></button>
            </header>
            <div className="max-h-52 divide-y divide-white/[.05] overflow-y-auto px-2">
                {jobs.map(job => {
                    const progress = Math.min(100, Math.max(0, job.progress ?? 0));
                    return (
                        <article key={job.id} className="py-2">
                            <div className="flex items-center gap-2">
                                <span className={`h-2 w-2 shrink-0 rounded-full ${job.state === 'done' ? 'bg-emerald-400' : job.state === 'error' || job.state === 'cancelled' ? 'bg-red-400' : job.state === 'paused' ? 'bg-amber-400' : 'animate-pulse bg-primary-400'}`} />
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2">
                                        <strong className="min-w-0 flex-1 truncate text-xs">{importSourceLabel(job)}</strong>
                                        <span className="shrink-0 text-[10px] text-dark-500">{stateLabels[job.state]}</span>
                                    </div>
                                    <div className="mt-1 flex items-center gap-2">
                                        <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-dark-950"><div className={`h-full rounded-full transition-[width] ${job.state === 'error' ? 'bg-red-500' : 'bg-primary-500'}`} style={{ width: `${Math.max(2, progress)}%` }} /></div>
                                        <span className="w-8 shrink-0 text-left text-[10px] font-bold text-primary-300">{progress.toLocaleString('fa-IR')}٪</span>
                                    </div>
                                    <p className="mt-1 truncate text-[10px] text-dark-500">{job.message}</p>
                                </div>
                                {job.source === 'link' && ['error', 'cancelled'].includes(job.state) && <button className="btn-icon h-8 w-8 text-primary-200" title="تلاش دوباره" onClick={() => onControl(job.id, 'retry')}><RefreshCw className="h-3.5 w-3.5" /></button>}
                                {activeStates.has(job.state) && <button className="btn-icon h-8 w-8 text-red-300" onClick={() => onControl(job.id, 'cancel')} title="لغو"><X className="h-3.5 w-3.5" /></button>}
                            </div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
