import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Check, ClipboardCopy, FileAudio, Headphones, Maximize2, Minimize2, Pause, Play, Plus, Redo2, RotateCcw, Save, Sparkles, Square, Trash2, Undo2, Volume2, Wand2, X } from 'lucide-react';
import { api, Folder, STTJobStatus, useCancelSTTJob, useClearFinishedTTSJobs, useControlTTSJob, useCreateSTTJob, useCreateTTSJob, useDeleteGeminiKeys, useDismissSTTJob, useDismissTTSJob, useFiles, useFolderTree, useGeminiKeys, useRefineSTTText, useSTTJobs, useTTSJobs, useTTSSettings, useUpdateGeminiKeys, useUpdateTTSSettings, useUploadFile } from '../lib/api';
import CustomSelect from './CustomSelect';

const STATES:Record<string,string>={queued:'در صف',paused:'متوقف',synthesizing:'در حال ساخت',merging:'در حال یکپارچه‌سازی',uploading:'در حال ذخیره',done:'آماده',error:'خطا',cancelled:'لغوشده'};
const GENDERS=[{value:'all',label:'همه صداها'},{value:'female',label:'صدای زن'},{value:'male',label:'صدای مرد'}] as const;
const PITCHES=[{value:'all',label:'همه زیر و بمی‌ها'},{value:'high',label:'زیر و روشن'},{value:'medium',label:'متعادل'},{value:'low',label:'بم و عمیق'}] as const;
const USE_CASES=[{value:'general',label:'کاربرد عمومی'},{value:'audiobook',label:'کتاب صوتی'},{value:'podcast',label:'پادکست'},{value:'story',label:'داستان'},{value:'education',label:'آموزش'},{value:'news',label:'خبر و گزارش'},{value:'advertising',label:'معرفی و تبلیغ'},{value:'accessibility',label:'خوانش دسترس‌پذیر'}] as const;
const CUES=[
    {label:'مکث کوتاه',tag:'[short pause]'},{label:'مکث بلند',tag:'[long pause]'},{label:'آه',tag:'[sigh]'},
    {label:'خنده',tag:'[chuckle]'},{label:'قهقهه',tag:'[laughs]'},{label:'نفس',tag:'[breath]'},
    {label:'سرفه',tag:'[cough]'},{label:'نفس راحت',tag:'[relieved sigh]'},{label:'تعجب',tag:'[gasp]'},
];
const SCOPED_CUES=[
    {label:'نجوا',tag:'[whispering]'},{label:'آرام',tag:'[soft]'},{label:'هیجان',tag:'[excited]'},{label:'غمگین',tag:'[sad]'},
    {label:'عصبانی',tag:'[angry]'},{label:'رسمی',tag:'[formal]'},{label:'داستانی',tag:'[storytelling]'},
];
const TAG_LABELS:Record<string,string>={
    '[short pause]':'مکث کوتاه','[long pause]':'مکث بلند','[sigh]':'آه','[chuckle]':'خنده','[laughs]':'قهقهه',
    '[breath]':'نفس','[cough]':'سرفه','[relieved sigh]':'نفس راحت','[gasp]':'تعجب',
    '[whispering]':'نجوا','[soft]':'آرام','[excited]':'هیجان','[sad]':'غمگین','[angry]':'عصبانی',
    '[formal]':'رسمی','[storytelling]':'داستانی','[resumes normal speech]':'بازگشت به لحن عادی',
};

const LEGACY_TAGS:Record<string,string>={
    'short pause':'short pause','long pause':'long pause',sigh:'sigh',phew:'relieved sigh',laugh:'chuckle',laughter:'laughs',
    breath:'breath',cough:'cough',gasp:'gasp',whisper:'whispering',soft:'soft',excited:'excited',sad:'sad',angry:'angry',formal:'formal',story:'storytelling',
};
function normalizeDirectorNotes(value:string){
    return value.replace(/<\s*(\/?)\s*([^<>]+?)\s*>/g,(_match,closing:string,raw:string)=>{
        const key=raw.trim().toLowerCase();
        if(closing&&['whisper','soft','excited','sad','angry','formal','story'].includes(key))return '[resumes normal speech]';
        return `[${LEGACY_TAGS[key]||key}]`;
    }).replace(/[<>]/g,'');
}

function TaggedTextPreview({text,fullscreen=false}:{text:string;fullscreen?:boolean}){
    const normalized=normalizeDirectorNotes(text);
    const pieces=normalized.split(/(\[[^\]\n]+\])/g).filter(Boolean);
    return <div className={`mt-2 whitespace-pre-wrap overflow-y-auto rounded-xl border border-white/[.07] bg-dark-950/35 p-3 text-xs leading-7 text-dark-300 ${fullscreen?'min-h-0 flex-1':'min-h-24 max-h-32'}`} dir="auto">{pieces.length?pieces.map((piece,index)=>/^\[[^\]\n]+\]$/.test(piece)?<span key={index} className="mx-1 inline-flex rounded-full border border-primary-400/15 bg-primary-500/15 px-2 py-0.5 text-[10px] font-medium text-primary-200">{TAG_LABELS[piece.toLowerCase()]||piece.slice(1,-1)}</span>:<span key={index}>{piece}</span>):<span className="text-dark-600">پیش‌نمایش متن و تگ‌ها اینجا دیده می‌شود.</span>}</div>;
}

const formatAudioTime=(value:number)=>{const safe=Number.isFinite(value)&&value>0?Math.floor(value):0;return `${Math.floor(safe/60)}:${String(safe%60).padStart(2,'0')}`};
const authenticatedMediaUrl=(source:string)=>{
    if(!source||source.startsWith('blob:')||source.startsWith('data:'))return source;
    try{
        const url=new URL(source,window.location.origin);
        const token=localStorage.getItem('access_token');
        const vaultToken=sessionStorage.getItem('komod-vault-token');
        if(token&&!url.searchParams.has('token'))url.searchParams.set('token',token);
        if(vaultToken&&!url.searchParams.has('vault_token'))url.searchParams.set('vault_token',vaultToken);
        return url.toString();
    }catch{return source}
};

