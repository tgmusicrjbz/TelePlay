import { CalendarDays, CheckCircle2, ChevronDown, Copy, Instagram, Link2, Loader2, MessageCircleMore, RefreshCcw, RefreshCw, Save, Settings2, UserRound, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AdminUser, InstagramInboxSender, useAdminUsers, useInstagramInboxSenders, useInstagramInboxStatus, useResetInstagramDailyUsage, useRetryInstagramPairingMessage, useUpdateInstagramDefaults, useUpdateInstagramInboxSender } from '../lib/api';
import { useAppStore } from '../lib/store';
import CustomSelect from './CustomSelect';

function userLabel(user:AdminUser){
    const name=user.display_name||[user.first_name,user.last_name].filter(Boolean).join(' ')||user.username||`کاربر ${user.id}`;
    return `${name} · ${user.telegram_id}`;
}

function LimitField({label,value,onChange}:{label:string;value:number;onChange:(value:number)=>void}){
    return <label className="rounded-xl bg-white/[.035] px-3 py-2 text-[10px] text-dark-400">{label}<input dir="ltr" type="number" min="0" max="100000" value={value} onChange={event=>onChange(Math.max(0,Number(event.target.value)||0))} className="mt-1 w-full bg-transparent text-center text-sm font-bold text-white outline-none"/></label>;
}

function UsageCard({label,used,limit}:{label:string;used:number;limit:number}){
    const percent=limit?Math.min(100,Math.round(used/limit*100)):0;
    return <div className="rounded-2xl border border-white/[.06] bg-dark-950/35 p-3"><div className="flex items-center justify-between text-xs"><span className="text-dark-400">{label}</span><strong>{used.toLocaleString('fa-IR')} از {limit?limit.toLocaleString('fa-IR'):'∞'}</strong></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-dark-800"><div className="h-full rounded-full bg-gradient-to-l from-fuchsia-500 to-orange-400" style={{width:`${percent}%`}}/></div></div>;
}

