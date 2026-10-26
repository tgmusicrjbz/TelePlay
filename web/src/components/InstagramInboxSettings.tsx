import { CheckCircle2, Copy, Instagram, Link2, Loader2, MessageCircleMore, RefreshCw, Save, ShieldCheck, XCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { AdminUser, InstagramInboxSender, useAdminUsers, useInstagramInboxSenders, useInstagramInboxStatus, useRetryInstagramPairingMessage, useUpdateInstagramInboxSender } from '../lib/api';
import { useAppStore } from '../lib/store';
import CustomSelect from './CustomSelect';


function userLabel(user:AdminUser){
    const name=user.display_name||[user.first_name,user.last_name].filter(Boolean).join(' ')||user.username||`کاربر ${user.id}`;
    return `${name} · ${user.telegram_id}`;
}

function SenderCard({sender,users}:{sender:InstagramInboxSender;users:AdminUser[]}){
    const update=useUpdateInstagramInboxSender();
    const retry=useRetryInstagramPairingMessage();
    const addToast=useAppStore(state=>state.addToast);
    const [userId,setUserId]=useState<number>(sender.telegram_user_id||0);
    useEffect(()=>setUserId(sender.telegram_user_id||0),[sender.telegram_user_id]);
    const save=async(payload:Parameters<typeof update.mutateAsync>[0])=>{
        try{await update.mutateAsync(payload);addToast('تنظیمات فرستنده ذخیره شد.','success')}
        catch(error:any){addToast(error?.response?.data?.detail||'ذخیره تنظیمات انجام نشد.','error')}
    };
    const copyCode=async()=>{await navigator.clipboard.writeText(`/instagram ${sender.pairing_code}`);addToast('دستور اتصال کپی شد.','success')};
    return <article className="rounded-2xl border border-white/[.07] bg-dark-950/35 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><strong className="block truncate text-sm">{sender.username?`@${sender.username}`:`فرستنده ${sender.instagram_user_id}`}</strong><p className="mt-1 text-xs text-dark-500">{sender.received_count.toLocaleString('fa-IR')} دریافت · {sender.forwarded_count.toLocaleString('fa-IR')} ارسال</p></div>
            <span className={`rounded-full px-2.5 py-1 text-[11px] ${sender.blocked?'bg-red-500/10 text-red-300':sender.approved&&sender.telegram_user_id?'bg-emerald-500/10 text-emerald-300':'bg-amber-500/10 text-amber-300'}`}>{sender.blocked?'مسدود':sender.approved&&sender.telegram_user_id?'فعال':'منتظر اتصال یا تأیید'}</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]">
            <CustomSelect value={userId} onChange={setUserId} label="حساب تلگرام مقصد" options={[{value:0,label:'هنوز متصل نشده'},...users.filter(user=>user.is_active&&user.telegram_id>0).map(user=>({value:user.id,label:userLabel(user)}))]}/>
            <button disabled={!userId||update.isPending} onClick={()=>void save({id:sender.id,telegram_user_id:userId})} className="btn-secondary mt-auto flex h-11 items-center justify-center gap-2 px-4 disabled:opacity-40"><Save className="h-4 w-4"/> اتصال</button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
            <button onClick={()=>void copyCode()} className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-xs"><Copy className="h-4 w-4"/><span dir="ltr">/instagram {sender.pairing_code}</span></button>
            <button disabled={retry.isPending} onClick={async()=>{try{await retry.mutateAsync(sender.id);addToast('پیام اتصال در اینستاگرام ارسال شد.','success')}catch(error:any){addToast(error?.response?.data?.detail||'ارسال پیام انجام نشد.','error')}}} className="btn-secondary flex min-h-10 items-center gap-2 px-3 text-xs disabled:opacity-40"><MessageCircleMore className="h-4 w-4"/> ارسال دوباره راهنما</button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
            <button disabled={update.isPending} onClick={()=>void save({id:sender.id,approved:!sender.approved,blocked:false})} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-xs transition ${sender.approved?'border-emerald-400/30 bg-emerald-500/10 text-emerald-200':'border-white/[.08] bg-dark-800/60 text-dark-300'}`}><CheckCircle2 className="h-4 w-4"/>{sender.approved?'تأیید شده':'تأیید دسترسی'}</button>
            <button disabled={update.isPending} onClick={()=>void save({id:sender.id,save_to_library:!sender.save_to_library})} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-xs transition ${sender.save_to_library?'border-primary-400/30 bg-primary-500/10 text-primary-200':'border-white/[.08] bg-dark-800/60 text-dark-300'}`}><Link2 className="h-4 w-4"/>{sender.save_to_library?'ارسال و ذخیره در کمد':'فقط ارسال تلگرام'}</button>
            <button disabled={update.isPending} onClick={()=>void save({id:sender.id,blocked:!sender.blocked})} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl border px-3 text-xs transition ${sender.blocked?'border-red-400/30 bg-red-500/10 text-red-200':'border-white/[.08] bg-dark-800/60 text-dark-300'}`}><XCircle className="h-4 w-4"/>{sender.blocked?'رفع مسدودی':'مسدود کردن'}</button>
        </div>
    </article>;
}

export default function InstagramInboxSettings(){
    const {data:status,isLoading:statusLoading,refetch:refetchStatus}=useInstagramInboxStatus(true);
    const {data:senders=[],isLoading,isError,refetch}=useInstagramInboxSenders(true);
    const {data:users=[]}=useAdminUsers(true);
    const addToast=useAppStore(state=>state.addToast);
    const sorted=useMemo(()=>[...senders].sort((a,b)=>Number(a.approved)-Number(b.approved)||Number(b.last_message_at?new Date(b.last_message_at):0)-Number(a.last_message_at?new Date(a.last_message_at):0)),[senders]);
    const copyCallback=async()=>{if(!status?.callback_url)return;await navigator.clipboard.writeText(status.callback_url);addToast('آدرس Webhook کپی شد.','success')};
    return <div className="space-y-4">
        <section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-5">
            <div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-fuchsia-500/10 text-fuchsia-300"><Instagram className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="font-bold">دریافت پست از دایرکت اینستاگرام</h2><p className="mt-1 text-xs leading-6 text-dark-400">فقط فرستنده‌ای که به حساب تلگرام وصل و توسط مدیر تأیید شده باشد، می‌تواند پست دریافت کند.</p></div></div>
            {statusLoading?<Loader2 className="mx-auto mt-5 h-5 w-5 animate-spin text-dark-400"/>:<div className="mt-4 grid gap-3 sm:grid-cols-3"><div className={`rounded-2xl p-3 ${status?.configured?'bg-emerald-500/[.08] text-emerald-200':'bg-amber-500/[.08] text-amber-200'}`}><ShieldCheck className="h-5 w-5"/><strong className="mt-2 block text-sm">{status?.configured?'Webhook آماده است':'تنظیمات سرور ناقص است'}</strong></div><div className="rounded-2xl bg-dark-800/50 p-3"><span className="text-xs text-dark-400">فرستنده‌ها</span><strong className="mt-2 block text-xl">{(status?.total_senders||0).toLocaleString('fa-IR')}</strong></div><div className="rounded-2xl bg-dark-800/50 p-3"><span className="text-xs text-dark-400">منتظر تأیید</span><strong className="mt-2 block text-xl text-amber-200">{(status?.pending_senders||0).toLocaleString('fa-IR')}</strong></div></div>}
            {status?.callback_url&&<button onClick={()=>void copyCallback()} className="mt-4 flex w-full items-center justify-between gap-3 rounded-xl border border-white/[.07] bg-dark-950/40 px-3 py-3 text-left text-xs"><Copy className="h-4 w-4 shrink-0 text-primary-300"/><span dir="ltr" className="min-w-0 flex-1 truncate">{status.callback_url}</span></button>}
            {status&&!status.reply_configured&&<p className="mt-3 rounded-xl bg-amber-500/[.07] px-3 py-2 text-xs leading-6 text-amber-200">دریافت Webhook ممکن است؛ برای فرستادن خودکار کد اتصال در دایرکت، شناسه حساب و Access Token را هم روی سرور تنظیم کن.</p>}
        </section>
        <section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="font-bold">فرستنده‌ها</h2><p className="mt-1 text-xs text-dark-400">اتصال، تأیید و شیوه نگهداری هر حساب</p></div><button onClick={()=>void Promise.all([refetch(),refetchStatus()])} className="btn-icon" title="تازه‌سازی"><RefreshCw className="h-4 w-4"/></button></div>
            <div className="mt-4 space-y-3">{isLoading?<Loader2 className="mx-auto h-6 w-6 animate-spin text-dark-400"/>:isError?<p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">گرفتن فرستنده‌ها انجام نشد.</p>:sorted.length?sorted.map(sender=><SenderCard key={sender.id} sender={sender} users={users}/>):<p className="rounded-xl bg-dark-800/40 p-4 text-center text-sm text-dark-400">هنوز پستی به دایرکت حساب متصل فرستاده نشده است.</p>}</div>
        </section>
    </div>;
}
