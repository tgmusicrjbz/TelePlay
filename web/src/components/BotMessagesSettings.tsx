import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, CheckCircle2, ChevronLeft, MessageSquareText, RotateCcw, Save, Search, Undo2 } from 'lucide-react';
import { AdminBotMessage, useAdminBotMessages, useResetAdminBotMessage, useUpdateAdminBotMessage } from '../lib/api';
import { useAppStore } from '../lib/store';

type MobilePane = 'list' | 'editor';

export default function BotMessagesSettings() {
    const {data:messages=[],isLoading,isError}=useAdminBotMessages();
    const update=useUpdateAdminBotMessage();
    const reset=useResetAdminBotMessage();
    const addToast=useAppStore(state=>state.addToast);
    const [query,setQuery]=useState('');
    const [category,setCategory]=useState('همه');
    const [customizedOnly,setCustomizedOnly]=useState(false);
    const [selectedKey,setSelectedKey]=useState('');
    const [drafts,setDrafts]=useState<Record<string,string>>({});
    const [mobilePane,setMobilePane]=useState<MobilePane>('list');
    const [savedKey,setSavedKey]=useState('');
    const textareaRef=useRef<HTMLTextAreaElement>(null);

    const categories=useMemo(()=>['همه',...Array.from(new Set(messages.map(item=>item.category)))],[messages]);
    const filtered=useMemo(()=>{
        const needle=query.trim().toLocaleLowerCase('fa');
        return messages.filter(item=>(category==='همه'||item.category===category)
            &&(!customizedOnly||item.customized)
            &&(!needle||`${item.title} ${item.key} ${item.category} ${item.value}`.toLocaleLowerCase('fa').includes(needle)));
    },[messages,category,customizedOnly,query]);
    const selected=messages.find(item=>item.key===selectedKey)||messages[0];
    const value=selected?(drafts[selected.key]??selected.value):'';
    const dirty=Boolean(selected&&value!==selected.value);
    const dirtyCount=messages.filter(item=>drafts[item.key]!==undefined&&drafts[item.key]!==item.value).length;
    const customizedCount=messages.filter(item=>item.customized).length;
    const selectedIndex=selected?filtered.findIndex(item=>item.key===selected.key):-1;

    useEffect(()=>{
        if(!messages.length)return;
        if(!messages.some(item=>item.key===selectedKey))setSelectedKey(messages[0].key);
    },[messages,selectedKey]);
    useEffect(()=>{
        if(filtered.length&&!filtered.some(item=>item.key===selectedKey))setSelectedKey(filtered[0].key);
    },[filtered,selectedKey]);
    useEffect(()=>{
        setDrafts(current=>{
            let changed=false;
            const next={...current};
            messages.forEach(item=>{if(next[item.key]===item.value){delete next[item.key];changed=true}});
            return changed?next:current;
        });
    },[messages]);

    const setValue=(next:string)=>{if(selected)setDrafts(current=>({...current,[selected.key]:next}))};
    const selectMessage=(key:string)=>{setSelectedKey(key);setMobilePane('editor');requestAnimationFrame(()=>textareaRef.current?.focus())};
    const moveSelection=(offset:number)=>{
        if(!filtered.length)return;
        const index=selectedIndex<0?0:(selectedIndex+offset+filtered.length)%filtered.length;
        selectMessage(filtered[index].key);
    };
    const save=async(moveNext=false)=>{
        if(!selected||!value.trim()||!dirty)return;
        try{
            await update.mutateAsync({key:selected.key,value});
            setSavedKey(selected.key);
            window.setTimeout(()=>setSavedKey(current=>current===selected.key?'':current),1800);
            addToast('پیام ذخیره شد.','success');
            if(moveNext)moveSelection(1);
        }catch(error:any){addToast(error?.response?.data?.detail||'ذخیره متن انجام نشد.','error')}
    };
    const restore=async()=>{
        if(!selected)return;
        try{
            await reset.mutateAsync(selected.key);
            setDrafts(current=>({...current,[selected.key]:selected.default}));
            addToast('متن پیش‌فرض برگردانده شد.','success');
        }catch(error:any){addToast(error?.response?.data?.detail||'بازگردانی متن انجام نشد.','error')}
    };
    const insertVariable=(name:string)=>{
        const token=`{${name}}`;
        const input=textareaRef.current;
        if(!input){setValue(value+token);return}
        const start=input.selectionStart;
        const end=input.selectionEnd;
        setValue(value.slice(0,start)+token+value.slice(end));
        requestAnimationFrame(()=>{input.focus();input.setSelectionRange(start+token.length,start+token.length)});
    };

    if(isLoading)return <div className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-8 text-center text-sm text-dark-400">در حال دریافت پیام‌های ربات…</div>;
    if(isError)return <div className="rounded-2xl border border-red-400/15 bg-red-500/[.07] p-5 text-sm text-red-200">دریافت پیام‌های ربات انجام نشد.</div>;
    return <section id="admin-bot-messages" className="overflow-hidden rounded-2xl border border-white/[.07] bg-dark-900/70">
        <header className="border-b border-white/[.06] p-4 sm:p-5">
            <div className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-300"><MessageSquareText className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="font-bold">پیام‌های ربات</h2><p className="mt-1 text-xs text-dark-400">پیام را پیدا کن، متنش را تغییر بده و همان‌جا نتیجه را ببین.</p></div><div className="hidden shrink-0 gap-1.5 sm:flex"><Stat value={messages.length} label="پیام"/><Stat value={customizedCount} label="ویرایش‌شده"/></div></div>
            {dirtyCount>0&&<div className="mt-3 flex items-center gap-2 rounded-xl border border-amber-400/15 bg-amber-500/[.07] px-3 py-2 text-xs text-amber-200"><span className="h-2 w-2 rounded-full bg-amber-300"/><span className="min-w-0 flex-1">{dirtyCount.toLocaleString('fa-IR')} پیام تغییر ذخیره‌نشده دارد.</span></div>}
            <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_11rem_auto]"><label className="relative min-w-0"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-500"/><input value={query} onChange={event=>setQuery(event.target.value)} className="input w-full !pr-10" placeholder="جست‌وجوی عنوان یا متن پیام"/></label><select value={category} onChange={event=>setCategory(event.target.value)} className="input min-h-11 w-full cursor-pointer text-sm">{categories.map(item=><option key={item} value={item}>{item}</option>)}</select><button type="button" aria-pressed={customizedOnly} onClick={()=>setCustomizedOnly(value=>!value)} className={`min-h-11 rounded-xl border px-3 text-xs font-semibold transition ${customizedOnly?'border-primary-400/30 bg-primary-500 text-white':'border-white/[.08] bg-dark-950/45 text-dark-300 hover:bg-white/[.05]'}`}>فقط ویرایش‌شده‌ها</button></div>
        </header>
        <div className="grid min-h-[34rem] md:grid-cols-[18rem_minmax(0,1fr)]">
            <aside className={`${mobilePane==='editor'?'hidden md:block':'block'} max-h-[65vh] overflow-y-auto border-white/[.06] p-2 md:max-h-[42rem] md:border-l`}>
                <div className="sticky top-0 z-10 mb-2 flex items-center justify-between rounded-xl bg-dark-900/95 px-2 py-2 text-[11px] text-dark-500 backdrop-blur"><span>{filtered.length.toLocaleString('fa-IR')} پیام</span>{(query||category!=='همه'||customizedOnly)&&<button type="button" className="text-primary-200" onClick={()=>{setQuery('');setCategory('همه');setCustomizedOnly(false)}}>پاک‌کردن فیلتر</button>}</div>
                {filtered.map(item=><MessageRow key={item.key} item={item} active={selected?.key===item.key} draft={drafts[item.key]} onClick={()=>selectMessage(item.key)}/>)}
                {!filtered.length&&<div className="p-8 text-center"><Search className="mx-auto h-7 w-7 text-dark-600"/><p className="mt-3 text-xs text-dark-500">پیامی با این مشخصات پیدا نشد.</p></div>}
            </aside>
            {selected&&<div className={`${mobilePane==='list'?'hidden md:block':'block'} min-w-0 p-4 sm:p-5`}>
                <button type="button" className="mb-4 flex min-h-10 w-full items-center gap-2 rounded-xl border border-white/[.07] bg-dark-950/35 px-3 text-xs text-primary-200 md:hidden" onClick={()=>setMobilePane('list')}><ArrowRight className="h-4 w-4"/>بازگشت به فهرست پیام‌ها<span className="mr-auto text-dark-500">{filtered.length.toLocaleString('fa-IR')} مورد</span></button>
                <div className="flex flex-wrap items-start gap-2"><div className="min-w-0 flex-1"><h3 className="font-bold">{selected.title}</h3><p className="mt-1 text-[11px] text-dark-500">{selected.category} · <span dir="ltr">{selected.key}</span></p></div><div className="flex items-center gap-1.5">{savedKey===selected.key&&<span className="flex items-center gap-1 rounded-lg bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200"><CheckCircle2 className="h-3 w-3"/>ذخیره شد</span>}{selected.customized&&<span className="rounded-lg bg-primary-500/10 px-2 py-1 text-[10px] text-primary-200">اختصاصی</span>}</div></div>
                {selected.variables.length>0&&<div className="mt-4 rounded-xl border border-white/[.06] bg-dark-950/30 p-3"><p className="mb-2 text-[11px] text-dark-400">متغیرها را در محل نشانگر درج کن:</p><div className="flex flex-wrap gap-1.5" dir="ltr">{selected.variables.map(name=><button key={name} type="button" title={variableLabels[name]||name} onClick={()=>insertVariable(name)} className="rounded-lg border border-primary-400/15 bg-primary-500/[.07] px-2.5 py-1.5 font-mono text-[11px] text-primary-200 hover:bg-primary-500/[.13]">{`{${name}}`}</button>)}</div></div>}
                <label className="mt-4 block text-xs font-semibold text-dark-300">متن پاسخ<textarea ref={textareaRef} dir="auto" value={value} onChange={event=>setValue(event.target.value)} onKeyDown={event=>{if((event.ctrlKey||event.metaKey)&&event.key==='Enter'){event.preventDefault();void save()}}} className="input mt-2 min-h-64 w-full resize-y whitespace-pre-wrap py-3 text-sm leading-7" maxLength={3500} placeholder="متن پاسخ ربات را بنویس…"/></label>
                <div className="mt-1 flex flex-wrap justify-between gap-2 text-[10px] text-dark-600"><span>برای ذخیره سریع Ctrl + Enter بزن.</span><span>{value.length.toLocaleString('fa-IR')} / ۳۵۰۰</span></div>
                <div className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto]"><button disabled={update.isPending||!value.trim()||!dirty} onClick={()=>void save()} className="btn-primary flex min-h-11 items-center justify-center gap-2 disabled:opacity-40"><Save className="h-4 w-4"/>{update.isPending?'در حال ذخیره…':'ذخیره پیام'}</button><button disabled={update.isPending||!value.trim()||!dirty||filtered.length<2} onClick={()=>void save(true)} className="btn-secondary flex min-h-11 items-center justify-center gap-2 px-4 text-xs disabled:opacity-40">ذخیره و بعدی<ChevronLeft className="h-4 w-4"/></button><button disabled={!dirty} onClick={()=>setDrafts(current=>{const next={...current};delete next[selected.key];return next})} className="btn-secondary flex min-h-11 items-center justify-center gap-2 px-4 text-xs disabled:opacity-40"><Undo2 className="h-4 w-4"/>لغو تغییر</button></div>
                <div className="mt-2"><button disabled={reset.isPending||!selected.customized} onClick={()=>void restore()} className="flex min-h-10 items-center gap-2 rounded-xl px-3 text-xs text-dark-400 transition hover:bg-white/[.04] hover:text-white disabled:opacity-30"><RotateCcw className="h-4 w-4"/>{reset.isPending?'در حال بازگردانی…':'بازگردانی متن اصلی برنامه'}</button></div>
                <div className="mt-4 rounded-2xl border border-white/[.06] bg-dark-950/40 p-4"><p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold text-dark-300"><CheckCircle2 className="h-3.5 w-3.5 text-emerald-300"/>پیش‌نمایش با داده نمونه</p><p dir="auto" className="whitespace-pre-wrap text-sm leading-7 text-dark-200">{preview(value,selected.variables)}</p></div>
            </div>}
        </div>
    </section>;
}

