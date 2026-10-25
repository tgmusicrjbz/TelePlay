import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, MessageSquareText, RotateCcw, Save, Search } from 'lucide-react';
import { AdminBotMessage, useAdminBotMessages, useResetAdminBotMessage, useUpdateAdminBotMessage } from '../lib/api';
import { useAppStore } from '../lib/store';

export default function BotMessagesSettings() {
    const {data:messages=[],isLoading,isError}=useAdminBotMessages();
    const update=useUpdateAdminBotMessage();
    const reset=useResetAdminBotMessage();
    const addToast=useAppStore(state=>state.addToast);
    const [query,setQuery]=useState('');
    const [category,setCategory]=useState('همه');
    const [selectedKey,setSelectedKey]=useState('');
    const [value,setValue]=useState('');
    const textareaRef=useRef<HTMLTextAreaElement>(null);
    const categories=useMemo(()=>['همه',...Array.from(new Set(messages.map(item=>item.category)))],[messages]);
    const filtered=useMemo(()=>messages.filter(item=>(category==='همه'||item.category===category)&&(!query.trim()||`${item.title} ${item.key} ${item.value}`.toLocaleLowerCase('fa').includes(query.trim().toLocaleLowerCase('fa')))),[messages,category,query]);
    const selected=filtered.find(item=>item.key===selectedKey)||filtered[0]||messages[0];
    useEffect(()=>{if(selected){setSelectedKey(selected.key);setValue(selected.value)}},[selected?.key,selected?.value]);
    const save=async()=>{if(!selected)return;try{await update.mutateAsync({key:selected.key,value});addToast('متن پیام ربات ذخیره شد.','success')}catch(error:any){addToast(error?.response?.data?.detail||'ذخیره متن انجام نشد.','error')}};
    const restore=async()=>{if(!selected)return;try{await reset.mutateAsync(selected.key);setValue(selected.default);addToast('متن پیش‌فرض برگردانده شد.','success')}catch(error:any){addToast(error?.response?.data?.detail||'بازگردانی متن انجام نشد.','error')}};
    const insertVariable=(name:string)=>{const token=`{${name}}`;const input=textareaRef.current;if(!input){setValue(current=>current+token);return}const start=input.selectionStart;const end=input.selectionEnd;setValue(current=>current.slice(0,start)+token+current.slice(end));requestAnimationFrame(()=>{input.focus();input.setSelectionRange(start+token.length,start+token.length)})};
    if(isLoading)return <div className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-8 text-center text-sm text-dark-400">در حال دریافت پیام‌های ربات…</div>;
    if(isError)return <div className="rounded-2xl border border-red-400/15 bg-red-500/[.07] p-5 text-sm text-red-200">دریافت پیام‌های ربات انجام نشد.</div>;
    return <section id="admin-bot-messages" className="overflow-hidden rounded-2xl border border-white/[.07] bg-dark-900/70">
        <header className="border-b border-white/[.06] p-4 sm:p-5"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-300"><MessageSquareText className="h-5 w-5"/></span><div><h2 className="font-bold">پیام‌های ربات</h2><p className="mt-1 text-xs text-dark-400">متن پاسخ‌های اصلی ربات را بدون تغییر کد مدیریت کن.</p></div></div><div className="mt-4 flex flex-col gap-2 sm:flex-row"><label className="relative min-w-0 flex-1"><Search className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-500"/><input value={query} onChange={event=>setQuery(event.target.value)} className="input w-full !pr-10" placeholder="جست‌وجوی پیام"/></label><div className="flex max-w-full gap-1 overflow-x-auto rounded-xl border border-white/[.06] bg-dark-950/40 p-1 [scrollbar-width:none]">{categories.map(item=><button key={item} onClick={()=>setCategory(item)} className={`min-h-9 shrink-0 rounded-lg px-3 text-xs transition ${category===item?'bg-primary-500 text-white':'text-dark-400 hover:bg-white/[.05]'}`}>{item}</button>)}</div></div></header>
        <div className="grid min-h-[32rem] md:grid-cols-[16rem_minmax(0,1fr)]">
            <aside className="max-h-[32rem] overflow-y-auto border-b border-white/[.06] p-2 md:border-b-0 md:border-l">{filtered.map(item=><MessageRow key={item.key} item={item} active={selected?.key===item.key} onClick={()=>{setSelectedKey(item.key);setValue(item.value)}}/>)}{!filtered.length&&<p className="p-6 text-center text-xs text-dark-500">پیامی پیدا نشد.</p>}</aside>
            {selected&&<div className="min-w-0 p-4 sm:p-5"><div className="flex flex-wrap items-start gap-2"><div className="min-w-0 flex-1"><h3 className="font-bold">{selected.title}</h3><p className="mt-1 text-[11px] text-dark-500">{selected.category} · <span dir="ltr">{selected.key}</span></p></div>{selected.customized&&<span className="rounded-lg bg-primary-500/10 px-2 py-1 text-[10px] text-primary-200">ویرایش‌شده</span>}</div>
                {selected.variables.length>0&&<div className="mt-4"><p className="mb-2 text-[11px] text-dark-500">برای درج متغیر روی آن بزن:</p><div className="flex flex-wrap gap-1.5" dir="ltr">{selected.variables.map(name=><button key={name} type="button" onClick={()=>insertVariable(name)} className="rounded-lg border border-primary-400/15 bg-primary-500/[.07] px-2 py-1 font-mono text-[11px] text-primary-200">{`{${name}}`}</button>)}</div></div>}
                <textarea ref={textareaRef} dir="auto" value={value} onChange={event=>setValue(event.target.value)} className="input mt-4 min-h-56 w-full resize-y whitespace-pre-wrap py-3 leading-7" maxLength={3500}/><div className="mt-1 flex justify-between text-[10px] text-dark-600"><span>قالب‌بندی تلگرام و رفتن به خط بعد پشتیبانی می‌شود.</span><span>{value.length.toLocaleString('fa-IR')} / ۳۵۰۰</span></div>
                <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_auto]"><button disabled={update.isPending||!value.trim()||value===selected.value} onClick={()=>void save()} className="btn-primary flex min-h-11 items-center justify-center gap-2 disabled:opacity-40"><Save className="h-4 w-4"/>{update.isPending?'در حال ذخیره…':'ذخیره پیام'}</button><button disabled={reset.isPending||!selected.customized} onClick={()=>void restore()} className="btn-secondary flex min-h-11 items-center justify-center gap-2 px-4 text-xs disabled:opacity-40"><RotateCcw className="h-4 w-4"/>متن پیش‌فرض</button></div>
                <div className="mt-4 rounded-2xl border border-white/[.06] bg-dark-950/40 p-3"><p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-dark-300"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-300"/>پیش‌نمایش متن</p><p dir="auto" className="whitespace-pre-wrap text-sm leading-7 text-dark-200">{preview(value,selected.variables)}</p></div>
            </div>}
        </div>
    </section>;
}

function MessageRow({item,active,onClick}:{item:AdminBotMessage;active:boolean;onClick:()=>void}) {
    return <button type="button" onClick={onClick} className={`mb-1 flex min-h-14 w-full items-center gap-2 rounded-xl px-3 text-right transition ${active?'bg-primary-500/15 text-white':'text-dark-300 hover:bg-white/[.04]'}`}><span className={`h-2 w-2 shrink-0 rounded-full ${item.customized?'bg-primary-300':'bg-dark-600'}`}/><span className="min-w-0 flex-1"><strong className="block truncate text-xs">{item.title}</strong><small className="mt-1 block truncate text-[10px] text-dark-500">{item.category}</small></span></button>;
}

function preview(value:string,variables:string[]) {
    return variables.reduce((text,name)=>text.replaceAll(`{${name}}`,sampleValues[name]||`[${name}]`),value);
}
const sampleValues:Record<string,string>={first_name:'مهدی',telegram_id:'۱۲۳۴۵۶۷۸',count:'۲',queue_note:' · شروع از نوبت ۳',destination:'در تلگرام فرستاده شد',error:'فایل اصلی آماده نشد',folder_name:'موسیقی',state:'در حال ذخیره…'};
