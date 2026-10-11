import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Check, Headphones, Pause, Play, Sparkles, Square, Trash2, Volume2, Wand2, X } from 'lucide-react';
import { api, Folder, useClearFinishedTTSJobs, useControlTTSJob, useCreateTTSJob, useDismissTTSJob, useFolderTree, useTTSJobs, useTTSSettings, useUpdateTTSSettings } from '../lib/api';
import CustomSelect from './CustomSelect';

const STATES:Record<string,string>={queued:'در صف',paused:'متوقف',synthesizing:'در حال ساخت',merging:'در حال یکپارچه‌سازی',uploading:'در حال ذخیره',done:'آماده',error:'خطا',cancelled:'لغوشده'};
const GENDERS=[{value:'all',label:'همه صداها'},{value:'female',label:'صدای زن'},{value:'male',label:'صدای مرد'}] as const;
const PITCHES=[{value:'all',label:'همه زیر و بمی‌ها'},{value:'high',label:'زیر و روشن'},{value:'medium',label:'متعادل'},{value:'low',label:'بم و عمیق'}] as const;
const USE_CASES=[{value:'general',label:'کاربرد عمومی'},{value:'audiobook',label:'کتاب صوتی'},{value:'podcast',label:'پادکست'},{value:'story',label:'داستان'},{value:'education',label:'آموزش'},{value:'news',label:'خبر و گزارش'},{value:'advertising',label:'معرفی و تبلیغ'},{value:'accessibility',label:'خوانش دسترس‌پذیر'}] as const;
const CUES=[
    {label:'مکث کوتاه',tag:'<short pause>'},{label:'مکث بلند',tag:'<long pause>'},{label:'آه',tag:'<sigh>'},
    {label:'خنده',tag:'<laugh>'},{label:'قهقهه',tag:'<laughter>'},{label:'نفس',tag:'<breath>'},
    {label:'سرفه',tag:'<cough>'},{label:'نفس راحت',tag:'<phew>'},{label:'تعجب',tag:'<gasp>'},
];
const SCOPED_CUES=[
    {label:'نجوا',tag:'whisper'},{label:'آرام',tag:'soft'},{label:'هیجان',tag:'excited'},{label:'غمگین',tag:'sad'},
    {label:'عصبانی',tag:'angry'},{label:'رسمی',tag:'formal'},{label:'داستانی',tag:'story'},
];
const TAG_LABELS:Record<string,string>={
    '<short pause>':'مکث کوتاه','<long pause>':'مکث بلند','<sigh>':'آه','<laugh>':'خنده','<laughter>':'قهقهه',
    '<breath>':'نفس','<cough>':'سرفه','<phew>':'نفس راحت','<gasp>':'تعجب',
    '<whisper>':'شروع نجوا','</whisper>':'پایان نجوا','<soft>':'شروع آرام','</soft>':'پایان آرام',
    '<excited>':'شروع هیجان','</excited>':'پایان هیجان','<sad>':'شروع غم','</sad>':'پایان غم',
    '<angry>':'شروع خشم','</angry>':'پایان خشم','<formal>':'شروع رسمی','</formal>':'پایان رسمی',
    '<story>':'شروع داستانی','</story>':'پایان داستانی',
};

function TaggedTextPreview({text}:{text:string}){
    if(!text.match(/<[^>]+>/)) return null;
    const pieces=text.split(/(<\/?[^>]+>)/g).filter(Boolean);
    return <div className="mt-2 max-h-32 overflow-y-auto rounded-xl border border-white/[.07] bg-dark-950/35 p-3 text-xs leading-7 text-dark-300" dir="auto">{pieces.map((piece,index)=>TAG_LABELS[piece.toLowerCase()]?<span key={index} className="mx-1 inline-flex rounded-full bg-primary-500/15 px-2 py-0.5 text-[10px] font-medium text-primary-200">{TAG_LABELS[piece.toLowerCase()]}</span>:<span key={index}>{piece}</span>)}</div>;
}

