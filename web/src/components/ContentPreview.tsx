import { useEffect, useRef, useState } from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, BookOpen, Braces, Check, ChevronLeft, ChevronRight, Code2, Copy, Download, Heading1, Image as ImageIcon, Italic, Link, List, ListChecks, ListOrdered, Maximize2, Minimize2, Minus, Moon, MoveHorizontal, Pencil, Plus, Quote, Sigma, Strikethrough, Sun, Table2, Underline, WrapText, X, ZoomIn, ZoomOut } from 'lucide-react';
import { api, canPreviewText, useFiles } from '../lib/api';
import { useAppStore } from '../lib/store';
import { cacheTextFile, getOfflineText, updateOfflineTextDraft } from '../lib/offline';
import CustomSelect from './CustomSelect';
import MarkdownContent from './MarkdownContent';

type ReaderTone = 'dark'|'gray'|'cream'|'white'|'ocean'|'forest'|'plum'|'sepia';
const readerFonts=[{value:'vazir',label:'وزیرمتن'},{value:'yekan',label:'یکان'},{value:'iransans',label:'ایران‌سنس'},{value:'zar',label:'زر'},{value:'bnazanin',label:'بی‌نازنین'},{value:'tahoma',label:'تاهوما'},{value:'serif',label:'نسخ'},{value:'inter',label:'Inter'},{value:'georgia',label:'Georgia'},{value:'merriweather',label:'Merriweather'},{value:'mono',label:'قلم کدنویسی'}];
const readerTones:Array<{value:ReaderTone;color:string;label:string}>=[{value:'dark',color:'#05070b',label:'مشکی'},{value:'gray',color:'#242933',label:'خاکستری'},{value:'cream',color:'#efe4ca',label:'کاغذی'},{value:'white',color:'#ffffff',label:'روز'},{value:'ocean',color:'#082735',label:'اقیانوس'},{value:'forest',color:'#10291d',label:'جنگل'},{value:'plum',color:'#27172f',label:'آلویی'},{value:'sepia',color:'#3a2b20',label:'سپیا'}];

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
    const [readerTone, setReaderTone] = useState<ReaderTone>(() => {const saved=localStorage.getItem('komod-reader-tone');return saved==='warm'||saved==='paper'?'cream':(saved as ReaderTone)||'dark'});
    const [readerFont, setReaderFont] = useState(() => localStorage.getItem('komod-reader-font') || 'vazir');
    const [readerWrap, setReaderWrap] = useState(() => localStorage.getItem('komod-reader-wrap') !== 'off');
    const [readerWide, setReaderWide] = useState(() => localStorage.getItem('komod-reader-wide') === 'on');
    const [readerAlign, setReaderAlign] = useState<'right' | 'left' | 'center' | 'justify'>(() => (localStorage.getItem('komod-reader-align') as 'right' | 'left' | 'center' | 'justify') || 'right');
    const previewRef = useRef<HTMLElement>(null);
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const show = !!file && (file.file_type === 'image' || canPreviewText(file));
    const {data:imageLibrary}=useFiles(undefined,'image','',1,'created:desc');
    const imageItems=imageLibrary?.files||[];
    const imageIndex=file?.file_type==='image'?imageItems.findIndex(item=>item.id===file.id):-1;
    const showImageAt=(index:number)=>{const next=imageItems[index];if(next)setContentPreviewFile(next)};

    useEffect(() => { setImageFailed(false); setImageRetry(0); setImageScale(1); setImageDescriptionExpanded(false); setReaderFullscreen(false); setEditing(false); }, [file?.id]);

    useEffect(()=>{
        const startEditing=(event:Event)=>{const requested=(event as CustomEvent<{fileId?:number}>).detail?.fileId;if(file&&canPreviewText(file)&&(!requested||requested===file.id))setEditing(true)};
        window.addEventListener('komod-preview-edit',startEditing);
        return()=>window.removeEventListener('komod-preview-edit',startEditing);
    },[file]);

    useEffect(() => {
        localStorage.setItem('komod-reader-font-size', String(readerFontSize));
        localStorage.setItem('komod-reader-line-height', String(readerLineHeight));
        localStorage.setItem('komod-reader-tone', readerTone);
        localStorage.setItem('komod-reader-font', readerFont);
        localStorage.setItem('komod-reader-wrap', readerWrap ? 'on' : 'off');
        localStorage.setItem('komod-reader-wide', readerWide ? 'on' : 'off');
        localStorage.setItem('komod-reader-align', readerAlign);
    }, [readerFontSize, readerLineHeight, readerTone, readerFont, readerWrap, readerWide, readerAlign]);

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
        <div className={`fixed inset-0 z-[220] flex items-center justify-center bg-black/85 backdrop-blur-md ${readerFullscreen ? 'p-0' : 'p-3 sm:p-8'}`} onClick={() => setContentPreviewFile(null)}>
            <section ref={previewRef} className={`flex w-full flex-col overflow-hidden border border-white/10 bg-dark-900 shadow-2xl ${readerFullscreen ? 'h-dvh max-h-none max-w-none rounded-none border-0' : 'max-h-full max-w-5xl rounded-2xl'}`} onClick={(event) => event.stopPropagation()}>
                <header className="flex items-start gap-3 border-b border-white/10 px-3 py-3 sm:px-5 sm:py-4">
                    <div className="flex-1 min-w-0">
                        <h2 className="truncate font-semibold" title={file.file_name}>{file.file_name}</h2>
                        {file.file_type !== 'image' && file.description && <p dir="auto" className="mt-1 line-clamp-2 max-w-2xl whitespace-pre-wrap text-sm text-dark-400" title={file.description}>{file.description}</p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        {file.file_type !== 'image' && <><button onClick={async () => { await navigator.clipboard.writeText(editing ? draft : content); addToast('متن کپی شد 📋'); }} className="btn-icon" title="کپی متن"><Copy className="h-5 w-5" /></button><button onClick={() => setEditing(value => !value)} className={`btn-secondary flex shrink-0 items-center gap-2 px-3 py-2 text-xs ${editing?'text-primary-200':''}`} title={editing?'حالت مطالعه':'ویرایش متن'}>{editing?<BookOpen className="h-4 w-4"/>:<Pencil className="h-4 w-4"/>}<span className="hidden sm:inline">{editing?'مطالعه':'ویرایش'}</span></button><button onClick={() => void toggleReaderFullscreen()} className="btn-icon" title={readerFullscreen ? 'خروج از تمام‌صفحه' : 'مطالعه در تمام‌صفحه'}>{readerFullscreen ? <Minimize2 className="h-5 w-5"/> : <Maximize2 className="h-5 w-5"/>}</button></>}
                        <button onClick={() => setContentPreviewFile(null)} className="btn-icon" title="بستن"><X className="w-5 h-5" /></button>
                    </div>
                </header>
                {file.file_type === 'image' ? (
                    <div className="relative min-h-0 flex-1 overflow-auto p-4 pb-20 text-center" onDoubleClick={()=>setImageScale(value=>value===1?2:1)}>
                        {imageFailed ? <div className="mx-auto rounded-2xl border border-dashed border-white/10 p-8 text-center"><p className="text-sm text-dark-400">نمایش عکس انجام نشد.</p><button className="btn-secondary mt-4" onClick={() => { setImageFailed(false); setImageRetry(Date.now()); }}>تلاش دوباره</button></div> : <img src={url} alt={file.file_name} draggable={false} className="mx-auto rounded-lg object-contain transition-[width] duration-200" style={{width:imageScale===1?'auto':`${imageScale*100}%`,maxWidth:imageScale===1?'100%':'none',maxHeight:imageScale===1?(readerFullscreen?'calc(100dvh - 6rem)':'75vh'):'none'}} onError={() => setImageFailed(true)} />}
                        <div className="sticky bottom-2 mx-auto mt-4 w-full max-w-2xl rounded-2xl border border-white/10 bg-dark-900/90 p-2 shadow-2xl backdrop-blur-xl"><div className="mx-auto flex w-fit max-w-full items-center gap-1">{imageItems.length>1&&<button disabled={imageIndex<=0} onClick={()=>showImageAt(imageIndex-1)} className="btn-icon disabled:opacity-25" title="عکس قبلی"><ChevronRight className="h-5 w-5"/></button>}<button onClick={()=>setImageScale(value=>Math.max(.5,Number((value-.25).toFixed(2))))} className="btn-icon" title="کوچک‌نمایی"><ZoomOut className="h-5 w-5"/></button><span dir="ltr" className="min-w-12 text-center text-xs text-dark-300">{Math.round(imageScale*100)}%</span><button onClick={()=>setImageScale(value=>Math.min(4,Number((value+.25).toFixed(2))))} className="btn-icon" title="بزرگ‌نمایی"><ZoomIn className="h-5 w-5"/></button><span className="mx-1 h-6 w-px bg-white/10"/><a href={`${url}&download=1`} download={file.file_name} className="btn-icon" title="دانلود"><Download className="h-5 w-5"/></a><button onClick={() => void toggleReaderFullscreen()} className="btn-icon" title={readerFullscreen?'خروج از تمام‌صفحه':'تمام‌صفحه'}>{readerFullscreen?<Minimize2 className="h-5 w-5"/>:<Maximize2 className="h-5 w-5"/>}</button>{imageItems.length>1&&<button disabled={imageIndex<0||imageIndex>=imageItems.length-1} onClick={()=>showImageAt(imageIndex+1)} className="btn-icon disabled:opacity-25" title="عکس بعدی"><ChevronLeft className="h-5 w-5"/></button>}</div>{file.description&&<button dir="auto" onClick={()=>setImageDescriptionExpanded(value=>!value)} className={`mt-1 w-full border-t border-white/[.07] px-2 pt-2 text-right text-xs leading-6 text-dark-300 ${imageDescriptionExpanded?'whitespace-pre-wrap':'line-clamp-3'}`}>{file.description}<span className="mr-1 text-primary-300">{imageDescriptionExpanded?'کمتر':'بیشتر'}</span></button>}</div>
                    </div>
                ) : (
                    <>
                        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/[.06] bg-dark-950/70 px-3 py-2 sm:px-5">
                            <div className="min-w-40"><CustomSelect value={readerFont} onChange={setReaderFont} options={readerFonts}/></div>
                            <div className="min-w-36"><CustomSelect value={readerTone} onChange={setReaderTone} options={readerTones}/></div>
                            <div className="flex shrink-0 items-center rounded-xl border border-white/[.07] bg-dark-800/70 p-1">
                                <button className="flex h-8 w-8 items-center justify-center rounded-lg text-dark-300 hover:bg-white/[.06] hover:text-white disabled:opacity-30" disabled={readerFontSize <= 13} onClick={() => setReaderFontSize(size => Math.max(13, size - 1))} title="کوچک‌تر کردن متن"><Minus className="h-4 w-4"/></button>
                                <span dir="ltr" className="min-w-12 text-center text-xs text-dark-300">{readerFontSize}px</span>
                                <button className="flex h-8 w-8 items-center justify-center rounded-lg text-dark-300 hover:bg-white/[.06] hover:text-white disabled:opacity-30" disabled={readerFontSize >= 24} onClick={() => setReaderFontSize(size => Math.min(24, size + 1))} title="بزرگ‌تر کردن متن"><Plus className="h-4 w-4"/></button>
                            </div>
                            <span className="hidden shrink-0 text-xs text-dark-500 sm:block">{wordCount.toLocaleString('fa-IR')} واژه</span>
                            <div className="mr-auto flex shrink-0 flex-wrap items-center gap-1">
                                <div className="flex shrink-0 items-center rounded-xl border border-white/[.07] bg-dark-800/70 p-1">
                                    {([['right', AlignRight], ['center', AlignCenter], ['left', AlignLeft], ['justify', AlignJustify]] as const).map(([value, Icon]) => <button key={value} onClick={() => setReaderAlign(value)} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg p-0 leading-none ${readerAlign === value ? 'bg-primary-500/20 text-primary-200' : 'text-dark-400 hover:text-white'}`} title={value === 'right' ? 'راست‌چین' : value === 'left' ? 'چپ‌چین' : value === 'center' ? 'وسط‌چین' : 'تراز دوطرفه'}><Icon className="block h-4 w-4"/></button>)}
                                </div>
                                <div className="flex h-10 items-center rounded-xl border border-white/[.07] bg-dark-800/70 p-1" title="فاصله بین خط‌ها"><button className="flex h-8 w-8 items-center justify-center rounded-lg text-dark-300 hover:bg-white/[.06] disabled:opacity-30" disabled={readerLineHeight<=1.4} onClick={()=>setReaderLineHeight(value=>Math.max(1.4,Number((value-.1).toFixed(1))))}><Minus className="h-4 w-4"/></button><span dir="ltr" className="min-w-10 text-center text-[10px] text-dark-300">{readerLineHeight.toFixed(1)}</span><button className="flex h-8 w-8 items-center justify-center rounded-lg text-dark-300 hover:bg-white/[.06] disabled:opacity-30" disabled={readerLineHeight>=2.8} onClick={()=>setReaderLineHeight(value=>Math.min(2.8,Number((value+.1).toFixed(1))))}><Plus className="h-4 w-4"/></button></div>
                                <button onClick={() => setReaderWrap(value => !value)} className={`btn-icon h-10 w-10 ${readerWrap ? 'text-primary-200' : ''}`} title={readerWrap ? 'خاموش‌کردن شکستن خط‌ها' : 'شکستن خودکار خط‌ها'}><WrapText className="h-4 w-4"/></button>
                                <button onClick={() => setReaderWide(value => !value)} className={`btn-icon h-10 w-10 ${readerWide ? 'text-primary-200' : ''}`} title={readerWide ? 'عرض معمولی متن' : 'استفاده از تمام عرض'}><MoveHorizontal className="h-4 w-4"/></button>
                                <button onClick={() => setReaderTone(tone => tone === 'dark' ? 'white' : 'dark')} className="btn-icon h-10 w-10" title="جابجایی سریع حالت شب و روز">{readerTone === 'dark' ? <Sun className="h-4 w-4"/> : <Moon className="h-4 w-4"/>}</button>
                            </div>
                        </div>
                        <div className={`markdown-reader-surface markdown-reader-surface--${readerTone} min-h-0 flex-1 overflow-auto p-4 transition-colors sm:p-8`}>
                            {loading ? <p className="text-dark-400">در حال بارگذاری متن…</p> : error ? <p className="text-red-400">{error}</p> : editing ? <div className={`mx-auto ${readerWide?'max-w-none':'max-w-5xl'}`}><div className="markdown-editor-toolbar mb-2 grid grid-cols-6 gap-1 rounded-2xl border p-1.5 sm:flex sm:flex-wrap"><EditorTool title="سرتیتر" onClick={()=>insertMarkdown('# ','','عنوان',true)}><Heading1/></EditorTool><EditorTool title="بولد" onClick={()=>insertMarkdown('**','**')}><Bold/></EditorTool><EditorTool title="ایتالیک" onClick={()=>insertMarkdown('*','*')}><Italic/></EditorTool><EditorTool title="زیرخط" onClick={()=>insertMarkdown('<u>','</u>')}><Underline/></EditorTool><EditorTool title="خط‌خورده" onClick={()=>insertMarkdown('~~','~~')}><Strikethrough/></EditorTool><EditorTool title="کد کوتاه" onClick={()=>insertMarkdown('`','`','code')}><Code2/></EditorTool><EditorTool title="کدبلاک" onClick={()=>insertMarkdown('```\n','\n```','code',true)}><Code2/></EditorTool><EditorTool title="فرمول ریاضی" onClick={()=>insertMarkdown('$','$','x^2 + y^2')}><Sigma/></EditorTool><EditorTool title="متغیر" onClick={()=>insertMarkdown('{{','}}','نام_متغیر')}><Braces/></EditorTool><EditorTool title="لینک" onClick={()=>insertMarkdown('[','](https://)','عنوان لینک')}><Link/></EditorTool><EditorTool title="تصویر" onClick={()=>insertMarkdown('![','](https://)','توضیح تصویر')}><ImageIcon/></EditorTool><EditorTool title="نقل‌قول" onClick={()=>insertMarkdown('> ','','متن نقل‌قول',true)}><Quote/></EditorTool><EditorTool title="فهرست" onClick={()=>insertMarkdown('- ','','مورد',true)}><List/></EditorTool><EditorTool title="فهرست شماره‌ای" onClick={()=>insertMarkdown('1. ','','مورد',true)}><ListOrdered/></EditorTool><EditorTool title="چک‌لیست" onClick={()=>insertMarkdown('- [ ] ','','کار',true)}><ListChecks/></EditorTool><EditorTool title="خط جداکننده" onClick={()=>insertTemplate('---\n')}><Minus/></EditorTool><EditorTool title="جدول" onClick={()=>insertTemplate('| ستون ۱ | ستون ۲ |\n| --- | --- |\n| مقدار ۱ | مقدار ۲ |\n')}><Table2/></EditorTool></div><textarea ref={editorRef} dir="auto" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='b'){event.preventDefault();insertMarkdown('**','**')}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='i'){event.preventDefault();insertMarkdown('*','*')}}} className={`markdown-editor markdown-font--${readerFont} min-h-[65vh] w-full resize-y rounded-2xl border p-4 caret-primary-300 outline-none selection:bg-primary-500/30 focus:border-primary-400`} style={{ fontSize: readerFontSize, lineHeight: readerLineHeight }}/><div className="mt-3 flex justify-end gap-2"><button className="btn-secondary" onClick={() => { setDraft(content); setEditing(false); }}>لغو</button><button disabled={saving} className="btn-primary flex items-center gap-2" onClick={() => void saveText()}><Check className="h-4 w-4"/> {saving ? 'در حال ذخیره…' : 'ذخیره متن'}</button></div></div> : <MarkdownContent content={content} fontSize={readerFontSize} lineHeight={readerLineHeight} theme={readerTone} fontFamily={readerFont} wrap={readerWrap} wide={readerWide} align={readerAlign} />}
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}
function EditorTool({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
    return <button type="button" title={title} aria-label={title} onClick={onClick} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/[.07] hover:text-primary-200 [&>svg]:h-4 [&>svg]:w-4">{children}</button>;
}