function InlineAudioPlayer({src,label,autoPlay=false}:{src:string;label:string;autoPlay?:boolean}){
    const audioRef=useRef<HTMLAudioElement|null>(null);
    const [playing,setPlaying]=useState(false);
    const [current,setCurrent]=useState(0);
    const [duration,setDuration]=useState(0);
    const [loading,setLoading]=useState(true);
    const [failed,setFailed]=useState(false);
    const resolvedSrc=useMemo(()=>authenticatedMediaUrl(src),[src]);
    useEffect(()=>{setPlaying(false);setCurrent(0);setDuration(0);setLoading(true);setFailed(false)},[resolvedSrc]);
    const toggle=async()=>{const audio=audioRef.current;if(!audio)return;try{if(audio.paused)await audio.play();else audio.pause()}catch{setFailed(true)}};
    const restart=async()=>{const audio=audioRef.current;if(!audio)return;audio.currentTime=0;try{await audio.play()}catch{setFailed(true)}};
    return <div className="overflow-hidden rounded-2xl border border-primary-400/15 bg-gradient-to-l from-primary-500/[.09] to-dark-800/70 p-3 shadow-inner">
        <audio ref={audioRef} src={resolvedSrc} preload="metadata" autoPlay={autoPlay} onPlay={()=>setPlaying(true)} onPause={()=>setPlaying(false)} onEnded={()=>{setPlaying(false);setCurrent(duration)}} onLoadStart={()=>setLoading(true)} onCanPlay={()=>setLoading(false)} onLoadedMetadata={event=>{setDuration(event.currentTarget.duration||0);setLoading(false)}} onTimeUpdate={event=>setCurrent(event.currentTarget.currentTime)} onError={()=>{setFailed(true);setLoading(false)}}/>
        <div className="flex items-center gap-3">
            <button type="button" onClick={()=>void toggle()} disabled={failed} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-500 text-white shadow-lg shadow-primary-950/30 transition active:scale-95 disabled:opacity-40" aria-label={playing?'توقف':'پخش'}>{loading&&!failed?<span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white"/>:playing?<Pause className="h-5 w-5 fill-current"/>:<Play className="mr-0.5 h-5 w-5 fill-current"/>}</button>
            <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><Volume2 className="h-4 w-4 shrink-0 text-primary-300"/><strong className="min-w-0 flex-1 truncate text-xs text-dark-100">{label}</strong><button type="button" onClick={()=>void restart()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-dark-400 hover:bg-white/[.06] hover:text-white" title="پخش از ابتدا"><RotateCcw className="h-3.5 w-3.5"/></button></div>
                <div dir="ltr" className="mt-2 flex items-center gap-2"><span className="w-9 text-left font-player text-[10px] tabular-nums text-dark-400">{formatAudioTime(current)}</span><input dir="ltr" type="range" min="0" max={duration||0} step="0.1" value={Math.min(current,duration||0)} onChange={event=>{const audio=audioRef.current;if(audio)audio.currentTime=Number(event.target.value)}} className="h-1.5 min-w-0 flex-1 cursor-pointer accent-primary-500 [direction:ltr]"/><span className="w-9 text-right font-player text-[10px] tabular-nums text-dark-400">{formatAudioTime(duration)}</span></div>
            </div>
        </div>
        {failed&&<p className="mt-2 rounded-lg bg-red-500/10 px-2 py-1.5 text-[11px] text-red-300">پخش صدا انجام نشد. دوباره نمونه را بساز یا صفحه را تازه کن.</p>}
    </div>;
}

const REFINE_PRESETS = [
    ['خلاصه', 'این متن را خلاصه کن؛ نکته‌های اصلی و اطلاعات مهم را نگه دار.'],
    ['روان‌تر', 'متن را روان، طبیعی و خوش‌خوان بازنویسی کن، بدون تغییر معنی.'],
    ['نکته‌های کلیدی', 'نکته‌های کلیدی متن را به‌صورت فهرست بولت‌دار و منظم استخراج کن.'],
    ['عنوان‌بندی', 'متن را با عنوان‌ها و زیرعنوان‌های مناسب در قالب Markdown ساختاربندی کن.'],
    ['پاک‌سازی', 'خطاهای گفتاری، تکرارهای بی‌فایده و کلمات پرکننده را حذف و متن را ویرایش کن.'],
] as const;

