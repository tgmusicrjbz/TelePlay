import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Check, Code2, Copy, Download, Heading1, Image as ImageIcon, Italic, Link, List, ListChecks, ListOrdered, Maximize2, Minimize2, Minus, Moon, Pencil, Plus, Quote, Strikethrough, Sun, Table2, Underline, WrapText, X, ZoomIn, ZoomOut } from 'lucide-react';
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
    const [imageScale, setImageScale] = useState(1);
    const [imageDescriptionExpanded, setImageDescriptionExpanded] = useState(false);
    const [readerFullscreen, setReaderFullscreen] = useState(false);
    const [readerFontSize, setReaderFontSize] = useState(() => Number(localStorage.getItem('komod-reader-font-size')) || 16);
    const [readerLineHeight, setReaderLineHeight] = useState(() => Number(localStorage.getItem('komod-reader-line-height')) || 2);
    const [readerTone, setReaderTone] = useState<'dark' | 'warm'>(() => localStorage.getItem('komod-reader-tone') === 'warm' ? 'warm' : 'dark');
    const [readerWrap, setReaderWrap] = useState(() => localStorage.getItem('komod-reader-wrap') !== 'off');
    const [readerAlign, setReaderAlign] = useState<'right' | 'left' | 'center' | 'justify'>(() => (localStorage.getItem('komod-reader-align') as 'right' | 'left' | 'center' | 'justify') || 'right');
    const previewRef = useRef<HTMLElement>(null);
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const show = !!file && (file.file_type === 'image' || canPreviewText(file));

    useEffect(() => { setImageFailed(false); setImageRetry(0); setImageScale(1); setImageDescriptionExpanded(false); setReaderFullscreen(false); }, [file?.id]);

    useEffect(() => {
        localStorage.setItem('komod-reader-font-size', String(readerFontSize));
        localStorage.setItem('komod-reader-line-height', String(readerLineHeight));
        localStorage.setItem('komod-reader-tone', readerTone);
        localStorage.setItem('komod-reader-wrap', readerWrap ? 'on' : 'off');
        localStorage.setItem('komod-reader-align', readerAlign);
    }, [readerFontSize, readerLineHeight, readerTone, readerWrap, readerAlign]);

    useEffect(() => {
        const syncFullscreen = () => {
            if (!document.fullscreenElement) setReaderFullscreen(false);
        };
        document.addEventListener('fullscreenchange', syncFullscreen);
        return () => document.removeEventListener('fullscreenchange', syncFullscreen);
    }, []);

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
            const target = event.target as HTMLElement;
            const isTyping = ['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable;
            if (event.key === 'Escape') {
                if (readerFullscreen) setReaderFullscreen(false);
                else setContentPreviewFile(null);
                return;
            }
            if (isTyping || !readerFullscreen) return;
            if (event.key === '+' || event.key === '=') setReaderFontSize(size => Math.min(24, size + 1));
            if (event.key === '-') setReaderFontSize(size => Math.max(13, size - 1));
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [readerFullscreen, show, setContentPreviewFile]);

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
    const toggleReaderFullscreen = async () => {
        const next = !readerFullscreen;
        setReaderFullscreen(next);
        try {
            if (next && previewRef.current?.requestFullscreen) await previewRef.current.requestFullscreen();
            else if (!next && document.fullscreenElement) await document.exitFullscreen();
        } catch {
            // Telegram WebView may reject the native Fullscreen API; the in-app
            // full-viewport reader still remains active.
        }
    };
    const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0;
    const insertMarkdown = (before: string, after = '', placeholder = 'متن', linePrefix = false) => {
        const editor = editorRef.current;
        if (!editor) return;
        const start = editor.selectionStart;
        const end = editor.selectionEnd;
        const selected = draft.slice(start, end) || placeholder;
        const prefix = linePrefix && start > 0 && draft[start - 1] !== '\n' ? '\n' : '';
        const replacement = `${prefix}${before}${selected}${after}`;
        setDraft(`${draft.slice(0, start)}${replacement}${draft.slice(end)}`);
        requestAnimationFrame(() => {
            editor.focus();
            const selectionStart = start + prefix.length + before.length;
            editor.setSelectionRange(selectionStart, selectionStart + selected.length);
        });
    };
    const insertTemplate = (template: string) => {
        const editor = editorRef.current;
        if (!editor) return;
        const start = editor.selectionStart;
        const prefix = start > 0 && draft[start - 1] !== '\n' ? '\n' : '';
        setDraft(`${draft.slice(0, start)}${prefix}${template}${draft.slice(editor.selectionEnd)}`);
        requestAnimationFrame(() => editor.focus());
    };

    return (
        <div className={`fixed inset-0 z-[140] flex items-center justify-center bg-black/85 backdrop-blur-md ${readerFullscreen ? 'p-0' : 'p-3 sm:p-8'}`} onClick={() => setContentPreviewFile(null)}>
            <section ref={previewRef} className={`flex w-full flex-col overflow-hidden border border-white/10 bg-dark-900 shadow-2xl ${readerFullscreen ? 'h-dvh max-h-none max-w-none rounded-none border-0' : 'max-h-full max-w-5xl rounded-2xl'}`} onClick={(event) => event.stopPropagation()}>
                <header className="flex items-start gap-3 border-b border-white/10 px-3 py-3 sm:px-5 sm:py-4">
                    <div className="flex-1 min-w-0">
                        <h2 className="truncate font-semibold" title={file.file_name}>{file.file_name}</h2>
                        {file.file_type !== 'image' && file.description && <p dir="auto" className="mt-1 line-clamp-2 max-w-2xl whitespace-pre-wrap text-sm text-dark-400" title={file.description}>{file.description}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        {file.file_type !== 'image' && <><button onClick={async () => { await navigator.clipboard.writeText(editing ? draft : content); addToast('متن کپی شد 📋'); }} className="btn-icon" title="کپی متن"><Copy className="h-5 w-5" /></button>{file.file_type === 'text' && <button onClick={() => setEditing(value => !value)} className="btn-secondary flex shrink-0 items-center gap-2 px-3 py-2 text-xs" title="ویرایش متن"><Pencil className="h-4 w-4" /><span className="hidden sm:inline">ویرایش</span></button>}<button onClick={() => void toggleReaderFullscreen()} className="btn-icon" title={readerFullscreen ? 'خروج از تمام‌صفحه' : 'مطالعه در تمام‌صفحه'}>{readerFullscreen ? <Minimize2 className="h-5 w-5"/> : <Maximize2 className="h-5 w-5"/>}</button></>}
                        <button onClick={() => setContentPreviewFile(null)} className="btn-icon" title="بستن"><X className="w-5 h-5" /></button>
                    </div>
                </header>
                {file.file_type === 'image' ? (
                    <div className="relative min-h-0 flex-1 overflow-auto p-4 pb-20 text-center" onDoubleClick={()=>setImageScale(value=>value===1?2:1)}>
                        {imageFailed ? <div className="mx-auto rounded-2xl border border-dashed border-white/10 p-8 text-center"><p className="text-sm text-dark-400">نمایش عکس انجام نشد.</p><button className="btn-secondary mt-4" onClick={() => { setImageFailed(false); setImageRetry(Date.now()); }}>تلاش دوباره</button></div> : <img src={url} alt={file.file_name} draggable={false} className="mx-auto rounded-lg object-contain transition-[width] duration-200" style={{width:imageScale===1?'auto':`${imageScale*100}%`,maxWidth:imageScale===1?'100%':'none',maxHeight:imageScale===1?(readerFullscreen?'calc(100dvh - 6rem)':'75vh'):'none'}} onError={() => setImageFailed(true)} />}
                        <div className="sticky bottom-2 mx-auto mt-4 w-full max-w-2xl rounded-2xl border border-white/10 bg-dark-900/90 p-2 shadow-2xl backdrop-blur-xl"><div className="mx-auto flex w-fit max-w-full items-center gap-1"><button onClick={()=>setImageScale(value=>Math.max(.5,Number((value-.25).toFixed(2))))} className="btn-icon" title="کوچک‌نمایی"><ZoomOut className="h-5 w-5"/></button><span dir="ltr" className="min-w-12 text-center text-xs text-dark-300">{Math.round(imageScale*100)}%</span><button onClick={()=>setImageScale(value=>Math.min(4,Number((value+.25).toFixed(2))))} className="btn-icon" title="بزرگ‌نمایی"><ZoomIn className="h-5 w-5"/></button><span className="mx-1 h-6 w-px bg-white/10"/><a href={`${url}&download=1`} download={file.file_name} className="btn-icon" title="دانلود"><Download className="h-5 w-5"/></a><button onClick={() => void toggleReaderFullscreen()} className="btn-icon" title={readerFullscreen?'خروج از تمام‌صفحه':'تمام‌صفحه'}>{readerFullscreen?<Minimize2 className="h-5 w-5"/>:<Maximize2 className="h-5 w-5"/>}</button></div>{file.description&&<button dir="auto" onClick={()=>setImageDescriptionExpanded(value=>!value)} className={`mt-1 w-full border-t border-white/[.07] px-2 pt-2 text-right text-xs leading-6 text-dark-300 ${imageDescriptionExpanded?'whitespace-pre-wrap':'line-clamp-3'}`}>{file.description}<span className="mr-1 text-primary-300">{imageDescriptionExpanded?'کمتر':'بیشتر'}</span></button>}</div>
                    </div>
                ) : (
                    <>
                        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-white/[.06] bg-dark-950/70 px-3 py-2 sm:px-5">
                            <div className="flex shrink-0 items-center rounded-xl border border-white/[.07] bg-dark-800/70 p-1">
                                <button className="flex h-8 w-8 items-center justify-center rounded-lg text-dark-300 hover:bg-white/[.06] hover:text-white disabled:opacity-30" disabled={readerFontSize <= 13} onClick={() => setReaderFontSize(size => Math.max(13, size - 1))} title="کوچک‌تر کردن متن"><Minus className="h-4 w-4"/></button>
                                <span dir="ltr" className="min-w-12 text-center text-xs text-dark-300">{readerFontSize}px</span>
                                <button className="flex h-8 w-8 items-center justify-center rounded-lg text-dark-300 hover:bg-white/[.06] hover:text-white disabled:opacity-30" disabled={readerFontSize >= 24} onClick={() => setReaderFontSize(size => Math.min(24, size + 1))} title="بزرگ‌تر کردن متن"><Plus className="h-4 w-4"/></button>
                            </div>
                            <span className="hidden shrink-0 text-xs text-dark-500 sm:block">{wordCount.toLocaleString('fa-IR')} واژه</span>
                            <div className="mr-auto flex shrink-0 items-center gap-1">
                                <div className="flex shrink-0 items-center rounded-xl border border-white/[.07] bg-dark-800/70 p-1">
                                    {([['right', AlignRight], ['center', AlignCenter], ['left', AlignLeft], ['justify', AlignJustify]] as const).map(([value, Icon]) => <button key={value} onClick={() => setReaderAlign(value)} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg p-0 leading-none ${readerAlign === value ? 'bg-primary-500/20 text-primary-200' : 'text-dark-400 hover:text-white'}`} title={value === 'right' ? 'راست‌چین' : value === 'left' ? 'چپ‌چین' : value === 'center' ? 'وسط‌چین' : 'تراز دوطرفه'}><Icon className="block h-4 w-4"/></button>)}
                                </div>
                                <label className="flex h-10 items-center gap-2 rounded-xl border border-white/[.07] bg-dark-800/70 px-2" title="فاصله بین خط‌ها"><span className="hidden text-[10px] text-dark-400 sm:inline">فاصله</span><input type="range" min="1.4" max="2.8" step="0.1" value={readerLineHeight} onChange={event=>setReaderLineHeight(Number(event.target.value))} className="w-16 accent-primary-500"/><span dir="ltr" className="w-6 text-[10px] text-dark-300">{readerLineHeight.toFixed(1)}</span></label>
                                <button onClick={() => setReaderWrap(value => !value)} className={`btn-icon h-10 w-10 ${readerWrap ? 'text-primary-200' : ''}`} title={readerWrap ? 'خاموش‌کردن شکستن خط‌ها' : 'شکستن خودکار خط‌ها'}><WrapText className="h-4 w-4"/></button>
                                <button onClick={() => setReaderTone(tone => tone === 'dark' ? 'warm' : 'dark')} className="btn-icon h-10 w-10" title={readerTone === 'dark' ? 'حالت مطالعه گرم' : 'حالت تاریک'}>{readerTone === 'dark' ? <Sun className="h-4 w-4"/> : <Moon className="h-4 w-4"/>}</button>
                            </div>
                        </div>
                        <div className={`min-h-0 flex-1 overflow-auto p-4 transition-colors sm:p-8 ${readerTone === 'warm' ? 'bg-[#19160f]' : 'bg-dark-950/60'}`}>
                            {loading ? <p className="text-dark-400">در حال بارگذاری متن…</p> : error ? <p className="text-red-400">{error}</p> : editing ? <div className="mx-auto max-w-5xl"><div className="mb-2 flex flex-wrap gap-1 rounded-2xl border border-white/[.08] bg-[#121722] p-1.5"><EditorTool title="سرتیتر" onClick={()=>insertMarkdown('# ','','عنوان',true)}><Heading1/></EditorTool><EditorTool title="بولد" onClick={()=>insertMarkdown('**','**')}><Bold/></EditorTool><EditorTool title="ایتالیک" onClick={()=>insertMarkdown('*','*')}><Italic/></EditorTool><EditorTool title="زیرخط" onClick={()=>insertMarkdown('<u>','</u>')}><Underline/></EditorTool><EditorTool title="خط‌خورده" onClick={()=>insertMarkdown('~~','~~')}><Strikethrough/></EditorTool><EditorTool title="کد کوتاه" onClick={()=>insertMarkdown('`','`','code')}><Code2/></EditorTool><EditorTool title="کدبلاک" onClick={()=>insertMarkdown('```\n','\n```','code',true)}><Code2/></EditorTool><EditorTool title="لینک" onClick={()=>insertMarkdown('[','](https://)','عنوان لینک')}><Link/></EditorTool><EditorTool title="تصویر" onClick={()=>insertMarkdown('![','](https://)','توضیح تصویر')}><ImageIcon/></EditorTool><EditorTool title="نقل‌قول" onClick={()=>insertMarkdown('> ','','متن نقل‌قول',true)}><Quote/></EditorTool><EditorTool title="فهرست" onClick={()=>insertMarkdown('- ','','مورد',true)}><List/></EditorTool><EditorTool title="فهرست شماره‌ای" onClick={()=>insertMarkdown('1. ','','مورد',true)}><ListOrdered/></EditorTool><EditorTool title="چک‌لیست" onClick={()=>insertMarkdown('- [ ] ','','کار',true)}><ListChecks/></EditorTool><EditorTool title="خط جداکننده" onClick={()=>insertTemplate('---\n')}><Minus/></EditorTool><EditorTool title="جدول" onClick={()=>insertTemplate('| ستون ۱ | ستون ۲ |\n| --- | --- |\n| مقدار ۱ | مقدار ۲ |\n')}><Table2/></EditorTool></div><textarea ref={editorRef} dir="auto" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='b'){event.preventDefault();insertMarkdown('**','**')}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='i'){event.preventDefault();insertMarkdown('*','*')}}} className="min-h-[65vh] w-full resize-y rounded-2xl border border-white/10 bg-[#0f131c] p-4 font-mono text-slate-100 caret-primary-300 outline-none selection:bg-primary-500/30 focus:border-primary-400" style={{ fontSize: readerFontSize, lineHeight: readerLineHeight }}/><div className="mt-3 flex justify-end gap-2"><button className="btn-secondary" onClick={() => { setDraft(content); setEditing(false); }}>لغو</button><button disabled={saving} className="btn-primary flex items-center gap-2" onClick={() => void saveText()}><Check className="h-4 w-4"/> {saving ? 'در حال ذخیره…' : 'ذخیره متن'}</button></div></div> : <MarkdownContent content={content} fontSize={readerFontSize} lineHeight={readerLineHeight} warm={readerTone === 'warm'} wrap={readerWrap} align={readerAlign} />}
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}

function EditorTool({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
    return <button type="button" title={title} aria-label={title} onClick={onClick} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/[.07] hover:text-primary-200 [&>svg]:h-4 [&>svg]:w-4">{children}</button>;
}

function inlineMarkdown(text: string) {
    return text.split(/(!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|__[^_]+__|<u>.*?<\/u>|~~[^~]+~~|`[^`]+`|\*[^*]+\*)/g).map((part, index) => {
        const image = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/); if (image) return <img key={index} src={image[2]} alt={image[1]} loading="lazy" className="my-4 max-h-[70vh] max-w-full rounded-2xl border border-white/[.07] object-contain shadow-xl"/>;
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/); if (link) return <a key={index} href={link[2]} target="_blank" rel="noreferrer" className="break-all font-medium text-sky-300 underline decoration-sky-500/40 underline-offset-4 transition hover:text-sky-200">{link[1]}</a>;
        if (part.startsWith('**') || part.startsWith('__')) return <strong key={index} className="font-extrabold text-amber-200">{part.slice(2, -2)}</strong>;
        if (part.startsWith('~~')) return <del key={index} className="text-rose-300/70 decoration-rose-400/70">{part.slice(2, -2)}</del>;
        if (part.startsWith('<u>')) return <u key={index} className="decoration-primary-400/70 decoration-2 underline-offset-4">{part.slice(3, -4)}</u>;
        if (part.startsWith('`')) return <code key={index} dir="ltr" className="mx-0.5 break-all rounded-md border border-cyan-400/15 bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[.9em] text-cyan-200">{part.slice(1, -1)}</code>;
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
    return <div dir="ltr" className="my-5 min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-700/70 bg-[#10141d] shadow-[0_14px_36px_rgba(0,0,0,.22)]">
        <div className="grid min-w-0 grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-white/[.06] bg-white/[.035] px-3 py-2">
            <div className="flex items-center gap-1.5" aria-hidden="true"><span className="h-2.5 w-2.5 rounded-full bg-rose-400/80"/><span className="h-2.5 w-2.5 rounded-full bg-amber-300/80"/><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80"/></div>
            <span className="min-w-0 truncate text-center font-mono text-[11px] uppercase tracking-wider text-slate-400">{language || 'code'}</span>
            <button dir="rtl" onClick={() => void copy()} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-dark-300 transition hover:bg-white/[.06] hover:text-white"><Copy className="h-3.5 w-3.5"/>{copied ? 'کپی شد' : 'کپی'}</button>
        </div>
        <div className="max-w-full overflow-x-auto overscroll-x-contain">
            <pre className="m-0 w-max min-w-full whitespace-pre p-4 text-left font-mono text-sm leading-7 text-slate-200 selection:bg-primary-400/25" style={{ tabSize: 4 }}><code className="block">{code}</code></pre>
        </div>
    </div>;
}

function MarkdownContent({ content, fontSize = 15, lineHeight = 2, warm = false, wrap = true, align = 'right' }: { content: string; fontSize?: number; lineHeight?: number; warm?: boolean; wrap?: boolean; align?: 'right' | 'left' | 'center' | 'justify' }) {
    const blocks = useMemo(() => {
        const result: JSX.Element[] = []; let code = false; let codeLines: string[] = []; let language = '';
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            if (line.trim().startsWith('```')) { if (code) { result.push(<MarkdownCodeBlock key={`code-${index}`} code={codeLines.join('\n')} language={language}/>); codeLines = []; language = ''; } else language = line.trim().slice(3).trim(); code = !code; continue; }
            if (code) { codeLines.push(line); continue; }
            if (!line.trim()) { result.push(<div key={`space-${index}`} className="h-3"/>); continue; }
            if (/^\s*(---+|___+|\*\*\*+)\s*$/.test(line)) { result.push(<div key={index} className="my-7 h-px bg-gradient-to-r from-transparent via-primary-400/45 to-transparent"/>); continue; }
            const nextIsSeparator = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1] || '');
            if (line.includes('|') && nextIsSeparator) {
                const rows: string[][] = [line.trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim())];
                index += 2;
                while (index < lines.length && lines[index].includes('|') && lines[index].trim()) {
                    rows.push(lines[index].trim().replace(/^\||\|$/g, '').split('|').map(cell => cell.trim()));
                    index += 1;
                }
                index -= 1;
                result.push(<div key={`table-${index}`} className="my-5 max-w-full overflow-x-auto rounded-2xl border border-white/[.08] shadow-lg"><table className="w-full min-w-max border-collapse text-sm"><thead className="bg-primary-500/12 text-primary-100"><tr>{rows[0].map((cell, cellIndex) => <th key={cellIndex} className="min-w-32 border-l border-white/[.07] px-4 py-3 text-right font-bold last:border-l-0">{inlineMarkdown(cell)}</th>)}</tr></thead><tbody>{rows.slice(1).map((cells, rowIndex) => <tr key={rowIndex} className="border-t border-white/[.06] odd:bg-white/[.018]"><>{rows[0].map((_, cellIndex) => <td key={cellIndex} className="max-w-sm break-words border-l border-white/[.05] px-4 py-3 align-top last:border-l-0">{inlineMarkdown(cells[cellIndex] || '')}</td>)}</></tr>)}</tbody></table></div>);
                continue;
            }
            const heading = line.match(/^(#{1,6})\s+(.+)$/); if (heading) { const level = heading[1].length; const Tag = `h${level}` as keyof JSX.IntrinsicElements; const tone = level === 1 ? 'text-primary-200' : level === 2 ? 'text-sky-200' : level === 3 ? 'text-violet-200' : 'text-emerald-200'; result.push(<Tag key={index} className={`${level === 1 ? 'text-3xl' : level === 2 ? 'text-2xl' : level === 3 ? 'text-xl' : 'text-lg'} ${tone} mb-2 mt-7 break-words border-b border-white/[.05] pb-2 font-black leading-tight`}>{inlineMarkdown(heading[2])}</Tag>); continue; }
            const quote = line.match(/^>\s?(.+)$/); if (quote) { result.push(<blockquote key={index} className="my-3 rounded-l-xl border-r-4 border-violet-400/60 bg-violet-400/[.07] px-4 py-2 italic text-violet-100/90">{inlineMarkdown(quote[1])}</blockquote>); continue; }
            const task = line.match(/^\s*[-*]\s+\[([ xX])\]\s+(.+)$/); if (task) { const checked = task[1].toLowerCase() === 'x'; result.push(<div key={index} className="flex items-start gap-2"><span className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border text-xs ${checked ? 'border-emerald-400/40 bg-emerald-400/15 text-emerald-300' : 'border-white/15 text-transparent'}`}>✓</span><span className={checked ? 'text-dark-400 line-through' : ''}>{inlineMarkdown(task[2])}</span></div>); continue; }
            const bullet = line.match(/^\s*[-*]\s+(.+)$/); if (bullet) { result.push(<div key={index} className="flex items-start gap-2"><span className="mt-0.5 text-lg text-primary-300">•</span><span>{inlineMarkdown(bullet[1])}</span></div>); continue; }
            const ordered = line.match(/^\s*(\d+)\.\s+(.+)$/); if (ordered) { result.push(<div key={index} className="flex items-start gap-2"><span className="mt-1 flex min-w-6 items-center justify-center rounded-md bg-primary-400/10 px-1 text-xs font-bold text-primary-200">{Number(ordered[1]).toLocaleString('fa-IR')}</span><span>{inlineMarkdown(ordered[2])}</span></div>); continue; }
            result.push(<p key={index} className="whitespace-pre-wrap break-words text-dark-100">{inlineMarkdown(line)}</p>);
        }
        if (codeLines.length) result.push(<MarkdownCodeBlock key="code-final" code={codeLines.join('\n')} language={language}/>);
        return result;
    }, [content]);
    return <article dir="auto" className={`mx-auto max-w-3xl overflow-hidden rounded-2xl border p-4 shadow-inner transition-colors sm:p-6 ${warm ? 'border-amber-100/[.1] bg-[#211d14] text-amber-50/95' : 'border-slate-700/45 bg-[#111620] text-slate-100'} ${wrap ? 'break-words' : 'overflow-x-auto whitespace-pre'}`} style={{ fontSize, lineHeight, textAlign: align }}>{blocks}</article>;
}
