import { useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Check, Pause, Play, Sparkles, Square, Wand2 } from 'lucide-react';
import { Folder, useControlTTSJob, useCreateTTSJob, useFolderTree, useTTSJobs, useTTSSettings, useUpdateTTSSettings } from '../lib/api';
import CustomSelect from './CustomSelect';

const STATES:Record<string,string>={queued:'در صف',paused:'متوقف',synthesizing:'در حال ساخت',merging:'در حال یکپارچه‌سازی',uploading:'در حال ذخیره',done:'آماده',error:'خطا',cancelled:'لغوشده'};

export default function TTSSettingsPanel(){
    const {data:settings,isLoading}=useTTSSettings();
    const {data:jobs=[]}=useTTSJobs();
    const {data:folders=[]}=useFolderTree();
    const update=useUpdateTTSSettings();
    const create=useCreateTTSJob();
    const control=useControlTTSJob();
    const [voice,setVoice]=useState('Kore');
    const [style,setStyle]=useState('طبیعی، گرم و واضح');
    const [speed,setSpeed]=useState(1);
    const [autoExpression,setAutoExpression]=useState(true);
    const [title,setTitle]=useState('صدای ساخته‌شده');
    const [text,setText]=useState('');
    const [folder,setFolder]=useState('default');
    const [message,setMessage]=useState<{kind:'ok'|'error';text:string}|null>(null);
    const textAreaRef=useRef<HTMLTextAreaElement|null>(null);

    useEffect(()=>{if(settings){setVoice(settings.voice);setStyle(settings.style);setSpeed(settings.speed);setAutoExpression(settings.auto_expression)}},[settings]);
    const folderOptions=useMemo(()=>{const result=[{value:'default',label:'🗃️ کشوی پیش‌فرض'}];const walk=(items:Folder[],depth=0)=>items.forEach(item=>{result.push({value:String(item.id),label:`${'— '.repeat(depth)}🗂️ ${item.name}`});if(item.children)walk(item.children,depth+1)});walk(folders);return result},[folders]);
    const save=async()=>{if(!settings)return;setMessage(null);try{await update.mutateAsync({voice,style,speed,auto_expression:autoExpression,model:settings.model});setMessage({kind:'ok',text:'تنظیمات صدا ذخیره شد.'})}catch(error:any){setMessage({kind:'error',text:error?.response?.data?.detail||'ذخیره تنظیمات انجام نشد.'})}};
    const submit=async()=>{if(!text.trim())return;setMessage(null);try{await create.mutateAsync({text:text.trim(),title:title.trim()||'صدای ساخته‌شده',folder_id:folder==='default'?null:Number(folder),voice,style,speed,auto_expression:autoExpression});setText('');setMessage({kind:'ok',text:'متن در صف ساخت صدا قرار گرفت.'})}catch(error:any){setMessage({kind:'error',text:error?.response?.data?.detail||'ساخت صدا شروع نشد.'})}};
    const insertCue=(cue:string)=>{const target=textAreaRef.current;const start=target?.selectionStart??text.length;const end=target?.selectionEnd??start;const next=`${text.slice(0,start)}${cue}${text.slice(end)}`;setText(next);requestAnimationFrame(()=>{target?.focus();target?.setSelectionRange(start+cue.length,start+cue.length)})};
    if(isLoading)return <div className="rounded-2xl bg-dark-900/70 p-5 text-sm text-dark-400">در حال دریافت تنظیمات صدا…</div>;
    return <div className="space-y-4">
        <section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-5">
            <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-300"><Wand2 className="h-5 w-5"/></span><div><h2 className="font-bold">ساخت صدا از متن</h2><p className="mt-1 text-xs text-dark-400">فارسی و انگلیسی، با پشتیبانی از متن‌های طولانی</p></div></div>
            {!settings?.available&&<p className="mt-4 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-200">برای فعال‌شدن این بخش، کلید Gemini باید روی سرور تنظیم شود.</p>}
            <div className="mt-5 grid gap-3 sm:grid-cols-2"><label className="text-xs text-dark-400">نام خروجی<input value={title} onChange={event=>setTitle(event.target.value)} className="input mt-1.5 w-full" maxLength={180}/></label><label className="text-xs text-dark-400">کشوی مقصد<CustomSelect className="mt-1.5" value={folder} onChange={setFolder} options={folderOptions}/></label></div>
            <label className="mt-3 block text-xs text-dark-400">متن<textarea ref={textAreaRef} value={text} onChange={event=>setText(event.target.value)} className="input mt-1.5 min-h-48 w-full resize-y leading-8" placeholder="متنت را اینجا بنویس یا بچسبان…" maxLength={200000}/></label>
            <div className="mt-2 flex flex-wrap gap-1.5">{[['مکث کوتاه','<short pause>'],['مکث بلند','<long pause>'],['آه','<sigh>'],['خنده','<laugh>'],['لبخند','<chuckle>'],['نجوا','<whisper>']].map(([label,cue])=><button type="button" key={cue} onClick={()=>insertCue(cue)} className="rounded-lg bg-white/[.05] px-2.5 py-1.5 text-[11px] text-dark-300 hover:bg-primary-500/10 hover:text-primary-200">{label}</button>)}</div>
            <div className="mt-2 flex items-center justify-between text-[11px] text-dark-500"><span>{text.length.toLocaleString('fa-IR')} نویسه</span><span>متن بلند خودکار به بخش‌های امن تقسیم می‌شود</span></div>
            <button disabled={!settings?.available||!text.trim()||create.isPending} onClick={()=>void submit()} className="btn-primary mt-4 flex min-h-12 w-full items-center justify-center gap-2 disabled:opacity-40"><AudioLines className="h-5 w-5"/>{create.isPending?'در حال افزودن به صف…':'ساخت و ذخیره در کمد'}</button>
        </section>
        <section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-5">
            <div className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-primary-300"/><h2 className="font-bold">گوینده و شیوه خواندن</h2></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-xs text-dark-400">گوینده<CustomSelect className="mt-1.5" value={voice} onChange={setVoice} options={(settings?.voices||[]).map(item=>({value:item.value,label:item.label}))}/></label><label className="text-xs text-dark-400">سرعت خواندن<div className="mt-1.5 flex min-h-11 items-center gap-3 rounded-xl border border-white/10 bg-dark-800 px-3"><input className="min-w-0 flex-1 accent-primary-500" type="range" min="0.5" max="2" step="0.05" value={speed} onChange={event=>setSpeed(Number(event.target.value))}/><span dir="ltr" className="w-12 text-center text-sm tabular-nums">{speed.toFixed(2)}×</span></div></label></div>
            <label className="mt-3 block text-xs text-dark-400">توضیح لحن<input value={style} onChange={event=>setStyle(event.target.value)} className="input mt-1.5 w-full" placeholder="مثلاً آرام، صمیمی و داستانی" maxLength={500}/></label>
            <div className="mt-2 flex flex-wrap gap-2">{['آرام و صمیمی','رسمی و شمرده','پرانرژی و هیجان‌انگیز','داستانی و احساسی'].map(item=><button key={item} onClick={()=>setStyle(item)} className="rounded-full border border-white/[.08] bg-dark-800 px-3 py-2 text-xs text-dark-300 hover:border-primary-400/30">{item}</button>)}</div>
            <label className="mt-4 flex min-h-12 items-center gap-3 rounded-xl bg-dark-800/60 px-3"><input type="checkbox" checked={autoExpression} onChange={event=>setAutoExpression(event.target.checked)} className="h-5 w-5 accent-primary-500"/><span className="text-sm">تشخیص خودکار احساس، مکث و لحن از متن</span></label>
            <button onClick={()=>void save()} disabled={update.isPending} className="btn-secondary mt-4 flex min-h-11 w-full items-center justify-center gap-2 disabled:opacity-50"><Check className="h-4 w-4"/> ذخیره به‌عنوان تنظیمات پیش‌فرض</button>
        </section>
        {message&&<p className={`rounded-xl px-3 py-2 text-sm ${message.kind==='ok'?'bg-emerald-500/10 text-emerald-300':'bg-red-500/10 text-red-300'}`}>{message.text}</p>}
        {jobs.length>0&&<section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-5"><h2 className="font-bold">صف ساخت صدا</h2><div className="mt-4 space-y-2">{jobs.map(job=><article key={job.id} className="rounded-xl bg-dark-800/60 p-3"><div className="flex items-center gap-3"><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{job.title}</strong><span className="mt-1 block text-xs text-dark-400">{STATES[job.state]||job.state} · {job.message}</span></div>{!['done','error','cancelled'].includes(job.state)&&<><button title={job.state==='paused'?'ادامه':'توقف'} className="btn-icon" onClick={()=>void control.mutateAsync({id:job.id,action:'pause'})}>{job.state==='paused'?<Play className="h-4 w-4"/>:<Pause className="h-4 w-4"/>}</button><button title="لغو" className="btn-icon text-red-300" onClick={()=>void control.mutateAsync({id:job.id,action:'cancel'})}><Square className="h-4 w-4"/></button></>}</div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-dark-950"><div className={`h-full rounded-full ${job.state==='error'?'bg-red-500':job.state==='cancelled'?'bg-dark-500':'bg-primary-500'}`} style={{width:`${job.progress||0}%`}}/></div></article>)}</div></section>}
    </div>;
}