function Stat({value,label}:{value:number;label:string}) { return <span className="rounded-xl bg-white/[.045] px-3 py-2 text-center"><strong className="block text-sm text-dark-100">{value.toLocaleString('fa-IR')}</strong><small className="text-[9px] text-dark-500">{label}</small></span> }

function MessageRow({item,active,draft,onClick}:{item:AdminBotMessage;active:boolean;draft?:string;onClick:()=>void}) {
    const dirty=draft!==undefined&&draft!==item.value;
    return <button type="button" onClick={onClick} className={`mb-1.5 flex min-h-16 w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-right transition ${active?'border-primary-400/25 bg-primary-500/15 text-white':'border-transparent bg-dark-950/20 text-dark-300 hover:border-white/[.06] hover:bg-white/[.04]'}`}><span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dirty?'bg-amber-300':item.customized?'bg-primary-300':'bg-dark-600'}`}/><span className="min-w-0 flex-1"><span className="flex items-center gap-2"><strong className="min-w-0 flex-1 truncate text-xs">{item.title}</strong>{dirty&&<small className="shrink-0 text-[9px] text-amber-200">ذخیره‌نشده</small>}</span><small dir="auto" className="mt-1.5 block truncate text-[10px] text-dark-500">{draft??item.value}</small></span></button>;
}

function preview(value:string,variables:string[]) { return variables.reduce((text,name)=>text.replaceAll(`{${name}}`,sampleValues[name]||`[${name}]`),value) }
const sampleValues:Record<string,string>={first_name:'مهدی',telegram_id:'۱۲۳۴۵۶۷۸',count:'۲',queue_note:' · شروع از نوبت ۳',destination:'در تلگرام فرستاده شد',error:'فایل اصلی آماده نشد',folder_name:'موسیقی',state:'در حال ذخیره…'};
const variableLabels:Record<string,string>={first_name:'نام کاربر',telegram_id:'شناسه تلگرام',count:'تعداد',queue_note:'وضعیت صف',destination:'مقصد',error:'متن خطا',folder_name:'نام کشو',state:'وضعیت پردازش'};
