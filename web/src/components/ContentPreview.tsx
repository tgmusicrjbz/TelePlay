import { Fragment, useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, Pencil, X } from 'lucide-react';
import { api, canPreviewText } from '../lib/api';
import { useAppStore } from '../lib/store';
import { cacheTextFile, getOfflineText, updateOfflineTextDraft } from '../lib/offline';

export default function ContentPreview() {
    const { contentPreviewFile: file, setContentPreviewFile, addToast } = useAppStore();
    const [content, setContent] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [imageFailed, setImageFailed] = useState(false);
    const [imageRetry, setImageRetry] = useState(0);
    const show = !!file && (file.file_type === 'image' || canPreviewText(file));

    useEffect(() => { setImageFailed(false); setImageRetry(0); }, [file?.id]);

    useEffect(() => {
        if (!show || !file || file.file_type === 'image') return;
        let cancelled = false;
        setLoading(true);
        setContent('');
        setError('');
        const loadText = async () => {
            try {
                if (!navigator.onLine) {
                    const cached = await getOfflineText(file.id);
                    if (!cached) throw new Error('این متن هنوز برای استفاده آفلاین ذخیره نشده است.');
                    return cached.content;
                }
                const { data } = await api.get<{ content: string }>(`/files/${file.id}/text`);
                await cacheTextFile(file, data.content);
                return data.content;
            } catch (err) {
                const cached = await getOfflineText(file.id);
                if (cached) return cached.content;
                throw err;
            }
        };
        loadText()
            .then(text => { if (!cancelled) { setContent(text); setDraft(text); } })
            .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'متن بارگذاری نشد.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [file?.id, show]);

    useEffect(() => {
        if (!show) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setContentPreviewFile(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [show, setContentPreviewFile]);

    if (!file || !show) return null;
    const token = localStorage.getItem('access_token');
    const isBlob = file.stream_url.startsWith('blob:');
    const separator = file.stream_url.includes('?') ? '&' : '?';
    const authorizedUrl = isBlob ? file.stream_url : `${file.stream_url}${separator}token=${encodeURIComponent(token || '')}`;
    const url = imageRetry && !isBlob ? `${authorizedUrl}&retry=${imageRetry}` : authorizedUrl;
    const saveText = async () => {
        setSaving(true);
        try {
            if (file.id < 0) {
                await updateOfflineTextDraft(file.id, draft);
                setContent(draft); setEditing(false); addToast('نسخه آفلاین یادداشت ویرایش شد.');
                return;
            }
            const { data } = await api.patch<{ content: string }>(`/files/${file.id}/text`, { content: draft });
            await cacheTextFile(file, data.content);
            setContent(data.content); setEditing(false);
        } finally { setSaving(false); }
    };

    return (
        <div className="fixed inset-0 z-[140] bg-black/85 backdrop-blur-md p-3 sm:p-8 flex items-center justify-center" onClick={() => setContentPreviewFile(null)}>
            <section className="w-full max-w-5xl max-h-full flex flex-col rounded-2xl border border-white/10 bg-dark-900 shadow-2xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
                <header className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
                    <div className="flex-1 min-w-0">
                        <h2 className="truncate font-semibold" title={file.file_name}>{file.file_name}</h2>
                        {file.description && <p dir="auto" className="text-sm text-dark-400 mt-1 whitespace-pre-wrap">{file.description}</p>}
                    </div>
                    {file.file_type !== 'text' && <a href={`${url}&download=1`} download={file.file_name} className="btn-icon" title="دانلود"><Download className="w-5 h-5" /></a>}
                    {file.file_type !== 'image' && <button onClick={async () => { await navigator.clipboard.writeText(editing ? draft : content); addToast('متن کپی شد 📋'); }} className="btn-icon" title="کپی متن"><Copy className="h-5 w-5" /></button>}
                    {file.file_type === 'text' && <button onClick={() => setEditing(value => !value)} className="btn-secondary flex shrink-0 items-center gap-2 px-3 py-2 text-xs" title="ویرایش متن"><Pencil className="h-4 w-4" /><span className="hidden sm:inline">ویرایش متن</span></button>}
                    <button onClick={() => setContentPreviewFile(null)} className="btn-icon" title="بستن"><X className="w-5 h-5" /></button>
                </header>
                {file.file_type === 'image' ? (
                    <div className="min-h-0 flex-1 flex items-center justify-center p-4 overflow-auto">
                        {imageFailed ? <div className="rounded-2xl border border-dashed border-white/10 p-8 text-center"><p className="text-sm text-dark-400">نمایش عکس انجام نشد.</p><button className="btn-secondary mt-4" onClick={() => { setImageFailed(false); setImageRetry(Date.now()); }}>تلاش دوباره</button></div> : <img src={url} alt={file.file_name} className="max-w-full max-h-[75vh] object-contain rounded-lg" onError={() => setImageFailed(true)} />}
                    </div>
                ) : (
                    <div className="min-h-0 overflow-auto p-5 sm:p-8 bg-dark-950/60">
                        {loading ? <p className="text-dark-400">در حال بارگذاری متن…</p> : error ? <p className="text-red-400">{error}</p> : editing ? <div><textarea dir="auto" value={draft} onChange={event => setDraft(event.target.value)} className="min-h-[55vh] w-full resize-y rounded-xl border border-white/10 bg-dark-900 p-4 font-mono text-sm leading-7 text-dark-100 outline-none focus:border-primary-400"/><div className="mt-3 flex justify-end gap-2"><button className="btn-secondary" onClick={() => { setDraft(content); setEditing(false); }}>لغو</button><button disabled={saving} className="btn-primary flex items-center gap-2" onClick={() => void saveText()}><Check className="h-4 w-4"/> {saving ? 'در حال ذخیره…' : 'ذخیره متن'}</button></div></div> : <MarkdownContent content={content} />}
                    </div>
                )}
            </section>
        </div>
    );
}

function inlineMarkdown(text: string) {
    return text.split(/(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|~~[^~]+~~|`[^`]+`|\*[^*]+\*)/g).map((part, index) => {
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/); if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer" className="font-medium text-sky-300 underline decoration-sky-500/40 underline-offset-4 transition hover:text-sky-200">{link[1]}</a>;
        if (part.startsWith('**') || part.startsWith('__')) return <strong key={index} className="font-extrabold text-amber-200">{part.slice(2, -2)}</strong>;
        if (part.startsWith('~~')) return <del key={index} className="text-rose-300/70 decoration-rose-400/70">{part.slice(2, -2)}</del>;
        if (part.startsWith('`')) return <code key={index} dir="ltr" className="mx-0.5 rounded-md border border-cyan-400/15 bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[.9em] text-cyan-200">{part.slice(1, -1)}</code>;
        if (part.startsWith('*')) return <em key={index} className="text-violet-200">{part.slice(1, -1)}</em>;
        return <Fragment key={index}>{part}</Fragment>;
    });
}

function MarkdownCodeBlock({ code, language }: { code: string; language?: string }) {
    const [copied, setCopied] = useState(false);
    const copy = async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
    };
    return <div dir="ltr" className="my-5 min-w-0 max-w-full overflow-hidden rounded-2xl border border-cyan-400/15 bg-[#071018] shadow-[0_16px_45px_rgba(0,0,0,.25)]">
        <div className="grid min-w-0 grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-white/[.06] bg-white/[.035] px-3 py-2">
            <div className="flex items-center gap-1.5" aria-hidden="true"><span className="h-2.5 w-2.5 rounded-full bg-rose-400/80"/><span className="h-2.5 w-2.5 rounded-full bg-amber-300/80"/><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80"/></div>
            <span className="min-w-0 truncate text-center font-mono text-[11px] uppercase tracking-wider text-cyan-200/70">{language || 'code'}</span>
            <button dir="rtl" onClick={() => void copy()} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-dark-300 transition hover:bg-white/[.06] hover:text-white"><Copy className="h-3.5 w-3.5"/>{copied ? 'کپی شد' : 'کپی'}</button>
        </div>
        <div className="max-w-full overflow-x-auto overscroll-x-contain">
            <pre className="m-0 w-max min-w-full whitespace-pre p-4 text-left font-mono text-sm leading-7 text-cyan-100 selection:bg-cyan-400/25" style={{ tabSize: 4 }}><code className="block">{code}</code></pre>
        </div>
    </div>;
}

function MarkdownContent({ content }: { content: string }) {
    const blocks = useMemo(() => {
        const result: JSX.Element[] = []; let code = false; let codeLines: string[] = []; let language = '';
        content.split(/\r?\n/).forEach((line, index) => {
            if (line.trim().startsWith('```')) { if (code) { result.push(<MarkdownCodeBlock key={`code-${index}`} code={codeLines.join('\n')} language={language}/>); codeLines = []; language = ''; } else language = line.trim().slice(3).trim(); code = !code; return; }
            if (code) { codeLines.push(line); return; }
            if (!line.trim()) { result.push(<div key={`space-${index}`} className="h-3"/>); return; }
            if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) { result.push(<div key={index} className="my-7 h-px bg-gradient-to-r from-transparent via-primary-400/45 to-transparent"/>); return; }
            const heading = line.match(/^(#{1,6})\s+(.+)$/); if (heading) { const level = heading[1].length; const Tag = `h${level}` as keyof JSX.IntrinsicElements; const tone = level === 1 ? 'text-primary-200' : level === 2 ? 'text-sky-200' : level === 3 ? 'text-violet-200' : 'text-emerald-200'; result.push(<Tag key={index} className={`${level === 1 ? 'text-3xl' : level === 2 ? 'text-2xl' : level === 3 ? 'text-xl' : 'text-lg'} ${tone} mb-2 mt-7 border-b border-white/[.05] pb-2 font-black leading-tight`}>{inlineMarkdown(heading[2])}</Tag>); return; }
            const quote = line.match(/^>\s?(.+)$/); if (quote) { result.push(<blockquote key={index} className="my-3 rounded-l-xl border-r-4 border-violet-400/60 bg-violet-400/[.07] px-4 py-2 italic leading-8 text-violet-100/90">{inlineMarkdown(quote[1])}</blockquote>); return; }
            const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/); if (task) { const checked = task[1].toLowerCase() === 'x'; result.push(<div key={index} className="flex items-start gap-2 leading-8"><span className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs ${checked ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300' : 'border-white/15 text-transparent'}`}>✓</span><span className={checked ? 'text-dark-400 line-through' : ''}>{inlineMarkdown(task[2])}</span></div>); return; }
            const bullet = line.match(/^\s*[-*]\s+(.+)$/); if (bullet) { result.push(<div key={index} className="flex items-start gap-2 leading-8"><span className="mt-0.5 text-lg text-primary-300">•</span><span>{inlineMarkdown(bullet[1])}</span></div>); return; }
            const ordered = line.match(/^\s*(\d+)\.\s+(.+)$/); if (ordered) { result.push(<div key={index} className="flex items-start gap-2 leading-8"><span className="mt-1 flex min-w-6 items-center justify-center rounded-md bg-primary-400/10 px-1 text-xs font-bold text-primary-200">{Number(ordered[1]).toLocaleString('fa-IR')}</span><span>{inlineMarkdown(ordered[2])}</span></div>); return; }
            result.push(<p key={index} className="whitespace-pre-wrap break-words leading-8 text-dark-100">{inlineMarkdown(line)}</p>);
        });
        if (codeLines.length) result.push(<MarkdownCodeBlock key="code-final" code={codeLines.join('\n')} language={language}/>);
        return result;
    }, [content]);
    return <article dir="auto" className="mx-auto max-w-3xl rounded-2xl border border-white/[.04] bg-dark-900/35 p-4 text-[15px] text-dark-100 shadow-inner sm:p-6">{blocks}</article>;
}
