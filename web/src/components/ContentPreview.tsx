import { Fragment, useEffect, useMemo, useState } from 'react';
import { Check, Download, Pencil, X } from 'lucide-react';
import { api, canPreviewText, formatPersianDate } from '../lib/api';
import { useAppStore } from '../lib/store';

export default function ContentPreview() {
    const { previewFile: file, setPreviewFile } = useAppStore();
    const [content, setContent] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const show = !!file && (file.file_type === 'image' || canPreviewText(file));

    useEffect(() => {
        if (!show || !file || file.file_type === 'image') return;
        let cancelled = false;
        setLoading(true);
        setContent('');
        setError('');
        api.get<{ content: string }>(`/files/${file.id}/text`)
            .then(({ data }) => { if (!cancelled) { setContent(data.content); setDraft(data.content); } })
            .catch((err) => { if (!cancelled) setError(err.response?.data?.detail || 'Could not load text.'); })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [file?.id, show]);

    useEffect(() => {
        if (!show) return;
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setPreviewFile(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [show, setPreviewFile]);

    if (!file || !show) return null;
    const token = localStorage.getItem('access_token');
    const url = `${file.stream_url}?token=${encodeURIComponent(token || '')}`;
    const saveText = async () => {
        setSaving(true);
        try {
            const { data } = await api.patch<{ content: string }>(`/files/${file.id}/text`, { content: draft });
            setContent(data.content); setEditing(false);
        } finally { setSaving(false); }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-md p-3 sm:p-8 flex items-center justify-center" onClick={() => setPreviewFile(null)}>
            <section className="w-full max-w-5xl max-h-full flex flex-col rounded-2xl border border-white/10 bg-dark-900 shadow-2xl overflow-hidden" onClick={(event) => event.stopPropagation()}>
                <header className="flex items-center gap-3 px-5 py-4 border-b border-white/10">
                    <div className="flex-1 min-w-0">
                        <h2 className="truncate font-semibold" title={file.file_name}>{file.file_name}</h2>
                        {file.description && <p dir="auto" className="text-sm text-dark-400 mt-1 whitespace-pre-wrap">{file.description}</p>}
                        <p className="text-xs text-dark-500 mt-1">آپلود: {formatPersianDate(file.created_at)} · آخرین تغییر: {formatPersianDate(file.updated_at)}</p>
                    </div>
                    {file.file_type !== 'text' && <a href={`${url}&download=1`} download={file.file_name} className="btn-icon" title="دانلود"><Download className="w-5 h-5" /></a>}
                    {file.file_type === 'text' && <button onClick={() => setEditing(value => !value)} className="btn-icon" title="ویرایش متن"><Pencil className="w-5 h-5" /></button>}
                    <button onClick={() => setPreviewFile(null)} className="btn-icon" title="بستن"><X className="w-5 h-5" /></button>
                </header>
                {file.file_type === 'image' ? (
                    <div className="min-h-0 flex-1 flex items-center justify-center p-4 overflow-auto">
                        <img src={url} alt={file.file_name} className="max-w-full max-h-[75vh] object-contain rounded-lg" />
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
    return text.split(/(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*)/g).map((part, index) => {
        if (part.startsWith('**') || part.startsWith('__')) return <strong key={index}>{part.slice(2, -2)}</strong>;
        if (part.startsWith('`')) return <code key={index} className="rounded bg-white/10 px-1.5 py-0.5 text-primary-200">{part.slice(1, -1)}</code>;
        if (part.startsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
        return <Fragment key={index}>{part}</Fragment>;
    });
}

function MarkdownContent({ content }: { content: string }) {
    const blocks = useMemo(() => {
        const result: JSX.Element[] = []; let code = false; let codeLines: string[] = [];
        content.split(/\r?\n/).forEach((line, index) => {
            if (line.trim().startsWith('```')) { if (code) { result.push(<pre key={`code-${index}`} dir="ltr" className="my-3 overflow-x-auto rounded-xl bg-black/30 p-4 font-mono text-sm leading-7 text-primary-100">{codeLines.join('\n')}</pre>); codeLines = []; } code = !code; return; }
            if (code) { codeLines.push(line); return; }
            if (!line.trim()) { result.push(<div key={`space-${index}`} className="h-3"/>); return; }
            const heading = line.match(/^(#{1,3})\s+(.+)$/); if (heading) { result.push(<h3 key={index} className="mt-5 text-lg font-bold text-white">{inlineMarkdown(heading[2])}</h3>); return; }
            const bullet = line.match(/^\s*[-*]\s+(.+)$/); if (bullet) { result.push(<div key={index} className="flex gap-2 leading-8"><span className="text-primary-300">•</span><span>{inlineMarkdown(bullet[1])}</span></div>); return; }
            result.push(<p key={index} className="whitespace-pre-wrap break-words leading-8">{inlineMarkdown(line)}</p>);
        });
        return result;
    }, [content]);
    return <article dir="auto" className="max-w-3xl text-[15px] text-dark-100">{blocks}</article>;
}
