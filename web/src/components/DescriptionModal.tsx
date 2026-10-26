import { useEffect, useRef, useState } from 'react';
import { AlignLeft, AtSign, Eye, Hash, ImagePlus, Link, Link2, Pencil, Sparkles, X } from 'lucide-react';
import InternalFileLinkPicker from './InternalFileLinkPicker';
import MarkdownContent from './MarkdownContent';
import { getMarkdownSettings } from '../lib/markdownSettings';
import { api, TelegramFile } from '../lib/api';

interface DescriptionModalProps {
    isOpen: boolean;
    itemType: 'file' | 'folder';
    currentDescription: string;
    initialPreview?: boolean;
    onClose: () => void;
    onSave: (description: string) => Promise<void>;
}

export default function DescriptionModal({ isOpen, itemType, currentDescription, initialPreview=false, onClose, onSave }: DescriptionModalProps) {
    const [description, setDescription] = useState(currentDescription);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const [showFilePicker,setShowFilePicker]=useState(false);
    const [preview,setPreview]=useState(false);
    const textareaRef=useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (isOpen) {
            setDescription(currentDescription);
            setError('');
            setPreview(initialPreview);
        }
    }, [isOpen, currentDescription, initialPreview]);

    if (!isOpen) return null;
    const insertLink=(title:string,url:string)=>{const input=textareaRef.current;if(!input)return;const start=input.selectionStart,end=input.selectionEnd,selected=description.slice(start,end)||title;const value=`[${selected}](${url})`;setDescription(`${description.slice(0,start)}${value}${description.slice(end)}`);requestAnimationFrame(()=>{input.focus();input.setSelectionRange(start+value.length,start+value.length)})};
    const cleanDescription=(kind:'links'|'mentions'|'hashtags'|'all')=>{
        let next=description;
        if(kind==='links'||kind==='all') next=next.replace(/\[([^\]]*)\]\((?:https?:\/\/|www\.)[^)]+\)/giu,'$1').replace(/(?:https?:\/\/|www\.)\S+/giu,' ');
        if(kind==='mentions'||kind==='all') next=next.replace(/(^|\s)@[\p{L}\p{N}_]{3,}/gu,'$1');
        if(kind==='hashtags'||kind==='all') next=next.replace(/(^|\s)#[\p{L}\p{N}_\u200c-]+/gu,'$1');
        setDescription(next.replace(/[ \t]{2,}/g,' ').replace(/\n[ \t]+/g,'\n').trim());
    };

    const persist = async (value:string) => {
        setSaving(true);
        setError('');
        try {
            await onSave(value.trim());
            onClose();
        } catch (reason:any) {
            setError(reason?.response?.data?.detail||reason?.message||'توضیحات ذخیره نشد. دوباره تلاش کن.');
        } finally {
            setSaving(false);
        }
    };
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        await persist(description);
    };

    return (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <form onSubmit={submit} className="glass-card w-full max-w-lg p-6 animate-slide-up">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <AlignLeft className="w-5 h-5 text-primary-400" />
                        {preview ? 'پیش‌نمایش' : currentDescription ? 'ویرایش' : 'افزودن'} توضیحات {itemType === 'file' ? 'فایل' : 'کشو'}
                    </h2>
                    <button type="button" onClick={onClose} className="p-1 hover:bg-dark-700 rounded"><X className="w-5 h-5" /></button>
                </div>
                <div className="mb-2 flex items-center gap-1 rounded-xl border border-white/[.06] bg-white/[.025] p-1">{!preview&&<><button type="button" className="btn-icon h-9 w-9" title="پیوند وب" onClick={()=>insertLink('عنوان لینک','https://')}><Link className="h-4 w-4"/></button><button type="button" className="btn-icon h-9 w-9" title="تصویر از نشانی وب" onClick={()=>{const input=textareaRef.current;if(!input)return;const start=input.selectionStart,end=input.selectionEnd,alt=description.slice(start,end)||'تصویر',value=`![${alt}](https://)`;setDescription(`${description.slice(0,start)}${value}${description.slice(end)}`)}}><ImagePlus className="h-4 w-4"/></button><button type="button" className="btn-icon h-9 w-9" title="پیوند به فایل کمد" onClick={()=>setShowFilePicker(true)}><Link2 className="h-4 w-4"/></button></>}<span className="mr-1 min-w-0 flex-1 text-xs text-dark-500">{preview?'نمایش نهایی متن، پیوندها و رسانه‌ها':'پیوند یا تصویر را در محل نشانگر بگذار'}</span><button type="button" onClick={()=>setPreview(value=>!value)} className={`flex h-9 items-center gap-1 rounded-lg px-2 text-xs ${preview?'bg-primary-500/15 text-primary-100':'text-dark-300'}`}>{preview?<Pencil className="h-3.5 w-3.5"/>:<Eye className="h-3.5 w-3.5"/>}{preview?'ویرایش':'پیش‌نمایش'}</button></div>{preview?<DescriptionPreview content={description}/>:<textarea
                    ref={textareaRef}
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                        maxLength={20000}
                    rows={7}
                    autoFocus
                    placeholder="یک توضیح کوتاه بنویس…"
                    className="w-full resize-y px-4 py-3 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />}
                {!preview&&<div className="mt-2 rounded-xl border border-white/[.06] bg-white/[.025] p-1.5">
                    <div className="mb-1 flex items-center gap-1.5 px-1 text-[10px] text-dark-500"><Sparkles className="h-3.5 w-3.5"/>تمیزکاری توضیحات</div>
                    <div className="grid grid-cols-4 gap-1">
                        <button type="button" onClick={()=>cleanDescription('links')} className="flex min-h-9 items-center justify-center gap-1 rounded-lg text-[10px] text-dark-300 hover:bg-white/[.05]"><Link className="h-3.5 w-3.5"/>لینک‌ها</button>
                        <button type="button" onClick={()=>cleanDescription('mentions')} className="flex min-h-9 items-center justify-center gap-1 rounded-lg text-[10px] text-dark-300 hover:bg-white/[.05]"><AtSign className="h-3.5 w-3.5"/>آیدی‌ها</button>
                        <button type="button" onClick={()=>cleanDescription('hashtags')} className="flex min-h-9 items-center justify-center gap-1 rounded-lg text-[10px] text-dark-300 hover:bg-white/[.05]"><Hash className="h-3.5 w-3.5"/>هشتگ‌ها</button>
                        <button type="button" onClick={()=>cleanDescription('all')} className="min-h-9 rounded-lg bg-primary-500/10 px-1 text-[10px] text-primary-200 hover:bg-primary-500/15">پاک‌سازی همه</button>
                    </div>
                </div>}
                {!preview&&<div className="flex justify-between mt-2 text-xs text-dark-400">
                    <span>برای حذف توضیحات، این بخش را خالی بگذار.</span>
                    <span>{description.length.toLocaleString('fa-IR')}/۲۰٬۰۰۰</span>
                </div>}
                {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
                <div className="flex justify-end gap-3 mt-5">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-dark-400 hover:text-white">لغو</button>
                    {!preview&&currentDescription && (
                        <button type="button" disabled={saving} onClick={() => void persist('')} className="px-4 py-2 text-red-400 hover:bg-red-500/10 rounded-lg">پاک‌کردن و ذخیره</button>
                    )}
                    {!preview&&<button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg font-medium disabled:opacity-50">
                        {saving ? 'در حال ذخیره…' : 'ذخیره'}
                    </button>}
                </div>
            </form>
            {showFilePicker&&<InternalFileLinkPicker onClose={()=>setShowFilePicker(false)} onSelect={file=>{const input=textareaRef.current;if(file.file_type==='image'&&input){const start=input.selectionStart,end=input.selectionEnd,alt=description.slice(start,end)||file.file_name,value=`![${alt}](/api/stream/${file.id})`;setDescription(`${description.slice(0,start)}${value}${description.slice(end)}`)}else insertLink(file.file_name,`komod://file/${file.id}`);setShowFilePicker(false)}}/>}
        </div>
    );
}

function DescriptionPreview({content}:{content:string}){
    const settings=getMarkdownSettings();
    const [attachments,setAttachments]=useState<TelegramFile[]>([]);
    useEffect(()=>{const ids=[...content.matchAll(/komod:\/\/file\/(\d+)/g)].map(match=>Number(match[1]));let active=true;if(!ids.length){setAttachments([]);return}Promise.all([...new Set(ids)].map(id=>api.get<TelegramFile>(`/files/${id}`).then(response=>response.data).catch(()=>null))).then(files=>{if(active)setAttachments(files.filter(Boolean) as TelegramFile[])});return()=>{active=false}},[content]);
    return <div className="max-h-[45dvh] min-h-52 overflow-y-auto rounded-2xl border border-white/[.07] bg-dark-950/35 p-2">{content.trim()?<><MarkdownContent content={content} fontSize={settings.fontSize} lineHeight={settings.lineHeight} theme={settings.theme} fontFamily={settings.font} wrap={settings.wrap} wide align={settings.align} direction={settings.direction}/>{attachments.length>0&&<div className="mt-2 grid gap-2 sm:grid-cols-2">{attachments.map(file=><div key={file.id} className="overflow-hidden rounded-xl border border-white/[.07] bg-dark-900/70">{file.file_type==='video'?<video controls preload="metadata" src={file.stream_url} className="max-h-56 w-full bg-black"/>:file.file_type==='audio'?<audio controls preload="metadata" src={file.stream_url} className="w-full p-2"/>:file.file_type==='image'?<img src={file.thumbnail_url||file.stream_url} alt={file.file_name} className="max-h-56 w-full object-contain"/>:<a href={file.stream_url} target="_blank" rel="noreferrer" className="block p-3 text-xs text-primary-200">{file.file_name}</a>}<p className="truncate px-3 py-2 text-[11px] text-dark-400">{file.file_name}</p></div>)}</div>}</>:<p className="p-6 text-center text-sm text-dark-500">هنوز توضیحی برای پیش‌نمایش وجود ندارد.</p>}</div>;
}