function SenderCard({sender,users}:{sender:InstagramInboxSender;users:AdminUser[]}){
    const update=useUpdateInstagramInboxSender();
    const retry=useRetryInstagramPairingMessage();
    const resetDaily=useResetInstagramDailyUsage();
    const addToast=useAppStore(state=>state.addToast);
    const [userId,setUserId]=useState<number>(sender.telegram_user_id||0);
    const [expanded,setExpanded]=useState(false);
    const [dailyLimit,setDailyLimit]=useState(sender.daily_limit);
    const [monthlyLimit,setMonthlyLimit]=useState(sender.monthly_limit);
    const [displayName,setDisplayName]=useState(sender.display_name||'');
    useEffect(()=>setUserId(sender.telegram_user_id||0),[sender.telegram_user_id]);
    useEffect(()=>{setDailyLimit(sender.daily_limit);setMonthlyLimit(sender.monthly_limit)},[sender.daily_limit,sender.monthly_limit]);
    useEffect(()=>setDisplayName(sender.display_name||''),[sender.display_name]);
    const save=async(payload:Parameters<typeof update.mutateAsync>[0],message='تنظیمات فرستنده ذخیره شد.')=>{
        try{await update.mutateAsync(payload);addToast(message,'success')}
        catch(error:any){addToast(error?.response?.data?.detail||'ذخیره تنظیمات انجام نشد.','error')}
    };
    const reset=async()=>{try{await resetDaily.mutateAsync(sender.id);addToast('مصرف امروز این حساب صفر شد.','success')}catch(error:any){addToast(error?.response?.data?.detail||'ریست سهمیه انجام نشد.','error')}};
    const copyCode=async()=>{await navigator.clipboard.writeText(`/instagram ${sender.pairing_code}`);addToast('کد اتصال تلگرام کپی شد.','success')};
    const title=sender.display_name||(sender.username?`@${sender.username}`:`فرستنده ${sender.instagram_user_id}`);
    const subTitle=sender.telegram_name||(sender.username?`@${sender.username}`:'هنوز به تلگرام وصل نشده');
    const status=sender.blocked?'مسدود':sender.approved&&sender.telegram_user_id?'فعال':'منتظر اتصال یا تأیید';
    return <article className={`overflow-hidden rounded-3xl border transition ${expanded?'border-fuchsia-400/20 bg-gradient-to-b from-fuchsia-500/[.07] to-dark-950/55 shadow-xl':'border-white/[.07] bg-dark-950/35 hover:border-white/[.13]'}`}>
        <button type="button" onClick={()=>setExpanded(value=>!value)} className="flex w-full items-center gap-3 p-3.5 text-right">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-fuchsia-500/25 to-orange-500/15 text-fuchsia-200 shadow-inner"><UserRound className="h-5 w-5"/></span>
            <span className="min-w-0 flex-1"><strong className="block truncate text-sm">{title}</strong><span className="mt-1 block truncate text-[11px] text-dark-500">{subTitle} · {sender.forwarded_count.toLocaleString('fa-IR')} ارسال</span></span>
            <span className={`rounded-full px-2.5 py-1 text-[11px] ${sender.blocked?'bg-red-500/10 text-red-300':sender.approved&&sender.telegram_user_id?'bg-emerald-500/10 text-emerald-300':'bg-amber-500/10 text-amber-300'}`}>{status}</span>
            <ChevronDown className={`h-4 w-4 shrink-0 text-dark-400 transition ${expanded?'rotate-180':''}`}/>
        </button>
        {expanded&&<div className="border-t border-white/[.06] p-4 pt-3">
            <div className="grid gap-2 sm:grid-cols-2"><UsageCard label="امروز" used={sender.daily_used} limit={sender.daily_limit}/><UsageCard label="این ماه" used={sender.monthly_used} limit={sender.monthly_limit}/></div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_auto]"><label className="text-[10px] text-dark-400">نام نمایشی<input value={displayName} onChange={event=>setDisplayName(event.target.value)} maxLength={120} className="input mt-1.5 w-full" placeholder="مثلاً مهدی"/></label><button disabled={update.isPending||displayName.trim()===(sender.display_name||'')} onClick={()=>void save({id:sender.id,display_name:displayName.trim()},'نام حساب ذخیره شد.')} className="btn-primary mt-auto min-h-11 px-4 text-xs disabled:opacity-40"><Save className="ml-1 inline h-4 w-4"/>ذخیره نام</button></div>
            <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]"><CustomSelect value={userId} onChange={setUserId} label="حساب تلگرام مقصد" options={[{value:0,label:'هنوز متصل نشده'},...users.filter(user=>user.is_active&&user.telegram_id>0).map(user=>({value:user.id,label:userLabel(user)}))]}/><button disabled={!userId||update.isPending} onClick={()=>void save({id:sender.id,telegram_user_id:userId})} className="btn-primary mt-auto flex h-11 items-center justify-center gap-2 px-4 disabled:opacity-40"><Save className="h-4 w-4"/> اتصال</button></div>
            <div className="mt-3 rounded-2xl border border-white/[.06] bg-dark-950/40 p-3"><div className="mb-3 flex items-center gap-2 text-xs text-dark-300"><CalendarDays className="h-4 w-4 text-fuchsia-300"/>سهمیه ارسال پست</div><div className="grid grid-cols-2 gap-2"><LimitField label="سقف روزانه" value={dailyLimit} onChange={setDailyLimit}/><LimitField label="سقف ماهانه" value={monthlyLimit} onChange={setMonthlyLimit}/></div><div className="mt-3 grid grid-cols-2 gap-2"><button disabled={update.isPending} onClick={()=>void save({id:sender.id,daily_limit:dailyLimit,monthly_limit:monthlyLimit})} className="btn-primary flex min-h-10 items-center justify-center gap-2 text-xs"><Save className="h-4 w-4"/>ذخیره سهمیه</button><button disabled={resetDaily.isPending||sender.daily_used===0} onClick={()=>void reset()} className="btn-secondary flex min-h-10 items-center justify-center gap-2 text-xs text-amber-200 disabled:opacity-40"><RefreshCcw className="h-4 w-4"/>ریست امروز</button></div></div>
            <div className="mt-3 flex flex-wrap gap-2"><button onClick={()=>void copyCode()} className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-xs"><Copy className="h-4 w-4"/><span>کپی کد اتصال تلگرام</span></button><button disabled={retry.isPending} onClick={async()=>{try{await retry.mutateAsync(sender.id);addToast('پیام اتصال در اینستاگرام ارسال شد.','success')}catch(error:any){addToast(error?.response?.data?.detail||'ارسال پیام انجام نشد.','error')}}} className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-xs disabled:opacity-40"><MessageCircleMore className="h-4 w-4"/>ارسال دوباره پیام اتصال</button></div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3"><button disabled={update.isPending} onClick={()=>void save({id:sender.id,approved:!sender.approved,blocked:false})} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-xs transition ${sender.approved?'border-emerald-400/30 bg-emerald-500/10 text-emerald-200':'border-white/[.08] bg-dark-800/60 text-dark-300'}`}><CheckCircle2 className="h-4 w-4"/>{sender.approved?'تأیید شده':'تأیید دسترسی'}</button><button disabled={update.isPending} onClick={()=>void save({id:sender.id,save_to_library:!sender.save_to_library})} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-xs transition ${sender.save_to_library?'border-primary-400/30 bg-primary-500/10 text-primary-200':'border-white/[.08] bg-dark-800/60 text-dark-300'}`}><Link2 className="h-4 w-4"/>{sender.save_to_library?'ارسال و ذخیره در کمد':'فقط ارسال تلگرام'}</button><button disabled={update.isPending} onClick={()=>void save({id:sender.id,blocked:!sender.blocked})} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-xs transition ${sender.blocked?'border-red-400/30 bg-red-500/10 text-red-200':'border-white/[.08] bg-dark-800/60 text-dark-300'}`}><XCircle className="h-4 w-4"/>{sender.blocked?'رفع مسدودی':'مسدود کردن'}</button></div>
        </div>}
    </article>;
}

