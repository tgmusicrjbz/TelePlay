import { useEffect, useRef, useState } from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowRight, Bold, BookOpen, Braces, Check, ChevronLeft, ChevronRight, Code2, Copy, Download, ExternalLink, Eye, EyeOff, FileBox, FileText, Heading1, Image as ImageIcon, Italic, Link, Link2, List, ListChecks, ListOrdered, Maximize2, Minimize2, Minus, Moon, MoveHorizontal, PanelBottomClose, Pencil, Plus, Quote, Redo2, Settings2, Smartphone, Sigma, Sparkles, Strikethrough, Sun, Table2, Underline, Undo2, Wand2, WrapText, X, ZoomIn, ZoomOut } from 'lucide-react';
import { api, canPreviewText, useFiles, useRefineSTTText, useUpdateFile } from '../lib/api';
import { useAppStore } from '../lib/store';
import { cacheTextFile, getOfflineText, updateOfflineTextDraft } from '../lib/offline';
import CustomSelect from './CustomSelect';
import MarkdownContent, { MarkdownInline } from './MarkdownContent';
import InternalFileLinkPicker from './InternalFileLinkPicker';
import ZoomableImage from './ZoomableImage';
import { getMarkdownSettings, getMarkdownThemeOptions, markdownFonts, MarkdownSettings } from '../lib/markdownSettings';

const readerFonts=markdownFonts;