function STTRefinementEditor({job,folderOptions,onClose,onSaved}:{job:STTJobStatus;folderOptions:Array<{value:string;label:string}>;onClose:()=>void;onSaved:(name:string)=>void}) {
    const initial=job.content||'';
    const [versions,setVersions]=useState<string[]>([initial]);
    const [version,setVersion]=useState(0);
    const [draft,setDraft]=useState(initial);
    const [prompt,setPrompt]=useState('');
    const [title,setTitle]=useState(job.title.replace(/\.(md|txt)$/i,''));
    const [folder,setFolder]=useState('default');
    const [error,setError]=useState('');
    const [refineStatus,setRefineStatus]=useState<{message:string;progress:number}|null>(null);
    const refine=useRefineSTTText();
    const upload=useUploadFile();
    const goTo=(next:number)=>{const bounded=Math.max(0,Math.min(next,versions.length-1));setVersion(bounded);setDraft(versions[bounded]);setError('')};
    const applyInstruction=async()=>{if(!draft.trim()||!prompt.trim())return;setError('');setRefineStatus({message:'درخواست ویرایش در حال ثبت است…',progress:5});try{const result=await refine.mutateAsync({content:draft,prompt:prompt.trim(),onStatus:(message,progress)=>setRefineStatus({message,progress})});const next=[...versions.slice(0,version+1),result.content];setVersions(next);setVersion(next.length-1);setDraft(result.content);setPrompt('');setRefineStatus({message:'نسخه تازه آماده شد.',progress:100});window.setTimeout(()=>setRefineStatus(null),2500)}catch(reason:any){setRefineStatus(null);setError(reason?.response?.data?.detail||reason?.message||'ویرایش متن انجام نشد. دوباره تلاش کن.')}};
    const saveFinal=async()=>{if(!draft.trim())return;setError('');try{const raw=title.trim()||'متن ویرایش‌شده';const name=/\.md$/i.test(raw)?raw:`${raw}.md`;await upload.mutateAsync({file:new File([draft],name,{type:'text/markdown;charset=utf-8'}),folderId:folder==='default'?null:Number(folder)});onSaved(name);onClose()}catch(reason:any){setError(reason?.response?.data?.detail||'ذخیره متن نهایی انجام نشد.')}};
    return <div className="fixed inset-0 z-[290] flex items-end justify-center bg-black/75 backdrop-blur-md sm:items-center sm:p-5" onClick={onClose}>
        <section dir="rtl" className="flex h-[94dvh] w-full max-w-4xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-dark-900 shadow-2xl sm:h-[88dvh] sm:rounded-3xl" onClick={event=>event.stopPropagation()}>
            <header className="flex items-center gap-3 border-b border-white/[.07] p-4"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/15 text-primary-200"><Sparkles className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="truncate font-bold">ویرایش متن با هوش مصنوعی</h2><p className="mt-1 text-[11px] text-dark-400">هر دستور یک نسخه تازه می‌سازد؛ هر وقت آماده بود ذخیره‌اش کن.</p></div><button className="btn-icon" onClick={onClose} aria-label="بستن"><X className="h-5 w-5"/></button></header>
            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 sm:grid sm:grid-cols-[minmax(0,1.45fr)_minmax(17rem,.75fr)] sm:overflow-hidden sm:p-4">
                <div className="flex min-h-[18rem] flex-col overflow-hidden rounded-2xl border border-white/[.07] bg-dark-950/35"><div className="flex items-center gap-2 border-b border-white/[.06] p-2"><button disabled={version===0} className="btn-icon h-9 w-9 disabled:opacity-30" onClick={()=>goTo(version-1)} title="نسخه قبلی"><Undo2 className="h-4 w-4"/></button><button disabled={version===versions.length-1} className="btn-icon h-9 w-9 disabled:opacity-30" onClick={()=>goTo(version+1)} title="نسخه بعدی"><Redo2 className="h-4 w-4"/></button><span className="mr-auto rounded-lg bg-white/[.05] px-2 py-1 text-[10px] text-dark-400">نسخه {(version+1).toLocaleString('fa-IR')} از {versions.length.toLocaleString('fa-IR')}</span></div><textarea dir="auto" value={draft} onChange={event=>setDraft(event.target.value)} className="min-h-[16rem] flex-1 resize-none bg-transparent p-4 text-sm leading-8 text-dark-100 outline-none [overflow-wrap:anywhere]" aria-label="متن در حال ویرایش"/></div>
                <aside className="space-y-3 sm:min-h-0 sm:overflow-y-auto"><div className="rounded-2xl border border-white/[.07] bg-dark-950/35 p-3"><p className="text-xs font-semibold text-dark-200">چه تغییری بدم؟</p><div className="mt-2 flex flex-wrap gap-1.5">{REFINE_PRESETS.map(([label,value])=><button key={label} type="button" onClick={()=>setPrompt(value)} className="rounded-full border border-primary-400/15 bg-primary-500/[.07] px-2.5 py-1.5 text-[11px] text-primary-200 transition hover:bg-primary-500/15">{label}</button>)}</div><textarea value={prompt} onChange={event=>setPrompt(event.target.value)} className="input mt-3 min-h-28 w-full resize-none text-right leading-6" maxLength={4000} placeholder="مثلاً متن را در سه پاراگراف خلاصه کن و اسم‌ها را دست‌نخورده نگه دار"/><button disabled={!prompt.trim()||!draft.trim()||refine.isPending} onClick={()=>void applyInstruction()} className="btn-primary mt-2 flex min-h-11 w-full items-center justify-center gap-2 disabled:opacity-40"><Wand2 className="h-4 w-4"/>{refine.isPending?(refineStatus?.message||'در حال ویرایش…'):'اعمال روی متن'}</button></div><div className="rounded-2xl border border-white/[.07] bg-dark-950/35 p-3"><p className="text-xs font-semibold text-dark-200">ذخیره نسخه نهایی</p><input value={title} onChange={event=>setTitle(event.target.value)} className="input mt-2 w-full text-right" maxLength={180} placeholder="نام فایل خروجی"/><CustomSelect className="mt-2" value={folder} onChange={setFolder} options={folderOptions}/><button disabled={!draft.trim()||upload.isPending} onClick={()=>void saveFinal()} className="mt-2 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-primary-400/20 bg-primary-500/10 text-xs font-semibold text-primary-100 transition hover:bg-primary-500/15 disabled:opacity-40"><Save className="h-4 w-4"/>{upload.isPending?'در حال ذخیره…':'ذخیره در کمد'}</button><button onClick={()=>void navigator.clipboard.writeText(draft)} className="mt-1.5 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl text-xs text-dark-400 hover:bg-white/[.05] hover:text-white"><ClipboardCopy className="h-4 w-4"/>کپی نسخه فعلی</button></div>{error&&<p className="rounded-xl bg-red-500/10 px-3 py-2 text-xs leading-6 text-red-300">{error}</p>}</aside>
            </div>
        </section>
    </div>;
}