export default function InstagramInboxSettings(){
    const {data:status,isLoading:statusLoading,refetch:refetchStatus}=useInstagramInboxStatus(true);
    const {data:senders=[],isLoading,isError,refetch}=useInstagramInboxSenders(true);
    const {data:users=[]}=useAdminUsers(true);
    const updateDefaults=useUpdateInstagramDefaults();
    const resetDaily=useResetInstagramDailyUsage();
    const addToast=useAppStore(state=>state.addToast);
    const [dailyDefault,setDailyDefault]=useState(5);
    const [monthlyDefault,setMonthlyDefault]=useState(50);
    useEffect(()=>{if(status){setDailyDefault(status.default_daily_limit);setMonthlyDefault(status.default_monthly_limit)}},[status]);
    const sorted=useMemo(()=>[...senders].sort((a,b)=>Number(a.approved)-Number(b.approved)||Number(b.last_message_at?new Date(b.last_message_at):0)-Number(a.last_message_at?new Date(a.last_message_at):0)),[senders]);
    const copyCallback=async()=>{if(!status?.callback_url)return;await navigator.clipboard.writeText(status.callback_url);addToast('آدرس Webhook کپی شد.','success')};
    const saveDefaults=async()=>{try{await updateDefaults.mutateAsync({daily_limit:dailyDefault,monthly_limit:monthlyDefault});addToast('سهمیه پیش‌فرض ذخیره شد.','success')}catch(error:any){addToast(error?.response?.data?.detail||'ذخیره سهمیه پیش‌فرض انجام نشد.','error')}};
    const resetAll=async()=>{try{await resetDaily.mutateAsync(undefined);addToast('مصرف امروز همه حساب‌ها صفر شد.','success')}catch(error:any){addToast(error?.response?.data?.detail||'ریست سهمیه‌ها انجام نشد.','error')}};
    return <div className="space-y-4">
        <section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-3.5">
            <div className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-fuchsia-500/10 text-fuchsia-300"><Instagram className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="text-sm font-bold">دریافت پست از دایرکت اینستاگرام</h2><div className="mt-1 flex flex-wrap gap-2 text-[10px]"><span className={status?.configured?'text-emerald-300':'text-amber-300'}>{statusLoading?'در حال بررسی…':status?.configured?'● متصل':'● تنظیمات ناقص'}</span><span className="text-dark-500">{(status?.total_senders||0).toLocaleString('fa-IR')} فرستنده</span>{Boolean(status?.pending_senders)&&<span className="text-amber-300">{status?.pending_senders.toLocaleString('fa-IR')} منتظر تأیید</span>}</div></div><button onClick={()=>void Promise.all([refetch(),refetchStatus()])} className="btn-icon h-9 w-9" title="تازه‌سازی"><RefreshCw className="h-4 w-4"/></button></div>
            {status?.callback_url&&<button onClick={()=>void copyCallback()} className="mt-3 flex w-full items-center gap-2 rounded-xl bg-dark-950/35 px-3 py-2 text-[10px] text-dark-400"><Copy className="h-3.5 w-3.5 shrink-0 text-primary-300"/><span dir="ltr" className="min-w-0 flex-1 truncate text-left">{status.callback_url}</span></button>}
            {status&&!status.reply_configured&&<p className="mt-2 rounded-lg bg-amber-500/[.07] px-2.5 py-2 text-[10px] text-amber-200">ارسال پاسخ دایرکت هنوز تنظیم نشده است.</p>}
        </section>
        <section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-4"><div className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-fuchsia-300"/><h2 className="flex-1 text-sm font-bold">سهمیه پیش‌فرض حساب‌های تازه</h2><button disabled={resetDaily.isPending||!senders.some(sender=>sender.daily_used>0)} onClick={()=>void resetAll()} className="btn-secondary flex min-h-9 items-center gap-1.5 px-3 text-[11px] text-amber-200 disabled:opacity-40"><RefreshCcw className="h-3.5 w-3.5"/>ریست امروز همه</button></div><div className="mt-3 grid grid-cols-2 gap-2"><LimitField label="روزانه" value={dailyDefault} onChange={setDailyDefault}/><LimitField label="ماهانه" value={monthlyDefault} onChange={setMonthlyDefault}/></div><button disabled={updateDefaults.isPending} onClick={()=>void saveDefaults()} className="btn-primary mt-2 min-h-10 w-full text-xs">ذخیره مقدار پیش‌فرض</button></section>
        <section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-4"><h2 className="text-sm font-bold">فرستنده‌ها</h2><div className="mt-3 space-y-3">{isLoading?<Loader2 className="mx-auto h-6 w-6 animate-spin text-dark-400"/>:isError?<p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">گرفتن فرستنده‌ها انجام نشد.</p>:sorted.length?sorted.map(sender=><SenderCard key={sender.id} sender={sender} users={users}/>):<p className="rounded-xl bg-dark-800/40 p-4 text-center text-sm text-dark-400">هنوز فرستنده‌ای ثبت نشده است.</p>}</div></section>
    </div>;
}