export default function TTSSettingsPanel(){
    const {data:settings,isLoading}=useTTSSettings();
    const {data:jobs=[]}=useTTSJobs();
    const {data:folders=[]}=useFolderTree();
    const update=useUpdateTTSSettings();
    const create=useCreateTTSJob();
    const control=useControlTTSJob();
    const dismiss=useDismissTTSJob();
    const clearFinished=useClearFinishedTTSJobs();
    const [voice,setVoice]=useState('Kore');
    const [gender,setGender]=useState<'all'|'female'|'male'>('female');
    const [pitch,setPitch]=useState<'all'|'low'|'medium'|'high'>('medium');
    const [useCase,setUseCase]=useState<'general'|'audiobook'|'podcast'|'story'|'education'|'news'|'advertising'|'accessibility'>('general');
    const [style,setStyle]=useState('طبیعی، گرم و واضح');
    const [speed,setSpeed]=useState(1);
    const [autoExpression,setAutoExpression]=useState(true);
    const [title,setTitle]=useState('صدای ساخته‌شده');
    const [text,setText]=useState('');
    const [folder,setFolder]=useState('default');
    const [message,setMessage]=useState<{kind:'ok'|'error';text:string}|null>(null);
    const [previewing,setPreviewing]=useState(false);
    const [previewUrl,setPreviewUrl]=useState('');
    const textAreaRef=useRef<HTMLTextAreaElement|null>(null);
    const previewAudioRef=useRef<HTMLAudioElement|null>(null);

    useEffect(()=>{if(settings){setVoice(settings.voice);setGender(settings.gender);setPitch(settings.pitch);setUseCase(settings.use_case);setStyle(settings.style);setSpeed(settings.speed);setAutoExpression(settings.auto_expression);setFolder(settings.folder_id?String(settings.folder_id):'default')}},[settings]);
    useEffect(()=>()=>{if(previewUrl.startsWith('blob:'))URL.revokeObjectURL(previewUrl)},[previewUrl]);
    const folderOptions=useMemo(()=>{const result=[{value:'default',label:'🗃️ کشوی پیش‌فرض کمد'}];const walk=(items:Folder[],depth=0)=>items.forEach(item=>{result.push({value:String(item.id),label:`${'— '.repeat(depth)}🗂️ ${item.name}`});if(item.children)walk(item.children,depth+1)});walk(folders);return result},[folders]);
    const availableVoices=useMemo(()=>settings?.voices.filter(item=>(gender==='all'||item.gender===gender)&&(pitch==='all'||item.pitch===pitch))||[],[settings?.voices,gender,pitch]);
    const selectedVoice=settings?.voices.find(item=>item.value===voice);
    useEffect(()=>{if(availableVoices.length&&!availableVoices.some(item=>item.value===voice))setVoice(availableVoices[0].value)},[availableVoices,voice]);

    const save=async()=>{if(!settings)return;setMessage(null);try{await update.mutateAsync({voice,gender,pitch,use_case:useCase,style,speed,auto_expression:autoExpression,model:settings.model,folder_id:folder==='default'?null:Number(folder)});setMessage({kind:'ok',text:'تنظیمات و کشوی پیش‌فرض صدا ذخیره شد.'})}catch(error:any){setMessage({kind:'error',text:error?.response?.data?.detail||'ذخیره تنظیمات انجام نشد.'})}};
    const submit=async()=>{if(!text.trim())return;setMessage(null);try{await create.mutateAsync({text:text.trim(),title:title.trim()||'صدای ساخته‌شده',folder_id:folder==='default'?null:Number(folder),voice,gender,pitch,use_case:useCase,style,speed,auto_expression:autoExpression});setText('');setMessage({kind:'ok',text:'متن در صف ساخت صدا قرار گرفت.'})}catch(error:any){setMessage({kind:'error',text:error?.response?.data?.detail||'ساخت صدا شروع نشد.'})}};
    const insertText=(value:string,cursorOffset=value.length)=>{const target=textAreaRef.current;const start=target?.selectionStart??text.length;const end=target?.selectionEnd??start;setText(`${text.slice(0,start)}${value}${text.slice(end)}`);requestAnimationFrame(()=>{target?.focus();target?.setSelectionRange(start+cursorOffset,start+cursorOffset)})};
    const insertScopedCue=(tag:string)=>{const target=textAreaRef.current;const start=target?.selectionStart??text.length;const end=target?.selectionEnd??start;const selected=text.slice(start,end)||'متن این بخش';const value=`<${tag}>${selected}</${tag}>`;insertText(value,`<${tag}>`.length+(end>start?selected.length:0))};
    const playVoicePreview=async()=>{if(!settings)return;setPreviewing(true);setMessage(null);try{const key=new Request(`${window.location.origin}/__komod_tts_preview__/${encodeURIComponent(settings.model)}/${encodeURIComponent(voice)}`);let cached:Response|undefined;try{cached=await (await caches.open('komod-tts-previews-v1')).match(key)}catch{/* Cache API may be unavailable */}let blob:Blob;if(cached)blob=await cached.blob();else{const response=await api.get<ArrayBuffer>(`/tts/preview/${encodeURIComponent(voice)}`,{responseType:'arraybuffer'});blob=new Blob([response.data],{type:'audio/wav'});try{await (await caches.open('komod-tts-previews-v1')).put(key,new Response(blob,{headers:{'Content-Type':'audio/wav'}}))}catch{/* normal playback still works */}}if(previewUrl.startsWith('blob:'))URL.revokeObjectURL(previewUrl);const url=URL.createObjectURL(blob);setPreviewUrl(url);requestAnimationFrame(()=>void previewAudioRef.current?.play())}catch(error:any){setMessage({kind:'error',text:error?.response?.data?.detail||'پخش نمونه صدا انجام نشد.'})}finally{setPreviewing(false)}};
    if(isLoading)return <div className="rounded-2xl bg-dark-900/70 p-5 text-sm text-dark-400">در حال دریافت تنظیمات صدا…</div>;
    return <div className="space-y-4">
        <section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5">
            <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-300"><Wand2 className="h-5 w-5"/></span><div><h2 className="font-bold">ساخت صدا از متن</h2><p className="mt-1 text-xs text-dark-400">فارسی و انگلیسی، با پشتیبانی از متن‌های طولانی</p></div></div>
            {!settings?.available&&<p className="mt-4 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-200">برای فعال‌شدن این بخش، کلید Gemini باید روی سرور تنظیم شود.</p>}
            <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs text-dark-400">نام خروجی<input value={title} onChange={event=>setTitle(event.target.value)} className="input mt-1.5 w-full" maxLength={180}/></label><label className="text-xs text-dark-400">کشوی مقصد و پیش‌فرض<CustomSelect className="mt-1.5" value={folder} onChange={setFolder} options={folderOptions}/></label></div>
            <label className="mt-3 block text-xs text-dark-400">متن<textarea ref={textAreaRef} value={text} onChange={event=>setText(event.target.value)} className="input mt-1.5 min-h-48 w-full resize-y leading-8" placeholder="متنت را اینجا بنویس یا بچسبان…" maxLength={200000}/></label>
            <TaggedTextPreview text={text}/>
            <p className="mt-3 text-[11px] text-dark-500">رویدادهای کوتاه</p><div className="mt-1.5 flex flex-wrap gap-1.5">{CUES.map(item=><button type="button" key={item.tag} onClick={()=>insertText(item.tag)} className="rounded-lg bg-white/[.05] px-2.5 py-1.5 text-[11px] text-dark-300 hover:bg-primary-500/10 hover:text-primary-200">{item.label}</button>)}</div>
            <p className="mt-3 text-[11px] text-dark-500">لحن یک بخش: متن را انتخاب کن، سپس یکی را بزن</p><div className="mt-1.5 flex flex-wrap gap-1.5">{SCOPED_CUES.map(item=><button type="button" key={item.tag} onClick={()=>insertScopedCue(item.tag)} className="rounded-lg border border-primary-400/15 bg-primary-500/[.07] px-2.5 py-1.5 text-[11px] text-primary-200">{item.label}</button>)}</div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-dark-500"><span>{text.length.toLocaleString('fa-IR')} نویسه</span><span>متن بلند خودکار بخش‌بندی می‌شود</span></div>
            <button disabled={!settings?.available||!text.trim()||create.isPending} onClick={()=>void submit()} className="btn-primary mt-4 flex min-h-12 w-full items-center justify-center gap-2 disabled:opacity-40"><AudioLines className="h-5 w-5"/>{create.isPending?'در حال افزودن به صف…':'ساخت و ذخیره در کمد'}</button>
        </section>
        <section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5">
            <div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary-300"/><h2 className="font-bold">گوینده و شیوه خواندن</h2></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3"><CustomSelect label="جنس صدا" value={gender} onChange={setGender} options={[...GENDERS]}/><CustomSelect label="زیر و بمی" value={pitch} onChange={setPitch} options={[...PITCHES]}/><CustomSelect label="کاربرد" value={useCase} onChange={setUseCase} options={[...USE_CASES]}/></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]"><CustomSelect label="گوینده" value={voice} onChange={setVoice} options={availableVoices.map(item=>({value:item.value,label:item.label}))}/><button disabled={previewing||!settings?.available} onClick={()=>void playVoicePreview()} className="btn-secondary mt-[1.375rem] flex min-h-11 items-center justify-center gap-2 px-4 disabled:opacity-40"><Headphones className="h-4 w-4"/>{previewing?'در حال آماده‌سازی…':'شنیدن نمونه'}</button></div>
            {selectedVoice&&<p className="mt-2 rounded-xl bg-white/[.035] px-3 py-2 text-xs leading-6 text-dark-400">{selectedVoice.description}</p>}
            {previewUrl&&<audio ref={previewAudioRef} controls preload="auto" src={previewUrl} className="mt-3 h-11 w-full"/>}
            <label className="mt-3 block text-xs text-dark-400">سرعت خواندن<div className="mt-1.5 flex min-h-11 items-center gap-3 rounded-xl border border-white/10 bg-dark-800 px-3"><input className="min-w-0 flex-1 accent-primary-500" type="range" min="0.5" max="2" step="0.05" value={speed} onChange={event=>setSpeed(Number(event.target.value))}/><span dir="ltr" className="w-12 text-center text-sm tabular-nums">{speed.toFixed(2)}×</span></div></label>
            <label className="mt-3 block text-xs text-dark-400">سبک و دستور خواندن<input value={style} onChange={event=>setStyle(event.target.value)} className="input mt-1.5 w-full" placeholder="مثلاً آرام، صمیمی و داستانی" maxLength={500}/></label>
            <div className="mt-2 flex flex-wrap gap-2">{['آرام و صمیمی','رسمی و شمرده','پرانرژی و هیجان‌انگیز','داستانی و احساسی','نجواگونه و نزدیک','آموزشی و بسیار واضح'].map(item=><button key={item} onClick={()=>setStyle(item)} className="rounded-full border border-white/[.08] bg-dark-800 px-3 py-2 text-xs text-dark-300 hover:border-primary-400/30">{item}</button>)}</div>
            <label className="mt-4 flex min-h-12 items-center gap-3 rounded-xl bg-dark-800/60 px-3"><input type="checkbox" checked={autoExpression} onChange={event=>setAutoExpression(event.target.checked)} className="h-5 w-5 accent-primary-500"/><span className="text-sm">تشخیص خودکار احساس، مکث و لحن از متن</span></label>
            <button onClick={()=>void save()} disabled={update.isPending} className="btn-secondary mt-4 flex min-h-11 w-full items-center justify-center gap-2 disabled:opacity-50"><Check className="h-4 w-4"/> ذخیره تنظیمات و کشوی پیش‌فرض</button>
        </section>
        {message&&<p className={`rounded-xl px-3 py-2 text-sm ${message.kind==='ok'?'bg-emerald-500/10 text-emerald-300':'bg-red-500/10 text-red-300'}`}>{message.text}</p>}
        {jobs.length>0&&<section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-bold">صف ساخت صدا</h2>{jobs.some(job=>['done','error','cancelled'].includes(job.state))&&<button onClick={()=>void clearFinished.mutateAsync()} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-dark-400 hover:bg-white/[.05] hover:text-white"><Trash2 className="h-3.5 w-3.5"/>پاک‌کردن تاریخچه</button>}</div><div className="mt-4 space-y-2">{jobs.map(job=>{const finished=['done','error','cancelled'].includes(job.state);return <article key={job.id} className="rounded-xl bg-dark-800/60 p-3"><div className="flex items-center gap-3"><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{job.title}</strong><span className="mt-1 block text-xs text-dark-400">{STATES[job.state]||job.state} · {job.message}</span></div>{finished?<button title="حذف از تاریخچه" className="btn-icon text-dark-400" onClick={()=>void dismiss.mutateAsync(job.id)}><X className="h-4 w-4"/></button>:<><button title={job.state==='paused'?'ادامه':'توقف'} className="btn-icon" onClick={()=>void control.mutateAsync({id:job.id,action:'pause'})}>{job.state==='paused'?<Play className="h-4 w-4"/>:<Pause className="h-4 w-4"/>}</button><button title="لغو" className="btn-icon text-red-300" onClick={()=>void control.mutateAsync({id:job.id,action:'cancel'})}><Square className="h-4 w-4"/></button></>}</div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-dark-950"><div className={`h-full rounded-full ${job.state==='error'?'bg-red-500':job.state==='cancelled'?'bg-dark-500':'bg-primary-500'}`} style={{width:`${job.progress||0}%`}}/></div>{job.state==='done'&&job.stream_url&&<div className="mt-3 flex items-center gap-2"><Volume2 className="h-4 w-4 shrink-0 text-primary-300"/><audio controls preload="metadata" src={job.stream_url} className="h-10 min-w-0 flex-1"/></div>}</article>})}</div></section>}
    </div>;
}
