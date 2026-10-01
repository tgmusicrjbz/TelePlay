import { useEffect, useState } from 'react';
import { Check, DownloadCloud, ListMusic, X } from 'lucide-react';
import { formatFileSize } from '../lib/api';
import { OFFLINE_PROGRESS_EVENT, OfflineJobProgress } from '../lib/offline';

export default function OfflineDownloadProgressPanel() {
    const [jobs, setJobs] = useState<Record<string, OfflineJobProgress>>({});
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
    return <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-[175] mx-auto flex max-w-lg flex-col gap-2 md:bottom-4 md:left-5 md:right-auto md:w-[25rem]" dir="rtl">{visible.map(job => {
        const percent = job.size > 0 ? Math.min(100, job.loaded / job.size * 100) : job.total ? Math.min(100, job.done / job.total * 100) : 2;
        return <section key={job.id} className="overflow-hidden rounded-2xl border border-white/10 bg-dark-900/95 p-3 shadow-2xl backdrop-blur-xl"><div className="flex items-center gap-3"><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${job.state === 'done' ? 'bg-emerald-500/15 text-emerald-300' : job.state === 'error' ? 'bg-red-500/15 text-red-300' : 'bg-primary-500/15 text-primary-300'}`}>{job.state === 'done' ? <Check className="h-5 w-5"/> : job.state === 'error' ? <X className="h-5 w-5"/> : job.kind === 'playlist' ? <ListMusic className="h-5 w-5"/> : <DownloadCloud className="h-5 w-5 animate-pulse"/>}</span><div className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm">{job.title}</strong><p className="mt-0.5 truncate text-[11px] text-dark-400">{job.state === 'done' ? (job.failed ? `آماده شد؛ ${job.failed.toLocaleString('fa-IR')} فایل رد شد` : 'برای استفاده آفلاین آماده شد') : job.state === 'error' ? 'دانلود انجام نشد' : job.kind === 'playlist' ? `${job.done.toLocaleString('fa-IR')} از ${job.total.toLocaleString('fa-IR')} · ${job.currentName}` : job.currentName}</p></div>{job.state === 'downloading' && <span className="shrink-0 rounded-lg bg-white/[.06] px-2 py-1 text-[11px] font-bold text-primary-200">{Math.round(percent).toLocaleString('fa-IR')}٪</span>}</div><div className="mt-2 flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-dark-950"><div className={`h-full rounded-full transition-[width] duration-200 ${job.state === 'error' ? 'bg-red-500' : job.state === 'done' ? 'bg-emerald-500' : 'bg-primary-500'}`} style={{width:`${job.state === 'done' ? 100 : percent}%`}}/></div>{job.size > 0 && job.state === 'downloading' && <span className="shrink-0 text-[10px] text-dark-500">{formatFileSize(Math.min(job.loaded, job.size))} / {formatFileSize(job.size)}</span>}</div></section>;
    })}</div>;
}
