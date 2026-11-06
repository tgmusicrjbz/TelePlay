import { compactImportTitle, type ImportMetadata, type ImportQuality } from '../lib/importQueue';

const qualityOptions: Array<{ value: ImportQuality; label: string }> = [
    { value: 'audio', label: 'صدا' },
    { value: '480', label: '480p' },
    { value: '720', label: '720p' },
    { value: '1080', label: '1080p' },
];

type Props = {
    links: string[];
    metadata: Record<string, ImportMetadata>;
    loading: boolean;
    defaultQuality: ImportQuality;
    values: Record<string, ImportQuality>;
    onChange: (url: string, value: ImportQuality) => void;
};

export default function YouTubeQualityPicker({ links, metadata, loading, defaultQuality, values, onChange }: Props) {
    if (links.length < 2) return null;
    return (
        <section className="mt-3 overflow-hidden rounded-2xl border border-white/[.08] bg-dark-950/30">
            <header className="flex items-center gap-2 border-b border-white/[.06] px-3 py-2.5">
                <span className="min-w-0 flex-1 text-xs font-semibold text-primary-100">کیفیت هر ویدیو</span>
                {loading && <span className="animate-pulse text-[10px] text-dark-400">دریافت عنوان‌ها…</span>}
                <span className="rounded-full bg-white/[.06] px-2 py-1 text-[10px] text-dark-400">{links.length.toLocaleString('fa-IR')} لینک</span>
            </header>
            <div className="max-h-72 space-y-2 overflow-y-auto p-2.5">
                {links.map((url, index) => {
                    const info = metadata[url];
                    const selected = values[url] || defaultQuality;
                    return (
                        <article key={url} className="rounded-xl border border-white/[.06] bg-white/[.025] p-2.5">
                            <div className="flex min-w-0 items-start gap-2">
                                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary-500/15 text-[10px] font-bold text-primary-200">{(index + 1).toLocaleString('fa-IR')}</span>
                                <div className="min-w-0 flex-1"><strong dir="auto" title={info?.title || url} className="block truncate text-xs">{compactImportTitle(info?.title || 'در حال دریافت عنوان…')}</strong><small dir="auto" className="mt-0.5 block truncate text-[10px] text-dark-500">{info?.author || new URL(url).hostname}</small></div>
                            </div>
                            <div className="mt-2 grid grid-cols-4 gap-1" dir="ltr">{qualityOptions.map(option => <button type="button" key={option.value} onClick={() => onChange(url, option.value)} aria-pressed={selected === option.value} className={`min-h-9 rounded-lg px-1 text-[11px] font-semibold transition ${selected === option.value ? 'bg-primary-500 text-white shadow-sm shadow-primary-500/20' : 'bg-white/[.045] text-dark-300 hover:bg-white/[.08]'}`}>{option.label}</button>)}</div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
