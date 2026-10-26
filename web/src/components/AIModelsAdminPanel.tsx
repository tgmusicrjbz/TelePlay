import { useEffect, useMemo, useState } from 'react';
import { AudioLines, BrainCircuit, Check, FileAudio, FileText, Plus, ShieldCheck } from 'lucide-react';
import { AIModelOption, useAIModelCatalog, useUpdateAIModelCatalog } from '../lib/api';

const parseIds=(value:string)=>Array.from(new Set(value.split(/[\n,]+/).map(item=>item.trim()).filter(Boolean))).slice(0,12);

export default function AIModelsAdminPanel(){
    const {data,isLoading}=useAIModelCatalog();
    const update=useUpdateAIModelCatalog();
    const [ttsIds,setTtsIds]=useState('');
    const [sttIds,setSttIds]=useState('');
    const [textIds,setTextIds]=useState('');
    const [costs,setCosts]=useState<Record<string,number>>({});
    const [message,setMessage]=useState<{kind:'ok'|'error';text:string}|null>(null);
    useEffect(()=>{if(data){setTtsIds(data.tts_models.join('\n'));setSttIds(data.stt_models.join('\n'));setTextIds(data.text_models.join('\n'));setCosts(data.costs)}},[data]);
    const groups=useMemo(()=>data?[
        {title:'متن به صدا',icon:<AudioLines/>,items:data.models},
        {title:'صدا به متن',icon:<FileAudio/>,items:data.stt_models_available},
        {title:'پردازش متن',icon:<FileText/>,items:data.text_models_available},
    ]:[],[data]);
    const save=async()=>{setMessage(null);try{await update.mutateAsync({tts_models:parseIds(ttsIds),stt_models:parseIds(sttIds),text_models:parseIds(textIds),costs});setMessage({kind:'ok',text:'فهرست مدل‌ها و ضرایب سهمیه برای همه کاربران ذخیره شد.'})}catch(error:any){setMessage({kind:'error',text:error?.response?.data?.detail||'ذخیره تنظیمات مدل‌ها انجام نشد.'})}};
    if(isLoading)return <div className="rounded-2xl bg-dark-900/70 p-5 text-sm text-dark-400">در حال دریافت مدل‌های هوش مصنوعی…</div>;
    if(!data?.can_edit)return <div className="rounded-2xl border border-red-500/20 bg-red-500/[.06] p-5 text-sm text-red-200">این بخش فقط برای مدیر در دسترس است.</div>;
    return <div className="space-y-4">
        <section className="overflow-hidden rounded-3xl border border-primary-400/15 bg-gradient-to-bl from-primary-500/[.12] via-dark-900/90 to-dark-950 p-4 sm:p-5">
            <div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-500/15 text-primary-200"><BrainCircuit className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="font-bold">کاتالوگ مدل‌های برنامه</h2><p className="mt-1 text-xs leading-5 text-dark-400">این فهرست و ضریب‌ها برای همه حساب‌ها اعمال می‌شوند.</p></div><span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-[10px] text-emerald-300"><ShieldCheck className="h-3.5 w-3.5"/>فقط مدیر</span></div>
        </section>
        <section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5">
            <div className="flex items-center gap-2"><Plus className="h-4 w-4 text-primary-300"/><h3 className="text-sm font-bold">افزودن شناسه مدل</h3></div>
            <p className="mt-2 text-[11px] leading-6 text-dark-500">هر شناسه را در یک خط بنویس. پس از ذخیره، مدل برای همه کاربران در بخش مربوط در دسترس است.</p>
            <div className="mt-4 grid gap-3 md:grid-cols-3"><ModelIdsField label="ساخت صدا" value={ttsIds} onChange={setTtsIds}/><ModelIdsField label="رونویسی صدا" value={sttIds} onChange={setSttIds}/><ModelIdsField label="پردازش متن" value={textIds} onChange={setTextIds}/></div>
        </section>
        <section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5">
            <h3 className="text-sm font-bold">ضریب مصرف سهمیه</h3><p className="mt-1 text-[11px] leading-6 text-dark-500">هر اجرا به اندازه این عدد از سهمیه روزانه کاربر کم می‌کند.</p>
            <div className="mt-4 space-y-4">{groups.map(group=><div key={group.title}><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-dark-300"><span className="text-primary-300 [&>svg]:h-4 [&>svg]:w-4">{group.icon}</span>{group.title}</div><div className="grid gap-2 md:grid-cols-2">{group.items.map(item=><CostRow key={`${group.title}-${item.value}`} item={item} value={costs[item.value]??item.cost??1} onChange={value=>setCosts(current=>({...current,[item.value]:value}))}/>)}</div></div>)}</div>
            <button type="button" disabled={update.isPending} onClick={()=>void save()} className="btn-primary mt-5 flex min-h-12 w-full items-center justify-center gap-2 disabled:opacity-40"><Check className="h-4 w-4"/>{update.isPending?'در حال ذخیره…':'ذخیره کاتالوگ و ضرایب'}</button>
            {message&&<p className={`mt-3 rounded-xl px-3 py-2 text-xs leading-6 ${message.kind==='ok'?'bg-emerald-500/10 text-emerald-300':'bg-red-500/10 text-red-300'}`}>{message.text}</p>}
        </section>
    </div>;
}

function ModelIdsField({label,value,onChange}:{label:string;value:string;onChange:(value:string)=>void}){return <label className="text-xs text-dark-400">{label}<textarea dir="ltr" value={value} onChange={event=>onChange(event.target.value)} className="input mt-1.5 min-h-28 w-full resize-y text-left font-mono text-[11px] leading-6" placeholder="model-id"/></label>}

function CostRow({item,value,onChange}:{item:AIModelOption;value:number;onChange:(value:number)=>void}){return <label className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/[.06] bg-dark-950/35 p-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-sm font-black text-primary-200">×{value.toLocaleString('fa-IR')}</span><span className="min-w-0 flex-1"><strong className="block truncate text-xs">{item.label}</strong><code dir="ltr" title={item.value} className="mt-1 block truncate text-[9px] text-dark-500">{item.value}</code></span><input aria-label={`ضریب ${item.label}`} type="number" min={1} max={100} value={value} onChange={event=>onChange(Math.max(1,Math.min(100,Number(event.target.value)||1)))} className="input h-10 w-16 shrink-0 p-1 text-center text-xs"/></label>}