export default function TTSSettingsPanel(){
    const [speechMode,setSpeechMode]=useState<'tts'|'stt'>(()=>{
        const requested=localStorage.getItem('komod-speech-mode');
        localStorage.removeItem('komod-speech-mode');
        return requested==='stt'?'stt':'tts';
    });
    const {data:settings,isLoading}=useTTSSettings();
    const {data:jobs=[]}=useTTSJobs();
    const {data:folders=[]}=useFolderTree();
    const update=useUpdateTTSSettings();
    const {data:geminiKeys}=useGeminiKeys();
    const updateGeminiKeys=useUpdateGeminiKeys();
    const deleteGeminiKeys=useDeleteGeminiKeys();
    const [geminiKeyInput,setGeminiKeyInput]=useState('');
    const create=useCreateTTSJob();
    const control=useControlTTSJob();
    const dismiss=useDismissTTSJob();
    const clearFinished=useClearFinishedTTSJobs();
    const {data:sttJobs=[]}=useSTTJobs();
    const createSTT=useCreateSTTJob();
    const cancelSTT=useCancelSTTJob();
    const dismissSTT=useDismissSTTJob();
    const [voice,setVoice]=useState('Kore');
    const [gender,setGender]=useState<'all'|'female'|'male'>('all');
    const [pitch,setPitch]=useState<'all'|'low'|'medium'|'high'>('all');
    const [useCase,setUseCase]=useState<'general'|'audiobook'|'podcast'|'story'|'education'|'news'|'advertising'|'accessibility'>('general');
    const [style,setStyle]=useState('طبیعی، گرم و واضح');
    const [speed,setSpeed]=useState(1);
    const [autoExpression,setAutoExpression]=useState(true);
    const [title,setTitle]=useState('صدای ساخته‌شده');
    const [text,setText]=useState('');
    const [folder,setFolder]=useState('default');
    const [outputMode,setOutputMode]=useState<'save'|'preview'|'telegram'>('save');
    const [ttsPanel,setTtsPanel]=useState<'convert'|'voice'>('convert');
    const [editorFullscreen,setEditorFullscreen]=useState(false);
    const [message,setMessage]=useState<{kind:'ok'|'error';text:string}|null>(null);
    const [previewing,setPreviewing]=useState(false);
    const [previewUrl,setPreviewUrl]=useState('');
    const textAreaRef=useRef<HTMLTextAreaElement|null>(null);
    const [sttSearch,setSttSearch]=useState('');
    const {data:sttFiles}=useFiles(undefined,'audio,video',sttSearch||undefined,1,'created:desc');
    const [sttFileId,setSttFileId]=useState(()=>Number(localStorage.getItem('komod-stt-source-file')||0));
    const [sttTitle,setSttTitle]=useState(()=>{const source=localStorage.getItem('komod-stt-source-title');return source?`📝 متن ${source.replace(/\.[^.]+$/,'')}`:'📝 متن صدا'});
    const [sttPrompt,setSttPrompt]=useState('');
    const [sttPostPrompts,setSttPostPrompts]=useState<string[]>([]);
    const [sttFolder,setSttFolder]=useState('default');
    const [sttOutput,setSttOutput]=useState<'temporary'|'save'>(()=>localStorage.getItem('komod-stt-output-mode')==='temporary'?'temporary':'save');
    const [sttPanel,setSttPanel]=useState<'source'|'output'|'history'>('source');
    const [expandedSTTResults,setExpandedSTTResults]=useState<Set<string>>(()=>new Set());
    const [refineJob,setRefineJob]=useState<STTJobStatus|null>(null);
    const [fullscreenSTTJob,setFullscreenSTTJob]=useState<STTJobStatus|null>(null);

    useEffect(()=>{if(settings){setVoice(settings.voice);setGender(settings.gender);setPitch(settings.pitch);setUseCase(settings.use_case);setStyle(settings.style);setSpeed(settings.speed);setAutoExpression(settings.auto_expression);setFolder(settings.folder_id?String(settings.folder_id):'default')}},[settings]);
    useEffect(()=>localStorage.setItem('komod-stt-output-mode',sttOutput),[sttOutput]);
    useEffect(()=>()=>{if(previewUrl.startsWith('blob:'))URL.revokeObjectURL(previewUrl)},[previewUrl]);
    useEffect(()=>()=>{localStorage.removeItem('komod-stt-source-file');localStorage.removeItem('komod-stt-source-title')},[]);
    useEffect(()=>{
        const clearExpired=()=>sttJobs.filter(job=>job.finished_at&&['done','error','cancelled'].includes(job.state)&&Date.now()-new Date(`${job.finished_at}${/[zZ]|[+-]\d\d:\d\d$/.test(job.finished_at)?'':'Z'}`).getTime()>=300000).forEach(job=>void dismissSTT.mutateAsync(job.id));
        clearExpired();
        const timer=window.setInterval(clearExpired,30000);
        return()=>window.clearInterval(timer);
    },[sttJobs]);
    useEffect(()=>{if(message?.kind!=='ok')return;const timer=window.setTimeout(()=>setMessage(null),3500);return()=>window.clearTimeout(timer)},[message]);
    const folderOptions=useMemo(()=>{const result=[{value:'default',label:'🗃️ کشوی پیش‌فرض کمد'}];const walk=(items:Folder[],depth=0)=>items.forEach(item=>{result.push({value:String(item.id),label:`${'— '.repeat(depth)}🗂️ ${item.name}`});if(item.children)walk(item.children,depth+1)});walk(folders);return result},[folders]);
    const availableVoices=useMemo(()=>settings?.voices.filter(item=>(gender==='all'||item.gender===gender)&&(pitch==='all'||item.pitch===pitch))||[],[settings?.voices,gender,pitch]);
    const selectedVoice=settings?.voices.find(item=>item.value===voice);
    useEffect(()=>{if(availableVoices.length&&!availableVoices.some(item=>item.value===voice))setVoice(availableVoices[0].value)},[availableVoices,voice]);

    const save=async()=>{if(!settings)return;setMessage(null);try{await update.mutateAsync({voice,gender,pitch,use_case:useCase,style,speed,auto_expression:autoExpression,model:settings.model,folder_id:folder==='default'?null:Number(folder)});setMessage({kind:'ok',text:'تنظیمات و کشوی پیش‌فرض صدا ذخیره شد.'})}catch(error:any){setMessage({kind:'error',text:error?.response?.data?.detail||'ذخیره تنظیمات انجام نشد.'})}};
    const submit=async()=>{const normalized=normalizeDirectorNotes(text).trim();if(!normalized)return;setText(normalized);setMessage(null);try{await create.mutateAsync({text:normalized,title:title.trim()||'صدای ساخته‌شده',folder_id:outputMode==='save'?(folder==='default'?null:Number(folder)):null,voice,gender,pitch,use_case:useCase,style,speed,auto_expression:autoExpression,output_mode:outputMode});setMessage({kind:'ok',text:outputMode==='preview'?'صدا در حال آماده‌شدن برای پخش است.':outputMode==='telegram'?'صدا ساخته می‌شود و در تلگرام می‌آید.':'ساخت صدا شروع شد.'})}catch(error:any){setMessage({kind:'error',text:error?.response?.data?.detail||'ساخت صدا شروع نشد.'})}};
    const insertText=(value:string,cursorOffset=value.length)=>{const target=textAreaRef.current;const start=target?.selectionStart??text.length;const end=target?.selectionEnd??start;setText(`${text.slice(0,start)}${value}${text.slice(end)}`);requestAnimationFrame(()=>{target?.focus();target?.setSelectionRange(start+cursorOffset,start+cursorOffset)})};
    const insertScopedCue=(tag:string)=>{const target=textAreaRef.current;const start=target?.selectionStart??text.length;const end=target?.selectionEnd??start;const selected=text.slice(start,end)||'متن این بخش';const value=`${tag}${selected}[resumes normal speech]`;insertText(value,tag.length+(end>start?selected.length:0))};
    const playVoicePreview=async(targetVoice=voice)=>{if(!settings)return;setPreviewing(true);setMessage(null);try{const key=new Request(`${window.location.origin}/__komod_tts_preview_v3__/${encodeURIComponent(settings.model)}/${encodeURIComponent(targetVoice)}`);let cached:Response|undefined;try{await Promise.all(['komod-tts-previews-v1','komod-tts-previews-v2'].map(name=>caches.delete(name)));cached=await (await caches.open('komod-tts-previews-v3')).match(key)}catch{/* Cache API may be unavailable */}let blob:Blob;if(cached)blob=await cached.blob();else{const response=await api.get<ArrayBuffer>(`/tts/preview/${encodeURIComponent(targetVoice)}`,{responseType:'arraybuffer'});blob=new Blob([response.data],{type:'audio/wav'});try{await (await caches.open('komod-tts-previews-v3')).put(key,new Response(blob,{headers:{'Content-Type':'audio/wav'}}))}catch{/* normal playback still works */}}if(previewUrl.startsWith('blob:'))URL.revokeObjectURL(previewUrl);setPreviewUrl(URL.createObjectURL(blob))}catch(error:any){setMessage({kind:'error',text:error?.response?.data?.detail||'پخش نمونه صدا انجام نشد.'})}finally{setPreviewing(false)}};
    const submitSTT=async()=>{if(!sttFileId)return;setMessage(null);try{await createSTT.mutateAsync({file_id:sttFileId,title:sttTitle.trim()||'رونویسی صدا',prompt:sttPrompt.trim(),post_prompts:sttPostPrompts.map(item=>item.trim()).filter(Boolean),folder_id:sttOutput==='save'?(sttFolder==='default'?null:Number(sttFolder)):null,output_mode:sttOutput});setMessage({kind:'ok',text:'تبدیل صدا به متن شروع شد.'});setSttPanel('history')}catch(error:any){setMessage({kind:'error',text:error?.response?.data?.detail||'تبدیل صدا به متن شروع نشد.'})}};
    const cueTools=<><p className="mt-3 text-[11px] text-dark-500">رویدادهای کوتاه</p><div className="mt-1.5 flex flex-wrap gap-1.5">{CUES.map(item=><button type="button" key={item.tag} onClick={()=>insertText(item.tag)} className="rounded-lg bg-white/[.05] px-2.5 py-1.5 text-[11px] text-dark-300 hover:bg-primary-500/10 hover:text-primary-200">{item.label}</button>)}</div><p className="mt-3 text-[11px] text-dark-500">لحن یک بخش: متن را انتخاب کن، سپس یکی را بزن</p><div className="mt-1.5 flex flex-wrap gap-1.5">{SCOPED_CUES.map(item=><button type="button" key={item.tag} onClick={()=>insertScopedCue(item.tag)} className="rounded-lg border border-primary-400/15 bg-primary-500/[.07] px-2.5 py-1.5 text-[11px] text-primary-200">{item.label}</button>)}</div></>;
    if(isLoading)return <div className="rounded-2xl bg-dark-900/70 p-5 text-sm text-dark-400">در حال دریافت تنظیمات صدا…</div>;
    return <div className="space-y-4">
        <div className="grid grid-cols-2 gap-1 rounded-2xl border border-white/[.08] bg-dark-900/80 p-1.5 shadow-lg shadow-black/10" role="tablist" aria-label="ابزارهای متن و صدا">
            <button type="button" role="tab" aria-selected={speechMode==='tts'} onClick={()=>{setSpeechMode('tts');setMessage(null)}} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${speechMode==='tts'?'bg-primary-500 text-white shadow-lg shadow-primary-950/25':'text-dark-400 hover:bg-white/[.05] hover:text-white'}`}><AudioLines className="h-5 w-5"/>متن به صدا</button>
            <button type="button" role="tab" aria-selected={speechMode==='stt'} onClick={()=>{setSpeechMode('stt');setMessage(null)}} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold transition ${speechMode==='stt'?'bg-primary-500 text-white shadow-lg shadow-primary-950/25':'text-dark-400 hover:bg-white/[.05] hover:text-white'}`}><FileAudio className="h-5 w-5"/>صدا به متن</button>
        </div>
        {speechMode==='tts'&&<div className="grid grid-cols-2 gap-1 rounded-2xl border border-white/[.07] bg-dark-950/50 p-1"><button type="button" onClick={()=>setTtsPanel('convert')} className={`min-h-10 rounded-xl text-xs ${ttsPanel==='convert'?'bg-primary-500/15 text-primary-100':'text-dark-400'}`}>تبدیل متن به صدا</button><button type="button" onClick={()=>setTtsPanel('voice')} className={`min-h-10 rounded-xl text-xs ${ttsPanel==='voice'?'bg-primary-500/15 text-primary-100':'text-dark-400'}`}>گوینده و لحن</button></div>}
        {speechMode==='tts'&&ttsPanel==='convert'&&<section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5">
            <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-300"><Wand2 className="h-5 w-5"/></span><h2 className="font-bold">ساخت صدا از متن</h2></div>
            {!settings?.available&&<p className="mt-4 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-200">برای فعال‌شدن این بخش، کلید Gemini باید روی سرور تنظیم شود.</p>}
            <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs text-dark-400">نام خروجی<input value={title} onChange={event=>setTitle(event.target.value)} className="input mt-1.5 w-full" maxLength={180}/></label>{outputMode==='save'&&<label className="text-xs text-dark-400">کشوی مقصد و پیش‌فرض<CustomSelect className="mt-1.5" value={folder} onChange={setFolder} options={folderOptions}/></label>}</div>
            <div className="mt-3 grid grid-cols-3 gap-1 rounded-2xl border border-white/[.07] bg-dark-950/40 p-1" role="radiogroup" aria-label="محل خروجی صدا">{([{value:'save',label:'ذخیره در کمد'},{value:'preview',label:'فقط پخش'},{value:'telegram',label:'فقط تلگرام'}] as const).map(item=><button type="button" key={item.value} role="radio" aria-checked={outputMode===item.value} onClick={()=>setOutputMode(item.value)} className={`min-h-10 rounded-xl px-2 text-xs transition ${outputMode===item.value?'bg-primary-500 text-white shadow-lg shadow-primary-950/20':'text-dark-400 hover:bg-white/[.05] hover:text-white'}`}>{item.label}</button>)}</div>
            <div className={editorFullscreen?'fixed inset-0 z-[280] flex min-h-0 flex-col overflow-hidden bg-dark-950 p-3 sm:p-8':'mt-3'}><div className="mb-2 flex shrink-0 items-center justify-between"><span className="text-xs text-dark-400">متن و پیش‌نمایش</span><button type="button" onClick={()=>setEditorFullscreen(value=>!value)} className="btn-icon" title={editorFullscreen?'خروج از تمام‌صفحه':'تمام‌صفحه'}>{editorFullscreen?<Minimize2 className="h-4 w-4"/>:<Maximize2 className="h-4 w-4"/>}</button></div><div className={editorFullscreen?'grid min-h-0 flex-1 grid-rows-2 gap-3 sm:grid-cols-2 sm:grid-rows-1 sm:gap-4':''}><label className={`text-xs text-dark-400 ${editorFullscreen?'flex min-h-0 flex-col':''}`}>متن<textarea ref={textAreaRef} value={text} onChange={event=>setText(normalizeDirectorNotes(event.target.value))} className={`input mt-1.5 w-full resize-none leading-8 ${editorFullscreen?'min-h-0 flex-1':'min-h-48'}`} placeholder="متنت را اینجا بنویس یا بچسبان…" maxLength={200000}/></label><div className={editorFullscreen?'flex min-h-0 flex-col':'contents'}>{editorFullscreen&&<span className="text-xs text-dark-400">پیش‌نمایش</span>}<TaggedTextPreview text={text} fullscreen={editorFullscreen}/></div></div>{editorFullscreen&&<div className="mt-3 max-h-[30dvh] shrink-0 overflow-y-auto rounded-2xl border border-white/[.07] bg-dark-900/70 p-3">{cueTools}</div>}</div>
            {!editorFullscreen&&cueTools}
            <div className="mt-2 flex items-center justify-between gap-3 text-[11px] text-dark-500"><span>{text.length.toLocaleString('fa-IR')} نویسه</span><button type="button" disabled={!text} onClick={()=>setText('')} className="rounded-lg px-2 py-1 text-red-300 transition hover:bg-red-500/10 disabled:opacity-30">پاک‌کردن متن</button></div>
            <button disabled={!settings?.available||!text.trim()||create.isPending} onClick={()=>void submit()} className="btn-primary mt-4 flex min-h-12 w-full items-center justify-center gap-2 disabled:opacity-40"><AudioLines className="h-5 w-5"/>{create.isPending?'در حال افزودن…':outputMode==='save'?'ساخت و ذخیره':outputMode==='telegram'?'ساخت و ارسال':'ساخت و پخش'}</button>
        </section>}
        {speechMode==='stt'&&<section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5">
            <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-300"><FileAudio className="h-5 w-5"/></span><div><h2 className="font-bold">تبدیل صدا به متن</h2></div></div>
            <div className="mt-4 grid grid-cols-3 gap-1 rounded-2xl border border-white/[.07] bg-dark-950/50 p-1">{([{value:'source',label:'فایل ورودی'},{value:'output',label:'خروجی'},{value:'history',label:'تاریخچه'}] as const).map(item=><button type="button" key={item.value} onClick={()=>setSttPanel(item.value)} className={`min-h-10 rounded-xl text-xs ${sttPanel===item.value?'bg-primary-500/15 text-primary-100':'text-dark-400'}`}>{item.label}</button>)}</div>
            {sttPanel==='source'&&<div className="mt-3 rounded-2xl border border-white/[.06] bg-dark-950/25 p-3"><input value={sttSearch} onChange={event=>setSttSearch(event.target.value)} className="input w-full" placeholder="جست‌وجوی فایل صوتی یا ویدیویی"/><CustomSelect className="mt-3" label="فایل ورودی" value={sttFileId||''} onChange={value=>{const id=Number(value);setSttFileId(id);const selected=sttFiles?.files.find(file=>file.id===id);if(selected)setSttTitle(`📝 متن ${selected.file_name.replace(/\.[^.]+$/,'')}`);setSttPanel('output')}} options={[...(sttFileId&&!sttFiles?.files.some(file=>file.id===sttFileId)?[{value:sttFileId,label:localStorage.getItem('komod-stt-source-title')||`فایل ${sttFileId}`}]:[]),...(sttFiles?.files||[]).map(file=>({value:file.id,label:`${file.file_type==='video'?'🎬':'🎙️'} ${file.file_name}`}))]}/></div>}
            {sttPanel==='output'&&<div className="mt-3"><div className="grid grid-cols-2 gap-1 rounded-2xl border border-white/[.07] bg-dark-950/40 p-1"><button type="button" role="radio" aria-checked={sttOutput==='save'} onClick={()=>setSttOutput('save')} className={`flex min-h-10 items-center justify-center gap-1.5 rounded-xl text-xs ${sttOutput==='save'?'bg-primary-500 text-white shadow-lg shadow-primary-950/20':'text-dark-400'}`}>{sttOutput==='save'&&<Check className="h-3.5 w-3.5"/>}ذخیره در کمد</button><button type="button" role="radio" aria-checked={sttOutput==='temporary'} onClick={()=>setSttOutput('temporary')} className={`flex min-h-10 items-center justify-center gap-1.5 rounded-xl text-xs ${sttOutput==='temporary'?'bg-primary-500 text-white shadow-lg shadow-primary-950/20':'text-dark-400'}`}>{sttOutput==='temporary'&&<Check className="h-3.5 w-3.5"/>}فقط نتیجه موقت</button></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs text-dark-400">نام خروجی<input value={sttTitle} onChange={event=>setSttTitle(event.target.value)} className="input mt-1.5 w-full" maxLength={180}/></label>{sttOutput==='save'&&<label className="text-xs text-dark-400">کشوی مقصد<CustomSelect className="mt-1.5" value={sttFolder} onChange={setSttFolder} options={folderOptions}/></label>}</div><label className="mt-3 block text-xs text-dark-400">دستور تکمیلی اختیاری<textarea value={sttPrompt} onChange={event=>setSttPrompt(event.target.value)} className="input mt-1.5 min-h-24 w-full resize-y" maxLength={4000} placeholder="مثلاً نام گوینده‌ها را جدا کن؛ اصطلاحات پزشکی را عیناً نگه دار…"/></label><div className="mt-3 rounded-2xl border border-white/[.06] bg-dark-950/30 p-3"><div className="flex items-center justify-between gap-2"><div><p className="text-xs font-semibold text-dark-200">پردازش بعد از رونویسی</p><p className="mt-1 text-[10px] text-dark-500">هر مرحله روی خروجی مرحله قبل اجرا می‌شود.</p></div>{sttPostPrompts.length<5&&<button type="button" onClick={()=>setSttPostPrompts(items=>[...items,''])} className="btn-icon h-9 w-9" title="افزودن مرحله"><Plus className="h-4 w-4"/></button>}</div>{sttPostPrompts.length>0&&<div className="mt-3 space-y-2">{sttPostPrompts.map((item,index)=><div key={index} className="flex items-start gap-2"><span className="mt-2.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary-500/10 text-[10px] text-primary-200">{(index+1).toLocaleString('fa-IR')}</span><textarea value={item} onChange={event=>setSttPostPrompts(items=>items.map((value,itemIndex)=>itemIndex===index?event.target.value:value))} className="input min-h-20 min-w-0 flex-1 resize-none text-right text-xs leading-6" maxLength={4000} placeholder="مثلاً خلاصه کن و نکته‌های مهم را بولت‌بندی کن"/><button type="button" onClick={()=>setSttPostPrompts(items=>items.filter((_,itemIndex)=>itemIndex!==index))} className="btn-icon mt-1 h-8 w-8 text-red-300" title="حذف مرحله"><X className="h-3.5 w-3.5"/></button></div>)}</div>}</div><button disabled={!sttFileId||createSTT.isPending||!settings?.available} onClick={()=>void submitSTT()} className="btn-primary mt-4 flex min-h-11 w-full items-center justify-center gap-2 disabled:opacity-40"><FileAudio className="h-4 w-4"/>{createSTT.isPending?'در حال افزودن…':'شروع تبدیل'}</button></div>}
            {sttPanel==='history'&&(sttJobs.length>0?<div className="mt-4 space-y-2">{sttJobs.map(job=>{const finished=['done','error','cancelled'].includes(job.state);const expanded=expandedSTTResults.has(job.id);return <article key={job.id} className="min-w-0 overflow-hidden rounded-xl bg-dark-800/60 p-3"><div className="flex min-w-0 items-center gap-2"><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{job.title}</strong><span className="block truncate text-xs text-dark-400">{job.message}</span></div>{finished?<button className="btn-icon shrink-0" onClick={()=>void dismissSTT.mutateAsync(job.id)}><X className="h-4 w-4"/></button>:<button className="btn-icon shrink-0 text-red-300" onClick={()=>void cancelSTT.mutateAsync(job.id)}><Square className="h-4 w-4"/></button>}</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-dark-950"><div className={`h-full ${job.state==='error'?'bg-red-500':'bg-primary-500'}`} style={{width:`${job.progress||0}%`}}/></div>{job.content&&<div className="mt-3 min-w-0 overflow-hidden rounded-xl border border-white/[.06] bg-dark-950/40 p-3"><div dir="auto" className={`min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-sans text-xs leading-7 text-dark-200 ${expanded?'max-h-80 overflow-y-auto':'max-h-[5.25rem] overflow-hidden'}`}>{job.content}</div><div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-white/[.05] pt-2"><button type="button" onClick={()=>setExpandedSTTResults(current=>{const next=new Set(current);if(next.has(job.id))next.delete(job.id);else next.add(job.id);return next})} className="rounded-lg px-2 py-1.5 text-xs text-primary-200 hover:bg-primary-500/10">{expanded?'نمایش کمتر':'مشاهده بیشتر'}</button><button type="button" onClick={()=>setFullscreenSTTJob(job)} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-primary-200 hover:bg-primary-500/10"><Maximize2 className="h-3.5 w-3.5"/>تمام‌صفحه</button><button type="button" onClick={()=>setRefineJob(job)} className="flex items-center gap-1.5 rounded-lg bg-primary-500/10 px-2 py-1.5 text-xs font-semibold text-primary-100 hover:bg-primary-500/15"><Sparkles className="h-3.5 w-3.5"/>ویرایش با هوش مصنوعی</button><button onClick={()=>void navigator.clipboard.writeText(job.content||'')} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-primary-200 hover:bg-primary-500/10"><ClipboardCopy className="h-3.5 w-3.5"/>کپی متن</button></div></div>}</article>})}</div>:<p className="mt-4 rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-dark-500">تاریخچه‌ای وجود ندارد.</p>)}
        </section>}
        {speechMode==='tts'&&ttsPanel==='voice'&&<section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5">
            <div className="flex w-full items-center gap-2 text-right"><Sparkles className="h-5 w-5 text-primary-300"/><h2 className="min-w-0 flex-1 font-bold">گوینده و شیوه خواندن</h2></div>
            <div className="mt-4 border-t border-white/[.06] pt-4">
            <div className="grid gap-3 sm:grid-cols-3"><CustomSelect label="جنس صدا" value={gender} onChange={setGender} options={[...GENDERS]}/><CustomSelect label="زیر و بمی" value={pitch} onChange={setPitch} options={[...PITCHES]}/><CustomSelect label="کاربرد" value={useCase} onChange={setUseCase} options={[...USE_CASES]}/></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]"><CustomSelect label="گوینده" value={voice} onChange={value=>{setVoice(value);void playVoicePreview(value)}} options={availableVoices.map(item=>({value:item.value,label:item.label}))}/><div className="mt-[1.375rem] flex min-h-11 items-center justify-center gap-2 rounded-xl bg-white/[.04] px-4 text-xs text-dark-400"><Headphones className="h-4 w-4"/>{previewing?'در حال آماده‌سازی نمونه…':'با انتخاب صدا، نمونه پخش می‌شود'}</div></div>
            {selectedVoice&&<p className="mt-2 rounded-xl bg-white/[.035] px-3 py-2 text-xs leading-6 text-dark-400">{selectedVoice.description}</p>}
            {previewUrl&&<div className="mt-3"><InlineAudioPlayer src={previewUrl} label={`نمونهٔ ${selectedVoice?.label||voice}`} autoPlay/></div>}
            <label className="mt-3 block text-xs text-dark-400">سرعت خواندن<div className="mt-1.5 flex min-h-11 items-center gap-3 rounded-xl border border-white/10 bg-dark-800 px-3"><input className="min-w-0 flex-1 accent-primary-500" type="range" min="0.5" max="2" step="0.05" value={speed} onChange={event=>setSpeed(Number(event.target.value))}/><span dir="ltr" className="w-12 text-center text-sm tabular-nums">{speed.toFixed(2)}×</span></div></label>
            <label className="mt-3 block text-xs text-dark-400">سبک و دستور خواندن<input value={style} onChange={event=>setStyle(event.target.value)} className="input mt-1.5 w-full" placeholder="مثلاً آرام، صمیمی و داستانی" maxLength={500}/></label>
            <div className="mt-2 flex flex-wrap gap-2">{['آرام و صمیمی','رسمی و شمرده','پرانرژی و هیجان‌انگیز','داستانی و احساسی','نجواگونه و نزدیک','آموزشی و بسیار واضح'].map(item=><button key={item} onClick={()=>setStyle(item)} className="rounded-full border border-white/[.08] bg-dark-800 px-3 py-2 text-xs text-dark-300 hover:border-primary-400/30">{item}</button>)}</div>
            <label className="mt-4 flex min-h-12 items-center gap-3 rounded-xl bg-dark-800/60 px-3"><input type="checkbox" checked={autoExpression} onChange={event=>setAutoExpression(event.target.checked)} className="h-5 w-5 accent-primary-500"/><span className="text-sm">تشخیص خودکار احساس، مکث و لحن از متن</span></label>
            <button onClick={()=>void save()} disabled={update.isPending} className="btn-primary mt-4 flex min-h-11 w-full items-center justify-center gap-2 disabled:opacity-50"><Check className="h-4 w-4"/> ذخیره تنظیمات و کشوی پیش‌فرض</button>
            </div>
            <div className="mt-5 border-t border-white/[.06] pt-4">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <h3 className="text-sm font-bold">کلید Gemini خودم</h3>
                        <p className="mt-1 text-[11px] leading-5 text-dark-500">برای سهمیه بیشتر؛ کلیدها رمزگذاری و فقط هنگام درخواست Gemini استفاده می‌شوند.</p>
                    </div>
                    {geminiKeys?.count?<span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-300">{geminiKeys.count.toLocaleString('fa-IR')} کلید</span>:null}
                </div>
                <textarea dir="rtl" value={geminiKeyInput} onChange={event=>setGeminiKeyInput(event.target.value)} className="input mt-3 min-h-20 w-full resize-none text-right font-mono text-xs" placeholder="هر کلید را در یک خط وارد کن"/>
                <div className="mt-2 grid grid-cols-2 gap-2">
                    <button disabled={!geminiKeyInput.trim()||updateGeminiKeys.isPending} onClick={async()=>{try{await updateGeminiKeys.mutateAsync(geminiKeyInput.split(/[\n,]+/).map(value=>value.trim()).filter(Boolean));setGeminiKeyInput('');setMessage({kind:'ok',text:'کلیدهای Gemini ذخیره شدند.'})}catch(error:any){setMessage({kind:'error',text:error?.response?.data?.detail||'ذخیره کلید انجام نشد.'})}}} className="btn-primary min-h-10 text-xs disabled:opacity-40">ذخیره کلیدها</button>
                    <button disabled={!geminiKeys?.count||deleteGeminiKeys.isPending} onClick={()=>void deleteGeminiKeys.mutateAsync()} className="min-h-10 rounded-xl bg-red-500/10 text-xs text-red-300 disabled:opacity-40">حذف کلیدها</button>
                </div>
                {geminiKeys?.masked?.length?<p dir="ltr" className="mt-2 text-left text-[10px] text-dark-500">{geminiKeys.masked.join(' · ')}</p>:null}
                <details className="mt-3 overflow-hidden rounded-2xl border border-white/[.06] bg-white/[.03] text-xs text-dark-400">
                    <summary className="cursor-pointer px-3 py-3 font-medium text-primary-200">🔑 چطور کلید Gemini بگیرم؟</summary>
                    <div className="border-t border-white/[.06] px-3 pb-3 pt-2">
                        <div className="space-y-2 leading-6">
                            <p><span className="ml-1 font-bold text-primary-200">۱.</span> وارد <a className="text-primary-300 underline" href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio</a> شو و با حساب گوگلت وارد شو.</p>
                            <p><span className="ml-1 font-bold text-primary-200">۲.</span> روی «ساخت کلید API» بزن.</p>
                            <p><span className="ml-1 font-bold text-primary-200">۳.</span> کلید ساخته‌شده را کپی کن.</p>
                            <p><span className="ml-1 font-bold text-primary-200">۴.</span> کلید را در کادر بالا بچسبان و «ذخیره کلیدها» را بزن.</p>
                        </div>
                        <p className="mt-3 rounded-xl bg-emerald-500/[.08] px-3 py-2 leading-6 text-emerald-200">🔒 خیالت راحت؛ کلید به‌صورت رمزگذاری‌شده در دیتابیس نگه‌داری می‌شود، متن خام آن در برنامه نمایش داده نمی‌شود و فقط موقع فرستادن درخواست به Gemini، داخل سرور استفاده می‌شود.</p>
                    </div>
                </details>
            </div>
        </section>}
        {fullscreenSTTJob?.content&&<div className="fixed inset-0 z-[285] flex flex-col bg-dark-950 p-3 sm:p-6" dir="rtl"><header className="flex shrink-0 items-center gap-3 border-b border-white/[.07] pb-3"><div className="min-w-0 flex-1"><h2 className="truncate font-bold">{fullscreenSTTJob.title}</h2><p className="mt-1 text-xs text-dark-400">متن استخراج‌شده از صدا</p></div><button className="btn-icon" onClick={()=>setFullscreenSTTJob(null)} aria-label="بستن"><X className="h-5 w-5"/></button></header><article dir="auto" className="mx-auto mt-4 min-h-0 w-full max-w-4xl flex-1 overflow-y-auto whitespace-pre-wrap break-words rounded-2xl border border-white/[.07] bg-dark-900/70 p-5 text-sm leading-8 text-dark-100 [overflow-wrap:anywhere] sm:p-8">{fullscreenSTTJob.content}</article><footer className="mx-auto mt-3 flex w-full max-w-4xl shrink-0 gap-2"><button onClick={()=>void navigator.clipboard.writeText(fullscreenSTTJob.content||'')} className="btn-secondary flex min-h-10 flex-1 items-center justify-center gap-2 text-xs"><ClipboardCopy className="h-4 w-4"/>کپی متن</button><button onClick={()=>{setRefineJob(fullscreenSTTJob);setFullscreenSTTJob(null)}} className="btn-primary flex min-h-10 flex-1 items-center justify-center gap-2 text-xs"><Sparkles className="h-4 w-4"/>ویرایش با هوش مصنوعی</button></footer></div>}
        {refineJob?.content&&<STTRefinementEditor job={refineJob} folderOptions={folderOptions} onClose={()=>setRefineJob(null)} onSaved={name=>setMessage({kind:'ok',text:`«${name}» در کمد ذخیره شد.`})}/>} 
        {message&&<p className={`rounded-xl px-3 py-2 text-sm ${message.kind==='ok'?'bg-emerald-500/10 text-emerald-300':'bg-red-500/10 text-red-300'}`}>{message.text}</p>}
        {speechMode==='tts'&&ttsPanel==='convert'&&jobs.length>0&&<section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-bold">صف ساخت صدا</h2>{jobs.some(job=>['done','error','cancelled'].includes(job.state))&&<button onClick={()=>void clearFinished.mutateAsync()} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-dark-400 hover:bg-white/[.05] hover:text-white"><Trash2 className="h-3.5 w-3.5"/>پاک‌کردن تاریخچه</button>}</div><div className="mt-4 space-y-2">{jobs.map(job=>{const finished=['done','error','cancelled'].includes(job.state);return <article key={job.id} className="rounded-xl bg-dark-800/60 p-3"><div className="flex items-center gap-3"><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{job.title}</strong><span className="mt-1 block text-xs text-dark-400">{STATES[job.state]||job.state} · {job.message}</span></div>{finished?<button title="حذف از تاریخچه" className="btn-icon text-dark-400" onClick={()=>void dismiss.mutateAsync(job.id)}><X className="h-4 w-4"/></button>:<><button title={job.state==='paused'?'ادامه':'توقف'} className="btn-icon" onClick={()=>void control.mutateAsync({id:job.id,action:'pause'})}>{job.state==='paused'?<Play className="h-4 w-4"/>:<Pause className="h-4 w-4"/>}</button><button title="لغو" className="btn-icon text-red-300" onClick={()=>void control.mutateAsync({id:job.id,action:'cancel'})}><Square className="h-4 w-4"/></button></>}</div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-dark-950"><div className={`h-full rounded-full ${job.state==='error'?'bg-red-500':job.state==='cancelled'?'bg-dark-500':'bg-primary-500'}`} style={{width:`${job.progress||0}%`}}/></div>{job.state==='done'&&job.stream_url&&<div className="mt-3"><InlineAudioPlayer src={job.stream_url} label={job.title}/></div>}</article>})}</div></section>}
    </div>;
}