export default function ContentPreview() {
    const { contentPreviewFile: file, contentPreviewHistory, setContentPreviewFile, goBackContentPreview, addToast, isContentPreviewMinimized, setContentPreviewMinimized, isPlayerMinimized, previewFile } = useAppStore();
    const [content, setContent] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const [imageFailed, setImageFailed] = useState(false);
    const [imageRetry, setImageRetry] = useState(0);
    const [imageScale, setImageScale] = useState(1);
    const [imageQuality,setImageQuality]=useState<'optimized'|'original'>('optimized');
    const [imageDescriptionExpanded, setImageDescriptionExpanded] = useState(false);
    const [openingExternal,setOpeningExternal]=useState(false);
    const [readerFullscreen, setReaderFullscreen] = useState(false);
    const [readerChromeHidden,setReaderChromeHidden]=useState(false);
    const initialMarkdown=useRef<MarkdownSettings>(getMarkdownSettings());
    const [readerFontSize, setReaderFontSize] = useState(initialMarkdown.current.fontSize);
    const [readerLineHeight, setReaderLineHeight] = useState(initialMarkdown.current.lineHeight);
    const [readerTone, setReaderTone] = useState(initialMarkdown.current.theme);
    const [readerFont, setReaderFont] = useState(initialMarkdown.current.font);
    const [readerWrap, setReaderWrap] = useState(initialMarkdown.current.wrap);
    const [readerWide, setReaderWide] = useState(initialMarkdown.current.wide);
    const [readerAlign, setReaderAlign] = useState<'right' | 'left' | 'center' | 'justify'>(initialMarkdown.current.align);
    const [readerDirection,setReaderDirection]=useState<'rtl'|'ltr'>(initialMarkdown.current.direction);
    const [textAttachmentPosition,setTextAttachmentPosition]=useState<'start'|'end'>(initialMarkdown.current.textAttachmentPosition);
    const [readerToolsVisible,setReaderToolsVisible]=useState(initialMarkdown.current.showToolbar);
    const [readerToneOptions,setReaderToneOptions]=useState(getMarkdownThemeOptions);
    const [showInternalLinkPicker,setShowInternalLinkPicker]=useState(false);
    const [showAIEditor,setShowAIEditor]=useState(false);
    const [aiVersions,setAIVersions]=useState<string[]>([]);
    const [aiVersion,setAIVersion]=useState(0);
    const [aiText,setAIText]=useState('');
    const [aiPrompt,setAIPrompt]=useState('');
    const [aiStatus,setAIStatus]=useState('');
    const [aiError,setAIError]=useState('');
    const refineText=useRefineSTTText();
    const updateFile=useUpdateFile();
    const previewRef = useRef<HTMLElement>(null);
    const editorRef = useRef<HTMLTextAreaElement>(null);
    // A delayed initial fetch must never replace a locally saved version.
    const textLoadVersionRef = useRef(0);
    const textFirst = Boolean(file?.prefer_text_view);
    const textReader = Boolean(file && (canPreviewText(file) || textFirst));
    const show = !!file && (textFirst || (file.file_type !== 'audio' && file.file_type !== 'video'));
    const {data:imageLibrary}=useFiles(undefined,'image','',1,'created:desc');
    const imageItems=imageLibrary?.files||[];
    const imageIndex=file?.file_type==='image'?imageItems.findIndex(item=>item.id===file.id):-1;
    const showImageAt=(index:number)=>{const next=imageItems[index];if(next)setContentPreviewFile(next)};

    useEffect(() => { setImageFailed(false); setImageRetry(0); setImageScale(1); setImageQuality('optimized'); setImageDescriptionExpanded(false); setReaderFullscreen(false); setReaderChromeHidden(false); setEditing(false); }, [file?.id]);
    useEffect(()=>{const sync=()=>setReaderToneOptions(getMarkdownThemeOptions());window.addEventListener('komod-markdown-themes-changed',sync);return()=>window.removeEventListener('komod-markdown-themes-changed',sync)},[]);
    useEffect(()=>{const sync=()=>{const next=getMarkdownSettings();setReaderDirection(next.direction);setTextAttachmentPosition(next.textAttachmentPosition)};window.addEventListener('komod-markdown-settings-changed',sync);return()=>window.removeEventListener('komod-markdown-settings-changed',sync)},[]);

    useEffect(()=>{
        const startEditing=(event:Event)=>{const requested=(event as CustomEvent<{fileId?:number}>).detail?.fileId;if(file&&textReader&&(!requested||requested===file.id)){if(textFirst)setDraft(file.description?.trim()||'');setEditing(true)}};
        window.addEventListener('komod-preview-edit',startEditing);
        return()=>window.removeEventListener('komod-preview-edit',startEditing);
    },[file, textFirst, textReader]);

    useEffect(() => {
        localStorage.setItem('komod-reader-font-size', String(readerFontSize));
        localStorage.setItem('komod-reader-line-height', String(readerLineHeight));
        localStorage.setItem('komod-reader-tone', readerTone);
        localStorage.setItem('komod-reader-font', readerFont);
        localStorage.setItem('komod-reader-wrap', readerWrap ? 'on' : 'off');
        localStorage.setItem('komod-reader-wide', readerWide ? 'on' : 'off');
        localStorage.setItem('komod-reader-align', readerAlign);
        localStorage.setItem('komod-reader-direction',readerDirection);
        localStorage.setItem('komod-reader-tools',readerToolsVisible?'visible':'hidden');
    }, [readerFontSize, readerLineHeight, readerTone, readerFont, readerWrap, readerWide, readerAlign, readerDirection, readerToolsVisible]);

    useEffect(() => {
        const syncFullscreen = () => {
            if (!document.fullscreenElement) { setReaderFullscreen(false); setReaderChromeHidden(false); }
        };
        document.addEventListener('fullscreenchange', syncFullscreen);
        return () => document.removeEventListener('fullscreenchange', syncFullscreen);
    }, []);

    useEffect(() => {
        if (!show || !file || (!canPreviewText(file) && !textFirst)) return;
        let cancelled = false;
        const loadVersion = ++textLoadVersionRef.current;
        setLoading(true);
        setContent('');
        setError('');
        const loadText = async () => {
            if (textFirst) {
                const label = file.file_type === 'video' ? 'ویدیو' : file.file_type === 'audio' ? 'صدا' : 'فایل پیوست';
                const attachment = file.file_type === 'image'
                    ? `\n\n![تصویر پیوست](/api/stream/${file.id})`
                    : `\n\n[باز کردن ${label}](komod://file/${file.id})`;
                const description=file.description?.trim()||'';
                return textAttachmentPosition==='start' ? `${attachment.trim()}\n\n${description}` : `${description}${attachment}`;
            }
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
            .then(text => { if (!cancelled && loadVersion === textLoadVersionRef.current) { setContent(text); setDraft(textFirst ? file.description?.trim()||'' : text); } })
            .catch((err) => { if (!cancelled && loadVersion === textLoadVersionRef.current) setError(err instanceof Error ? err.message : 'متن بارگذاری نشد.'); })
            .finally(() => { if (!cancelled && loadVersion === textLoadVersionRef.current) setLoading(false); });
        return () => { cancelled = true; };
    }, [file?.description, file?.id, show, textAttachmentPosition, textFirst]);

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
    const thumbnailUrl=file.thumbnail_url?(file.thumbnail_url.startsWith('blob:')?file.thumbnail_url:`${file.thumbnail_url}${file.thumbnail_url.includes('?')?'&':'?'}token=${encodeURIComponent(token||'')}`):'';
    const selectedImageUrl=imageQuality==='original'||!thumbnailUrl?url:thumbnailUrl;
    const downloadExternalFile=()=>{
        const anchor=document.createElement('a');
        anchor.href=`${authorizedUrl}${authorizedUrl.includes('?')?'&':'?'}download=1`;
        anchor.download=file.file_name;
        anchor.target='_blank';
        anchor.rel='noopener noreferrer';
        document.body.appendChild(anchor);anchor.click();anchor.remove();
    };
    const browserFileUrl=new URL(`${authorizedUrl}${authorizedUrl.includes('?')?'&':'?'}inline=1`,window.location.origin).toString();
    const extension=file.file_name.split('.').pop()?.toLowerCase()||'';
    const inferredMime:Record<string,string>={pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',ppt:'application/vnd.ms-powerpoint',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation',epub:'application/epub+zip',zip:'application/zip'};
    const deviceMime=file.mime_type||inferredMime[extension]||'application/octet-stream';
    const openExternalFile=()=>{
        const telegramWebApp=(window as any).Telegram?.WebApp;
        if(typeof telegramWebApp?.openLink==='function'){
            telegramWebApp.openLink(browserFileUrl,{try_instant_view:false});
            return;
        }
        const anchor=document.createElement('a');
        anchor.href=browserFileUrl;anchor.target='_blank';anchor.rel='noopener noreferrer';
        document.body.appendChild(anchor);anchor.click();anchor.remove();
    };
    const openWithDevice=()=>{
        setOpeningExternal(true);
        try{
            if(/Android/i.test(navigator.userAgent)){
                const target=browserFileUrl.replace(/^https?:\/\//i,'');
                const mime=encodeURIComponent(deviceMime);
                const fallback=encodeURIComponent(browserFileUrl);
                window.location.href=`intent://${target}#Intent;scheme=https;action=android.intent.action.VIEW;type=${mime};S.browser_fallback_url=${fallback};end`;
                return;
            }
            openExternalFile();
            addToast('فایل برای بازشدن با نمایشگر یا برنامهٔ سازگار دستگاه فرستاده شد.','info');
        }finally{
            window.setTimeout(()=>setOpeningExternal(false),700);
        }
    };
    const saveText = async () => {
        setSaving(true);
        try {
            if (textFirst) {
                const updated=await updateFile.mutateAsync({id:file.id,description:draft});
                const description=updated.description?.trim()||'';
                const label = file.file_type === 'video' ? 'ویدیو' : file.file_type === 'audio' ? 'صدا' : 'فایل پیوست';
                const attachment = file.file_type === 'image' ? `![تصویر پیوست](/api/stream/${file.id})` : `[باز کردن ${label}](komod://file/${file.id})`;
                const nextContent=textAttachmentPosition==='start'?`${attachment}\n\n${description}`:`${description}\n\n${attachment}`;
                textLoadVersionRef.current += 1;
                setContent(nextContent);setDraft(description);setEditing(false);addToast('تغییرات متن ذخیره شد.');
                return;
            }
            if (file.id < 0) {
                await updateOfflineTextDraft(file.id, draft);
                textLoadVersionRef.current += 1;
                setContent(draft); setDraft(draft); setEditing(false); addToast('تغییرات یادداشت آفلاین ذخیره شد.');
                return;
            }
            const { data } = await api.patch<{ content: string }>(`/files/${file.id}/text`, { content: draft });
            await cacheTextFile(file, data.content);
            textLoadVersionRef.current += 1;
            setContent(data.content); setDraft(data.content); setEditing(false);
            addToast('تغییرات متن ذخیره شد.');
        } catch (reason: any) {
            addToast(reason?.response?.data?.detail || 'ذخیره متن انجام نشد. دوباره تلاش کن.', 'error');
        } finally { setSaving(false); }
    };
    const toggleReaderFullscreen = async () => {
        const next = !readerFullscreen;
        setReaderFullscreen(next);
        if (next && (textFirst || file?.file_type !== 'image')) setReaderToolsVisible(true);
        try {
            if (next && previewRef.current?.requestFullscreen) await previewRef.current.requestFullscreen();
            else if (!next && document.fullscreenElement) await document.exitFullscreen();
        } catch {
            // Telegram WebView may reject the native Fullscreen API; the in-app
            // full-viewport reader still remains active.
        }
    };
    const minimizeReader=async()=>{if(document.fullscreenElement)await document.exitFullscreen().catch(()=>undefined);setReaderFullscreen(false);setReaderChromeHidden(false);setContentPreviewMinimized(true)};
    const restoreMinimizedReader=()=>{try{const origin=JSON.parse(sessionStorage.getItem('komod-pack-preview-origin')||'null') as {packId?:number;fileId?:number}|null;if(origin?.packId&&origin.fileId===file.id){sessionStorage.removeItem('komod-pack-preview-origin');window.dispatchEvent(new CustomEvent('komod-pack-restore',{detail:{packId:origin.packId,fileId:origin.fileId}}));setContentPreviewFile(null);return}}catch{sessionStorage.removeItem('komod-pack-preview-origin')}setContentPreviewMinimized(false)};
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
    const openAIEditor=()=>{const source=textFirst?(file.description?.trim()||''):content;setAIVersions([source]);setAIVersion(0);setAIText(source);setAIPrompt('');setAIStatus('');setAIError('');setShowAIEditor(true)};
    const applyAIInstruction=async()=>{if(!aiText.trim()||!aiPrompt.trim())return;setAIError('');setAIStatus('درخواست ویرایش در حال ثبت است…');try{const result=await refineText.mutateAsync({content:aiText,prompt:aiPrompt.trim(),onStatus:message=>setAIStatus(message)});const next=[...aiVersions.slice(0,aiVersion+1),result.content];setAIVersions(next);setAIVersion(next.length-1);setAIText(result.content);setAIPrompt('');setAIStatus('نسخه تازه آماده شد.')}catch(reason:any){setAIStatus('');setAIError(reason?.response?.data?.detail||reason?.message||'ویرایش متن انجام نشد.')}};
    const showAIVersion=(nextIndex:number)=>{const next=Math.max(0,Math.min(nextIndex,aiVersions.length-1));setAIVersion(next);setAIText(aiVersions[next]);setAIError('')};
    const saveAIResult=async()=>{if(!file||file.id<0||!aiText.trim())return;setAIError('');setAIStatus('در حال ذخیره در کمد…');try{if(textFirst){const updated=await updateFile.mutateAsync({id:file.id,description:aiText});const description=updated.description?.trim()||'';const label=file.file_type==='video'?'ویدیو':file.file_type==='audio'?'صدا':'فایل پیوست';const attachment=file.file_type==='image'?`![تصویر پیوست](/api/stream/${file.id})`:`[باز کردن ${label}](komod://file/${file.id})`;const nextContent=textAttachmentPosition==='start'?`${attachment}\n\n${description}`:`${description}\n\n${attachment}`;textLoadVersionRef.current+=1;setContent(nextContent);setDraft(description)}else{const {data}=await api.patch<{content:string}>(`/files/${file.id}/text`,{content:aiText});await cacheTextFile(file,data.content);textLoadVersionRef.current+=1;setContent(data.content);setDraft(data.content)}setShowAIEditor(false);addToast('نسخه ویرایش‌شده ذخیره شد.')}catch(reason:any){setAIStatus('');setAIError(reason?.response?.data?.detail||'ذخیره متن انجام نشد.')}};

    if(isContentPreviewMinimized)return <div dir="rtl" className={`fixed inset-x-0 z-[235] border-t border-primary-400/20 bg-dark-900/95 px-3 py-2 shadow-2xl backdrop-blur-xl ${isPlayerMinimized&&previewFile?'bottom-[calc(10rem+env(safe-area-inset-bottom))] md:bottom-20':'bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-0'}`}><div className="mx-auto flex max-w-5xl items-center gap-3"><button onClick={restoreMinimizedReader} className="flex min-w-0 flex-1 items-center gap-3 text-right"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-500/15 text-blue-300"><FileText className="h-5 w-5"/></span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{file.file_name}</strong><small className="mt-0.5 block text-dark-400">ادامهٔ مطالعه</small></span></button><button className="btn-secondary min-h-10 px-3 text-xs" onClick={restoreMinimizedReader}>باز کردن</button><button className="btn-icon" title="بستن متن" onClick={()=>setContentPreviewFile(null)}><X className="h-5 w-5"/></button></div></div>;

    return (
        <div className={`fixed inset-0 z-[220] flex items-center justify-center bg-black/85 backdrop-blur-md ${readerFullscreen ? 'p-0' : 'p-3 sm:p-8'}`} onClick={() => setContentPreviewFile(null)}>
            <section ref={previewRef} className={`relative flex w-full flex-col overflow-hidden border border-white/10 bg-dark-900 shadow-2xl ${readerFullscreen ? 'h-dvh max-h-none max-w-none rounded-none border-0' : 'max-h-full max-w-5xl rounded-2xl'}`} onClick={(event) => event.stopPropagation()}>
                {!readerChromeHidden&&<header className="flex items-start gap-3 border-b border-white/10 px-3 py-3 sm:px-5 sm:py-4">
                    <div className="flex-1 min-w-0">
                        <h2 className="truncate font-semibold" title={file.file_name}>{file.file_name}</h2>
                        {!textFirst&&file.file_type !== 'image' && file.description && <p dir="auto" className="mt-1 line-clamp-2 max-w-2xl whitespace-pre-wrap text-sm text-dark-400" title={file.description}><MarkdownInline content={file.description}/></p>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        {contentPreviewHistory.length>0&&<button onClick={goBackContentPreview} className="flex min-h-9 items-center gap-1.5 rounded-xl bg-primary-500/12 px-2.5 text-xs text-primary-200" title="برگشت به متن قبلی"><ArrowRight className="h-4 w-4"/><span className="hidden sm:inline">برگشت به متن</span></button>}
                        {textReader&&<button onClick={()=>void minimizeReader()} className="btn-icon" title="مینیمایز کردن متن"><PanelBottomClose className="h-5 w-5"/></button>}
                        {textReader && <><button onClick={openAIEditor} disabled={file.id<0||loading} className="btn-icon text-primary-200 disabled:opacity-30" title="ویرایش با هوش مصنوعی"><Sparkles className="h-5 w-5"/></button><button onClick={()=>setReaderToolsVisible(value=>!value)} className={`btn-icon ${readerToolsVisible?'text-primary-200':''}`} title={readerToolsVisible?'مخفی‌کردن تنظیمات مطالعه':'نمایش تنظیمات مطالعه'}><Settings2 className="h-5 w-5"/></button><button onClick={async () => { await navigator.clipboard.writeText(editing ? draft : content); addToast('متن کپی شد 📋'); }} className="btn-icon" title="کپی متن"><Copy className="h-5 w-5" /></button><button onClick={() => {if(!editing&&textFirst)setDraft(file.description?.trim()||'');setEditing(value => !value)}} className={`btn-secondary flex shrink-0 items-center gap-2 px-3 py-2 text-xs ${editing?'text-primary-200':''}`} title={editing?'حالت مطالعه':'ویرایش متن'}>{editing?<BookOpen className="h-4 w-4"/>:<Pencil className="h-4 w-4"/>}<span className="hidden sm:inline">{editing?'مطالعه':'ویرایش'}</span></button>{readerFullscreen&&<button onClick={()=>setReaderChromeHidden(true)} className="btn-icon" title="حالت مطالعه بدون نوار"><EyeOff className="h-5 w-5"/></button>}<button onClick={() => void toggleReaderFullscreen()} className="btn-icon" title={readerFullscreen ? 'خروج از تمام‌صفحه' : 'مطالعه در تمام‌صفحه'}>{readerFullscreen ? <Minimize2 className="h-5 w-5"/> : <Maximize2 className="h-5 w-5"/>}</button></>}
                        <button onClick={() => setContentPreviewFile(null)} className="btn-icon" title="بستن"><X className="w-5 h-5" /></button>
                    </div>
                </header>}
                {readerChromeHidden&&<button type="button" onClick={()=>setReaderChromeHidden(false)} className="absolute left-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full border border-white/10 bg-black/25 text-white/35 opacity-20 backdrop-blur transition hover:opacity-100 focus:opacity-100" title="نمایش نوارها"><Eye className="h-4 w-4"/></button>}
                {file.file_type === 'image' && !textFirst ? (
                    <div className="relative min-h-0 flex-1 p-4 pb-20 text-center">
                        {imageFailed ? <div className="mx-auto rounded-2xl border border-dashed border-white/10 p-8 text-center"><p className="text-sm text-dark-400">نمایش عکس انجام نشد.</p><button className="btn-secondary mt-4" onClick={() => { setImageFailed(false); setImageRetry(Date.now()); }}>تلاش دوباره</button></div> : <div className="h-full min-h-[45vh] w-full"><ZoomableImage key={selectedImageUrl} src={selectedImageUrl} previewSrc={imageQuality==='original'?thumbnailUrl:''} alt={file.file_name} scale={imageScale} onScaleChange={setImageScale}/></div>}
                        <div className="absolute inset-x-2 bottom-2 mx-auto w-auto max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-dark-900/90 p-2 shadow-2xl backdrop-blur-xl sm:inset-x-4"><div className="overflow-hidden"><div className="mx-auto flex min-w-0 items-center justify-center gap-0.5">{imageItems.length>1&&<button disabled={imageIndex<=0} onClick={()=>showImageAt(imageIndex-1)} className="btn-icon shrink-0 disabled:opacity-25" title="عکس قبلی"><ChevronRight className="h-5 w-5"/></button>}<button onClick={()=>setImageScale(value=>Math.max(1,Number((value-.25).toFixed(2))))} className="btn-icon shrink-0" title="کوچک‌نمایی"><ZoomOut className="h-5 w-5"/></button><span dir="ltr" className="min-w-12 shrink-0 text-center text-xs text-dark-300">{Math.round(imageScale*100)}%</span><button onClick={()=>setImageScale(value=>Math.min(6,Number((value+.25).toFixed(2))))} className="btn-icon shrink-0" title="بزرگ‌نمایی"><ZoomIn className="h-5 w-5"/></button>{thumbnailUrl&&<button onClick={()=>{setImageFailed(false);setImageScale(1);setImageQuality(value=>value==='original'?'optimized':'original')}} className={`btn-icon h-8 w-8 shrink-0 ${imageQuality==='original'?'bg-primary-500/15 text-primary-200':'text-dark-300'}`} title={imageQuality==='original'?'نمایش نسخه بهینه':'نمایش کیفیت اصلی'}><ImageIcon className="h-4 w-4"/></button>}<button onClick={() => void toggleReaderFullscreen()} className="btn-icon shrink-0" title={readerFullscreen?'خروج از تمام‌صفحه':'تمام‌صفحه'}>{readerFullscreen?<Minimize2 className="h-5 w-5"/>:<Maximize2 className="h-5 w-5"/>}</button>{imageItems.length>1&&<button disabled={imageIndex<0||imageIndex>=imageItems.length-1} onClick={()=>showImageAt(imageIndex+1)} className="btn-icon shrink-0 disabled:opacity-25" title="عکس بعدی"><ChevronLeft className="h-5 w-5"/></button>}</div></div>{file.description&&<button dir="auto" onClick={()=>setImageDescriptionExpanded(true)} className="mt-1 w-full border-t border-white/[.07] px-2 pt-2 text-right text-xs leading-6 text-dark-300"><span className="line-clamp-2"><MarkdownInline content={file.description}/></span><span className="mr-1 text-primary-300">بیشتر</span></button>}</div>
                    </div>
                ) : (canPreviewText(file) || textFirst) ? (
                    <>
                        {readerToolsVisible&&!readerChromeHidden&&<div className="flex shrink-0 items-center gap-2 overflow-x-auto overscroll-x-contain border-b border-white/[.06] bg-dark-950/70 px-3 py-2 sm:flex-wrap sm:px-5">
                            <div className="min-w-40 shrink-0"><CustomSelect value={readerFont} onChange={setReaderFont} options={readerFonts}/></div>
                            <div className="min-w-36 shrink-0"><CustomSelect value={readerTone} onChange={setReaderTone} options={readerToneOptions}/></div>
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
                                {readerAlign==='justify'&&<div className="flex shrink-0 items-center rounded-xl border border-white/[.07] bg-dark-800/70 p-1"><button onClick={()=>setReaderDirection('rtl')} className={`h-8 rounded-lg px-2 text-[10px] ${readerDirection==='rtl'?'bg-primary-500/20 text-primary-100':'text-dark-400'}`}>از راست</button><button onClick={()=>setReaderDirection('ltr')} className={`h-8 rounded-lg px-2 text-[10px] ${readerDirection==='ltr'?'bg-primary-500/20 text-primary-100':'text-dark-400'}`}>از چپ</button></div>}
                                <div className="flex h-10 items-center rounded-xl border border-white/[.07] bg-dark-800/70 p-1" title="فاصله بین خط‌ها"><button className="flex h-8 w-8 items-center justify-center rounded-lg text-dark-300 hover:bg-white/[.06] disabled:opacity-30" disabled={readerLineHeight<=1.4} onClick={()=>setReaderLineHeight(value=>Math.max(1.4,Number((value-.1).toFixed(1))))}><Minus className="h-4 w-4"/></button><span dir="ltr" className="min-w-10 text-center text-[10px] text-dark-300">{readerLineHeight.toFixed(1)}</span><button className="flex h-8 w-8 items-center justify-center rounded-lg text-dark-300 hover:bg-white/[.06] disabled:opacity-30" disabled={readerLineHeight>=2.8} onClick={()=>setReaderLineHeight(value=>Math.min(2.8,Number((value+.1).toFixed(1))))}><Plus className="h-4 w-4"/></button></div>
                                <button onClick={() => setReaderWrap(value => !value)} className={`btn-icon h-10 w-10 ${readerWrap ? 'text-primary-200' : ''}`} title={readerWrap ? 'خاموش‌کردن شکستن خط‌ها' : 'شکستن خودکار خط‌ها'}><WrapText className="h-4 w-4"/></button>
                                <button onClick={() => setReaderWide(value => !value)} className={`btn-icon h-10 w-10 ${readerWide ? 'text-primary-200' : ''}`} title={readerWide ? 'عرض معمولی متن' : 'استفاده از تمام عرض'}><MoveHorizontal className="h-4 w-4"/></button>
                                <button onClick={() => setReaderTone(tone => tone === 'dark' ? 'white' : 'dark')} className="btn-icon h-10 w-10" title="جابجایی سریع حالت شب و روز">{readerTone === 'dark' ? <Sun className="h-4 w-4"/> : <Moon className="h-4 w-4"/>}</button>
                            </div>
                        </div>}
                        <div className={`markdown-reader-surface markdown-reader-surface--${readerTone} min-h-0 flex-1 overflow-auto p-4 transition-colors sm:p-8`}>
                            {loading ? <p className="text-dark-400">در حال بارگذاری متن…</p> : error ? <p className="text-red-400">{error}</p> : editing ? <div className={`mx-auto ${readerWide?'max-w-none':'max-w-5xl'}`}><div className="markdown-editor-toolbar mb-2 grid grid-cols-6 gap-1 rounded-2xl border p-1.5 sm:flex sm:flex-wrap"><EditorTool title="سرتیتر" onClick={()=>insertMarkdown('# ','','عنوان',true)}><Heading1/></EditorTool><EditorTool title="بولد" onClick={()=>insertMarkdown('**','**')}><Bold/></EditorTool><EditorTool title="ایتالیک" onClick={()=>insertMarkdown('*','*')}><Italic/></EditorTool><EditorTool title="زیرخط" onClick={()=>insertMarkdown('<u>','</u>')}><Underline/></EditorTool><EditorTool title="خط‌خورده" onClick={()=>insertMarkdown('~~','~~')}><Strikethrough/></EditorTool><EditorTool title="کد کوتاه" onClick={()=>insertMarkdown('`','`','code')}><Code2/></EditorTool><EditorTool title="کدبلاک" onClick={()=>insertMarkdown('```\n','\n```','code',true)}><Code2/></EditorTool><EditorTool title="فرمول ریاضی" onClick={()=>insertMarkdown('$','$','x^2 + y^2')}><Sigma/></EditorTool><EditorTool title="متغیر" onClick={()=>insertMarkdown('{{','}}','نام_متغیر')}><Braces/></EditorTool><EditorTool title="لینک وب" onClick={()=>insertMarkdown('[','](https://)','عنوان لینک')}><Link/></EditorTool><EditorTool title="لینک به فایل کمد" onClick={()=>setShowInternalLinkPicker(true)}><Link2/></EditorTool><EditorTool title="تصویر" onClick={()=>insertMarkdown('![','](https://)','توضیح تصویر')}><ImageIcon/></EditorTool><EditorTool title="نقل‌قول" onClick={()=>insertMarkdown('> ','','متن نقل‌قول',true)}><Quote/></EditorTool><EditorTool title="فهرست" onClick={()=>insertMarkdown('- ','','مورد',true)}><List/></EditorTool><EditorTool title="فهرست شماره‌ای" onClick={()=>insertMarkdown('1. ','','مورد',true)}><ListOrdered/></EditorTool><EditorTool title="چک‌لیست" onClick={()=>insertMarkdown('- [ ] ','','کار',true)}><ListChecks/></EditorTool><EditorTool title="خط جداکننده" onClick={()=>insertTemplate('---\n')}><Minus/></EditorTool><EditorTool title="جدول" onClick={()=>insertTemplate('| ستون ۱ | ستون ۲ |\n| --- | --- |\n| مقدار ۱ | مقدار ۲ |\n')}><Table2/></EditorTool></div><textarea ref={editorRef} dir="auto" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='b'){event.preventDefault();insertMarkdown('**','**')}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='i'){event.preventDefault();insertMarkdown('*','*')}}} className={`markdown-editor markdown-font--${readerFont} min-h-[65vh] w-full resize-y rounded-2xl border p-4 caret-primary-300 outline-none selection:bg-primary-500/30 focus:border-primary-400`} style={{ fontSize: readerFontSize, lineHeight: readerLineHeight }}/><div className="mt-3 flex justify-end gap-2"><button className="btn-secondary" onClick={() => { setDraft(content); setEditing(false); }}>لغو</button><button disabled={saving} className="btn-primary flex items-center gap-2" onClick={() => void saveText()}><Check className="h-4 w-4"/> {saving ? 'در حال ذخیره…' : 'ذخیره متن'}</button></div></div> : <MarkdownContent content={content} fontSize={readerFontSize} lineHeight={readerLineHeight} theme={readerTone} fontFamily={readerFont} wrap={readerWrap} wide={readerWide} align={readerAlign} direction={readerDirection} />}
                        </div>
                    </>
                ) : (
                    <div className="flex min-h-[26rem] flex-1 items-center justify-center overflow-y-auto p-4 sm:p-8" dir="rtl">
                        <div className="w-full max-w-lg rounded-3xl border border-white/[.08] bg-dark-950/35 p-5 text-center shadow-inner sm:p-8">
                            <span className="mx-auto flex h-20 w-20 items-center justify-center rounded-3xl border border-primary-400/20 bg-primary-500/10 text-primary-200"><FileBox className="h-10 w-10"/></span>
                            <h3 dir="auto" className="mt-5 break-words text-lg font-bold">{file.file_name}</h3>
                            <p className="mt-2 text-sm leading-7 text-dark-400">این فایل داخل مرورگر پیش‌نمایش مستقیمی ندارد. می‌توانی آن را با برنامه‌های نصب‌شده روی دستگاه باز کنی.</p>
                            <div className="mt-6 grid gap-2 sm:grid-cols-2">
                                <button disabled={openingExternal} onClick={openWithDevice} className="btn-primary flex min-h-12 items-center justify-center gap-2 disabled:opacity-50"><Smartphone className="h-4 w-4"/>{openingExternal?'در حال باز کردن…':'باز کردن با برنامه دستگاه'}</button>
                                <button onClick={openExternalFile} className="btn-secondary flex min-h-12 items-center justify-center gap-2"><ExternalLink className="h-4 w-4"/>باز کردن در مرورگر</button>
                                <button onClick={downloadExternalFile} className="btn-secondary flex min-h-11 items-center justify-center gap-2 sm:col-span-2"><Download className="h-4 w-4"/>دانلود فایل</button>
                            </div>
                            <p className="mt-4 text-[11px] leading-6 text-dark-500">نمایش فهرست برنامه‌ها به مرورگر و سیستم‌عامل دستگاه بستگی دارد.</p>
                        </div>
                    </div>
                )}
            </section>
            {showInternalLinkPicker&&<InternalFileLinkPicker onClose={()=>setShowInternalLinkPicker(false)} onSelect={linkedFile=>{insertMarkdown('[',`](komod://file/${linkedFile.id})`,linkedFile.file_name);setShowInternalLinkPicker(false)}}/>}
            {imageDescriptionExpanded&&file.file_type==='image'&&file.description&&<div className="fixed inset-0 z-[305] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-5" onClick={()=>setImageDescriptionExpanded(false)}><section dir="auto" className="max-h-[70dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-white/10 bg-dark-900 p-5 text-right shadow-2xl sm:rounded-3xl" onClick={event=>event.stopPropagation()}><header className="mb-3 flex items-center justify-between" dir="rtl"><strong className="text-sm">توضیحات عکس</strong><button className="btn-icon" onClick={()=>setImageDescriptionExpanded(false)}><X className="h-5 w-5"/></button></header><div className="whitespace-pre-wrap break-words text-sm leading-8 text-dark-200"><MarkdownInline content={file.description}/></div></section></div>}
            {showAIEditor&&<div className="fixed inset-0 z-[310] flex items-end justify-center bg-black/75 p-0 backdrop-blur-md sm:items-center sm:p-5" onClick={()=>setShowAIEditor(false)}><section dir="rtl" className="flex h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-dark-900 shadow-2xl sm:h-[88dvh] sm:rounded-3xl" onClick={event=>event.stopPropagation()}><header className="flex items-center gap-3 border-b border-white/[.07] p-4"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/15 text-primary-200"><Sparkles className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="truncate font-bold">ویرایش فایل با هوش مصنوعی</h2><p className="mt-1 text-[11px] text-dark-400">هر دستور یک نسخه تازه می‌سازد و نسخه اصلی تا زمان ذخیره تغییر نمی‌کند.</p></div><button className="btn-icon" onClick={()=>setShowAIEditor(false)}><X className="h-5 w-5"/></button></header><div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3 sm:grid-cols-[minmax(0,1.5fr)_minmax(17rem,.75fr)] sm:overflow-hidden sm:p-4"><div className="flex min-h-[18rem] flex-col overflow-hidden rounded-2xl border border-white/[.07] bg-dark-950/35"><div className="flex items-center gap-2 border-b border-white/[.06] p-2"><button disabled={aiVersion===0} onClick={()=>showAIVersion(aiVersion-1)} className="btn-icon h-9 w-9 disabled:opacity-30" title="نسخه قبلی"><Undo2 className="h-4 w-4"/></button><button disabled={aiVersion===aiVersions.length-1} onClick={()=>showAIVersion(aiVersion+1)} className="btn-icon h-9 w-9 disabled:opacity-30" title="نسخه بعدی"><Redo2 className="h-4 w-4"/></button><span className="mr-auto rounded-lg bg-white/[.05] px-2 py-1 text-[10px] text-dark-400">نسخه {(aiVersion+1).toLocaleString('fa-IR')} از {aiVersions.length.toLocaleString('fa-IR')}</span></div><textarea dir="auto" value={aiText} onChange={event=>setAIText(event.target.value)} className="min-h-[18rem] flex-1 resize-none bg-transparent p-4 text-sm leading-8 text-dark-100 outline-none [overflow-wrap:anywhere]"/></div><aside className="space-y-3 sm:min-h-0 sm:overflow-y-auto"><div className="rounded-2xl border border-white/[.07] bg-dark-950/35 p-3"><p className="text-xs font-semibold text-dark-200">چه تغییری بدم؟</p><div className="mt-2 flex flex-wrap gap-1.5">{[['خلاصه','متن را خلاصه کن و نکته‌های مهم را نگه دار.'],['روان‌تر','متن را روان و خوش‌خوان بازنویسی کن، بدون تغییر معنی.'],['عنوان‌بندی','متن را با عنوان‌ها و زیرعنوان‌های مناسب Markdown ساختاربندی کن.'],['پاک‌سازی','تکرارها و عبارت‌های زائد را حذف و متن را ویرایش کن.']].map(([label,prompt])=><button key={label} onClick={()=>setAIPrompt(prompt)} className="rounded-full border border-primary-400/15 bg-primary-500/[.07] px-2.5 py-1.5 text-[11px] text-primary-200">{label}</button>)}</div><textarea value={aiPrompt} onChange={event=>setAIPrompt(event.target.value)} className="input mt-3 min-h-28 w-full resize-none text-right leading-6" placeholder="دستور دلخواهت را بنویس…" maxLength={4000}/><button disabled={!aiPrompt.trim()||!aiText.trim()||refineText.isPending} onClick={()=>void applyAIInstruction()} className="btn-primary mt-2 flex min-h-11 w-full items-center justify-center gap-2 disabled:opacity-40"><Wand2 className="h-4 w-4"/>{refineText.isPending?(aiStatus||'در حال ویرایش…'):'اعمال روی متن'}</button>{aiStatus&&!refineText.isPending&&<p className="mt-2 rounded-xl bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">{aiStatus}</p>}{aiError&&<p className="mt-2 rounded-xl bg-red-500/10 px-3 py-2 text-xs leading-6 text-red-300">{aiError}</p>}</div><button disabled={!aiText.trim()||refineText.isPending} onClick={()=>void saveAIResult()} className="btn-primary flex min-h-11 w-full items-center justify-center gap-2 disabled:opacity-40"><Check className="h-4 w-4"/>ذخیره روی همین فایل</button></aside></div></section></div>}
        </div>
    );
}
function EditorTool({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
    return <button type="button" title={title} aria-label={title} onClick={onClick} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/[.07] hover:text-primary-200 [&>svg]:h-4 [&>svg]:w-4">{children}</button>;
}
