import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronUp, DownloadCloud, ListMusic, Minus, X } from 'lucide-react';
import { OFFLINE_PROGRESS_EVENT, OfflineJobProgress } from '../lib/offline';

export default function OfflineDownloadProgressPanel() {
    const [jobs, setJobs] = useState<Record<string, OfflineJobProgress>>({});
    const [collapsed, setCollapsed] = useState(false);
    useEffect(() => {
        const update = (event: Event) => {
            const job = (event as CustomEvent<OfflineJobProgress>).detail;
            setJobs(previous => ({ ...previous, [job.id]: job }));
            if (job.state !== 'downloading') window.setTimeout(() => setJobs(previous => { const next = { ...previous }; delete next[job.id]; return next; }), 3500);
        };
        window.addEventListener(OFFLINE_PROGRESS_EVENT, update);
        return () => window.removeEventListener(OFFLINE_PROGRESS_EVENT, update);
    }, []);
    const visible = Object.values(jobs);
    if (!visible.length) return null;
    const active = visible.find(job => job.state === 'downloading') || visible[visible.length - 1];
    const queued = Math.max(0, visible.filter(job => job.state === 'downloading').length - 1);
    return <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-[175] mx-auto max-w-lg md:bottom-4 md:left-5 md:right-auto md:w-[25rem]" dir="rtl">
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-dark-900/95 shadow-2xl backdrop-blur-xl">
            <div className="flex min-h-12 items-center gap-2 border-b border-white/[.06] px-3">
                <DownloadCloud className="h-4 w-4 text-primary-300"/>
                <strong className="min-w-0 flex-1 text-sm">دانلودهای آفلاین</strong>
                {queued > 0 && <span className="rounded-full bg-primary-500/15 px-2 py-0.5 text-[10px] text-primary-200">{queued.toLocaleString('fa-IR')} در صف</span>}
                <button className="btn-icon h-8 w-8" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? 'نمایش دانلودها' : 'کوچک کردن'}>{collapsed ? <ChevronUp className="h-4 w-4"/> : <Minus className="h-4 w-4"/>}</button>
                <button className="btn-icon h-8 w-8" onClick={() => setJobs({})} aria-label="پنهان کردن"><X className="h-4 w-4"/></button>
            </div>
            {collapsed ? <CompactJob job={active}/> : <div className="max-h-64 space-y-1 overflow-y-auto p-2">{visible.map(job => {
        const percent = job.size > 0 ? Math.min(100, job.loaded / job.size * 100) : job.total ? Math.min(100, job.done / job.total * 100) : 2;
        return <div key={job.id} className="rounded-xl bg-white/[.025] p-2.5"><div className="flex items-center gap-2"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${job.state === 'done' ? 'bg-emerald-500/15 text-emerald-300' : job.state === 'error' ? 'bg-red-500/15 text-red-300' : 'bg-primary-500/15 text-primary-300'}`}>{job.state === 'done' ? <Check className="h-4 w-4"/> : job.state === 'error' ? <X className="h-4 w-4"/> : job.kind === 'playlist' ? <ListMusic className="h-4 w-4"/> : <DownloadCloud className="h-4 w-4 animate-pulse"/>}</span><div className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-xs">{job.title}</strong><p className="truncate text-[10px] text-dark-400">{job.state === 'done' ? 'آماده شد' : job.state === 'error' ? 'ناموفق' : job.kind === 'playlist' ? `${job.done.toLocaleString('fa-IR')} از ${job.total.toLocaleString('fa-IR')} · ${job.currentName}` : job.currentName}</p></div>{job.state === 'downloading' && <span className="text-[10px] font-bold text-primary-200">{Math.round(percent).toLocaleString('fa-IR')}٪</span>}</div><div className="mt-1.5 h-1 overflow-hidden rounded-full bg-dark-950"><div className={`h-full rounded-full transition-[width] duration-200 ${job.state === 'error' ? 'bg-red-500' : job.state === 'done' ? 'bg-emerald-500' : 'bg-primary-500'}`} style={{width:`${job.state === 'done' ? 100 : percent}%`}}/></div></div>;
    })}</div>}
        </section>
    </div>;
}

function CompactJob({ job }: { job: OfflineJobProgress }) {
    const percent = job.size > 0 ? Math.min(100, job.loaded / job.size * 100) : job.total ? Math.min(100, job.done / job.total * 100) : 2;
    return <div className="flex items-center gap-2 px-3 py-2"><span className="min-w-0 flex-1 truncate text-xs text-dark-300">{job.currentName || job.title}</span><span className="text-[10px] font-bold text-primary-200">{Math.round(percent).toLocaleString('fa-IR')}٪</span><ChevronDown className="h-3.5 w-3.5 text-dark-500"/></div>;
}
