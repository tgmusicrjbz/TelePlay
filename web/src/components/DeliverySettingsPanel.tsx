import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bot, Check, CheckCircle2, Clock3, Instagram, Loader2, MessageCircle, Pencil, Play, Plus, RadioTower, Save, Send, Trash2, X, Youtube } from 'lucide-react';
import { api, useCurrentUser } from '../lib/api';
import CustomSelect from './CustomSelect';

type Destination = { id:number; name:string; chat_id:number; chat_type:string; is_default:boolean; enabled:boolean };
type Templates = { youtube:string; instagram:string; pinterest:string; telegram:string; drive:string; generic:string };
type Monitor = { id:number; name:string; source_type:string; source_url:string; enabled:boolean; interval_minutes:number; run_at?:string|null; filters:Record<string,unknown>; actions:Record<string,unknown>; last_checked_at?:string|null; last_error?:string|null };
type MonitorAccount = { index:number; telegram_id:number; name:string; username?:string|null };
type MonitorStatus = { state:'connected'|'partial'|'shared_session'|'connection_failed'|'not_configured'|'disabled'; message:string; configured_count:number; connected_count:number; shared_with_import_count?:number; accounts:MonitorAccount[] };
type DeliverySection = 'destinations'|'monitors'|'captions';
const destinationTypeLabel=(value:string)=>({private:'گفت‌وگوی خصوصی',group:'گروه',supergroup:'گروه بزرگ',channel:'کانال'} as Record<string,string>)[value]||'مقصد تلگرام';

const defaults:Templates = { youtube:'📝 [عنوان]\n📺 [سازنده]\n🔗 [لینک]', instagram:'📝 [عنوان]\n📷 [سازنده]\n🔗 [لینک]', pinterest:'📝 [عنوان]\n📌 پینترست\n🔗 [لینک]', telegram:'📝 [عنوان]', drive:'📝 [عنوان]', generic:'📝 [عنوان]' };

export default function DeliverySettingsPanel({ section }:{ section?:DeliverySection }) {
  const { data:user } = useCurrentUser();
  const [tab,setTab] = useState<DeliverySection>(section || 'destinations');
  const activeTab = section || tab;
  const isAdmin = Boolean(user?.is_admin);
  const [destinations,setDestinations] = useState<Destination[]>([]);
  const [monitors,setMonitors] = useState<Monitor[]>([]);
  const [monitorAccounts,setMonitorAccounts] = useState<MonitorAccount[]>([]);
  const [monitorStatus,setMonitorStatus] = useState<MonitorStatus|null>(null);
  const [monitorsLoading,setMonitorsLoading] = useState(false);
  const [runningMonitorId,setRunningMonitorId] = useState<number|null>(null);
  const [templates,setTemplates] = useState<Templates>(defaults);
  const [canEdit,setCanEdit] = useState(false);
  const [message,setMessage] = useState('');
  const [destinationName,setDestinationName] = useState('');
  const [chatId,setChatId] = useState('');
  const [editing,setEditing] = useState<Destination|null>(null);
  const [monitorName,setMonitorName] = useState('');
  const [sourceType,setSourceType] = useState('youtube');
  const [sourceUrl,setSourceUrl] = useState('');
  const [monitorSessionIndex,setMonitorSessionIndex] = useState('0');
  const [interval,setInterval] = useState('60');
  const [runAt,setRunAt] = useState('');
  const [mediaType,setMediaType] = useState('all');
  const [keywords,setKeywords] = useState('');
  const [selectedDestinations,setSelectedDestinations] = useState<number[]>([]);
  const [includeExisting,setIncludeExisting] = useState(false);
  const [tts,setTts] = useState(false);

  const load = useCallback(async () => {
    if (activeTab === 'destinations') {
      setDestinations((await api.get<Destination[]>('/delivery/destinations')).data);
      return;
    }
    if (activeTab === 'captions') {
      const response = await api.get<{templates:Templates;can_edit:boolean}>('/delivery/caption-templates');
      setTemplates({...defaults,...response.data.templates});
      setCanEdit(response.data.can_edit);
      return;
    }
    setMonitorsLoading(true);
    const [destinationResult,monitorResult,statusResult] = await Promise.allSettled([
      api.get<Destination[]>('/delivery/destinations'),
      api.get<Monitor[]>('/delivery/monitors'),
      isAdmin ? api.get<MonitorStatus>('/delivery/monitor-status') : Promise.resolve(null),
    ]);
    const errors:string[]=[];
    if(destinationResult.status==='fulfilled')setDestinations(destinationResult.value.data);else errors.push(destinationResult.reason?.response?.data?.detail||'مقصدها دریافت نشدند.');
    if(monitorResult.status==='fulfilled')setMonitors(monitorResult.value.data);else errors.push(monitorResult.reason?.response?.data?.detail||'فهرست پایش‌ها دریافت نشد.');
    if(isAdmin&&statusResult.status==='fulfilled'&&statusResult.value){setMonitorStatus(statusResult.value.data);setMonitorAccounts(statusResult.value.data.accounts)}
    else if(isAdmin&&statusResult.status==='rejected'){const detail=statusResult.reason?.response?.data?.detail||'وضعیت حساب پایش دریافت نشد.';setMonitorStatus({state:'connection_failed',message:detail,configured_count:0,connected_count:0,accounts:[]});errors.push(detail)}
    setMonitorsLoading(false);
    if(errors.length)setMessage(errors.join(' '));
  },[activeTab,isAdmin]);

  useEffect(() => { void load().catch((error:any) => setMessage(error?.response?.data?.detail || 'گرفتن تنظیمات این بخش انجام نشد.')); },[load]);
  const notify = (value:string) => { setMessage(value); window.setTimeout(() => setMessage(''),3500); };
  const destinationMap = useMemo(() => new Map(destinations.map(item => [item.id,item.name])),[destinations]);
  const sourceOptions = useMemo(() => [
    {value:'youtube',label:'یوتیوب'}, {value:'instagram',label:'اینستاگرام (آزمایشی)'}, {value:'telegram',label:'کانال عمومی تلگرام'},
    ...(isAdmin ? [{value:'saved_messages',label:'پیام‌های ذخیره‌شده'}] : []),
  ],[isAdmin]);

  const addDestination = async () => {
    const id=Number(chatId);
    if(!destinationName.trim() || !Number.isSafeInteger(id)){ notify('نام و آیدی عددی معتبر را وارد کن.'); return; }
    try { await api.post('/delivery/destinations',{name:destinationName.trim(),chat_id:id,is_default:destinations.length===0}); setDestinationName(''); setChatId(''); await load(); notify('مقصد تلگرام اضافه شد.'); }
    catch(error:any) { notify(error?.response?.data?.detail || 'افزودن مقصد انجام نشد.'); }
  };
  const saveDestination = async () => { if(!editing)return; await api.patch(`/delivery/destinations/${editing.id}`,{name:editing.name,is_default:editing.is_default,enabled:editing.enabled}); setEditing(null); await load(); notify('تغییرات مقصد ذخیره شد.'); };
  const deleteDestination = async (id:number) => { await api.delete(`/delivery/destinations/${id}`); setSelectedDestinations(values=>values.filter(value=>value!==id)); await load(); notify('مقصد حذف شد.'); };
  const addMonitor = async () => {
    if(!monitorName.trim() || !sourceUrl.trim()){ notify('نام و نشانی منبع را وارد کن.'); return; }
    try {
      await api.post('/delivery/monitors',{
        name:monitorName.trim(), source_type:sourceType, source_url:sourceUrl.trim(), enabled:true, interval_minutes:Number(interval)||60, run_at:runAt||null,
        filters:{include_keywords:keywords.split(/[،,]/).map(value=>value.trim()).filter(Boolean),keyword_mode:'or',media_types:mediaType==='all'?[]:[mediaType]},
        actions:{destination_ids:selectedDestinations,send_to_telegram:true,save_to_library:true,include_existing:includeExisting,initial_count:1,text_to_speech:tts,...(['saved_messages','telegram'].includes(sourceType)?{monitor_session_index:Number(monitorSessionIndex)||0}:{})},
      });
      setMonitorName(''); setSourceUrl(''); setKeywords(''); setRunAt(''); await load(); notify('پایش منبع فعال شد.');
    } catch(error:any) { notify(error?.response?.data?.detail || 'ساخت پایش انجام نشد.'); }
  };
  const toggleMonitor = async (item:Monitor) => { await api.put(`/delivery/monitors/${item.id}`,{name:item.name,source_type:item.source_type,source_url:item.source_url,enabled:!item.enabled,interval_minutes:item.interval_minutes,run_at:item.run_at,filters:item.filters,actions:item.actions}); await load(); };
  const runMonitor = async (item:Monitor) => { setRunningMonitorId(item.id); try { const {data}=await api.post<{queued:number}>(`/delivery/monitors/${item.id}/run`); await load(); notify(`منبع بررسی شد؛ ${Number(data.queued||0).toLocaleString('fa-IR')} مورد تازه وارد صف شد.`); } catch(error:any) { await load(); notify(error?.response?.data?.detail||'بررسی منبع انجام نشد.'); } finally { setRunningMonitorId(null); } };
  const saveTemplates = async () => { try { await api.put('/delivery/caption-templates',templates); notify('قالب عمومی توضیحات ذخیره شد.'); } catch(error:any) { notify(error?.response?.data?.detail || 'ذخیره قالب‌ها انجام نشد.'); } };

  const headings:Record<DeliverySection,{title:string;description:string;icon:typeof Send}> = {
    destinations:{title:'مقصدهای ارسال',description:'گروه‌ها، کانال‌ها و افرادی که خروجی برایشان فرستاده می‌شود',icon:Send},
    monitors:{title:'پایش منابع',description:'کانال‌ها و صفحه‌ها را زمان‌بندی و خودکار بررسی کن',icon:RadioTower},
    captions:{title:'متن عمومی خروجی‌ها',description:'متن زیر فایل‌های خروجی را برای همه کاربران مدیریت کن',icon:Bot},
  };
  const heading=headings[activeTab]; const HeadingIcon=heading.icon;

  return <section id={section?`delivery-${section}`:'files-delivery'} className="overflow-hidden rounded-3xl border border-white/[.07] bg-dark-900/70">
    <header className="flex items-center gap-3 border-b border-white/[.07] p-4 sm:p-5"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-300"><HeadingIcon className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="font-bold">{heading.title}</h2><p className="mt-1 text-xs text-dark-400">{heading.description}</p></div></header>
    {!section&&<div className="grid grid-cols-2 gap-1 border-b border-white/[.06] bg-dark-950/25 p-2">{([['destinations','مقصدها',Send],['monitors','پایش خودکار',RadioTower]] as const).map(([value,label,Icon])=><button key={value} onClick={()=>setTab(value)} className={`flex min-h-10 items-center justify-center gap-1.5 rounded-xl text-xs transition ${tab===value?'bg-primary-500 text-white':'text-dark-400 hover:bg-white/[.04]'}`}><Icon className="h-4 w-4"/><span>{label}</span></button>)}</div>}
    <div className="p-4 sm:p-5">{message&&<p className="mb-4 rounded-xl border border-primary-400/15 bg-primary-500/[.08] p-3 text-xs text-primary-100">{message}</p>}
      {activeTab==='destinations'&&<>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input dir="rtl" value={destinationName} onChange={event=>setDestinationName(event.target.value)} className="input text-right" placeholder="نام مقصد؛ مثلاً کانال آرشیو"/><input dir="ltr" inputMode="numeric" value={chatId} onChange={event=>setChatId(event.target.value.replace(/[^\d-]/g,''))} className="input text-left" placeholder="-1001234567890"/><button onClick={()=>void addDestination()} className="btn-primary flex min-h-11 items-center justify-center gap-2 px-4"><Plus className="h-4 w-4"/>افزودن</button></div>
        <p className="mt-2 text-[11px] leading-5 text-dark-500">ربات را به گروه یا کانال اضافه کن و اجازه ارسال بده. در گروه می‌توانی دستور <code dir="ltr">/connect_here</code> را هم بفرستی.</p>
        <div className="mt-4 space-y-2">{destinations.map(item=><article key={item.id} className="rounded-2xl border border-white/[.06] bg-dark-800/45 p-3"><div className="flex items-center gap-3"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.enabled?'bg-emerald-400':'bg-dark-600'}`}/><div className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm">{item.name}</strong><div className="mt-1.5 flex flex-wrap items-center gap-1.5"><span className="rounded-lg bg-white/[.05] px-2 py-1 text-[10px] text-dark-300">{destinationTypeLabel(item.chat_type)}</span><span dir="ltr" className="rounded-lg bg-dark-950/40 px-2 py-1 font-player text-[9px] text-dark-500">{item.chat_id}</span>{item.is_default&&<span className="rounded-lg bg-primary-500/10 px-2 py-1 text-[10px] text-primary-200">پیش‌فرض</span>}</div></div><button className="btn-icon h-9 w-9" onClick={()=>setEditing({...item})} title="ویرایش مقصد"><Pencil className="h-4 w-4"/></button><button className="btn-icon h-9 w-9 text-red-300" onClick={()=>void deleteDestination(item.id)} title="حذف مقصد"><Trash2 className="h-4 w-4"/></button></div></article>)}{!destinations.length&&<p className="py-8 text-center text-sm text-dark-500">هنوز مقصدی اضافه نشده.</p>}</div>
      </>}
      {activeTab==='monitors'&&<>
        {isAdmin&&monitorStatus&&<div className={`mb-4 rounded-2xl border p-3 ${monitorStatus.state==='connected'?'border-emerald-400/20 bg-emerald-500/[.07] text-emerald-100':['partial','shared_session'].includes(monitorStatus.state)?'border-amber-400/20 bg-amber-500/[.07] text-amber-100':'border-red-400/20 bg-red-500/[.07] text-red-100'}`}><div className="flex items-start gap-3">{monitorStatus.state==='connected'?<CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0"/>:<RadioTower className="mt-0.5 h-5 w-5 shrink-0"/>}<div className="min-w-0 flex-1"><strong className="block text-xs">وضعیت حساب پایش تلگرام</strong><p className="mt-1 text-[11px] leading-5 opacity-80">{monitorStatus.message}</p>{monitorStatus.configured_count>0&&<small className="mt-1 block opacity-60">تنظیم‌شده: {monitorStatus.configured_count.toLocaleString('fa-IR')} · متصل: {monitorStatus.connected_count.toLocaleString('fa-IR')}</small>}</div><button className="rounded-lg bg-white/[.07] px-2 py-1 text-[10px]" onClick={()=>void load()}>بررسی دوباره</button></div></div>}
        <div className="grid gap-2 sm:grid-cols-2"><input value={monitorName} onChange={event=>setMonitorName(event.target.value)} className="input" placeholder="نام پایش"/><CustomSelect value={sourceType} onChange={value=>{setSourceType(value);if(value==='saved_messages')setSourceUrl('me')}} options={sourceOptions}/><input dir="ltr" value={sourceUrl} onChange={event=>setSourceUrl(event.target.value)} className="input sm:col-span-2" readOnly={sourceType==='saved_messages'} placeholder={sourceType==='saved_messages'?'me':sourceType==='telegram'?'@channel یا لینک عمومی t.me':'لینک کانال یا صفحه'}/>
          {(sourceType==='saved_messages'||sourceType==='telegram')&&<>{sourceType==='saved_messages'&&<p className="sm:col-span-2 rounded-xl border border-primary-400/15 bg-primary-500/[.07] px-3 py-2 text-xs leading-6 text-primary-100">Saved Messages فقط با حساب اختصاصی پایش خوانده می‌شود و این حساب در دانلود لینک استفاده نمی‌شود.</p>}{monitorAccounts.length?<div className="sm:col-span-2"><CustomSelect value={monitorSessionIndex} onChange={setMonitorSessionIndex} options={monitorAccounts.map(account=>({value:String(account.index),label:`${account.name}${account.username?` (@${account.username})`:''}`}))}/></div>:isAdmin&&monitorStatus?.state==='not_configured'?<p className="sm:col-span-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-200">سشن در محیط اجرای سرویس API دیده نشد. متغیر را روی همان Railway Service تنظیم و سرویس را Redeploy کن.</p>:null}</>}
          {sourceType==='instagram'&&<p className="sm:col-span-2 rounded-xl border border-amber-400/15 bg-amber-500/[.07] px-3 py-2 text-xs leading-6 text-amber-100">پایش صفحه‌های عمومی اینستاگرام به محدودیت‌های اینستاگرام وابسته است و ممکن است بدون اتصال رسمی Meta کار نکند. نتیجه هر اجرا در کارت پایش ثبت می‌شود.</p>}
          <input value={keywords} onChange={event=>setKeywords(event.target.value)} className="input" placeholder="کلمه‌های موردنظر، با ویرگول"/><CustomSelect value={mediaType} onChange={setMediaType} options={[{value:'all',label:'همه نوع محتوا'},{value:'video',label:'ویدیو'},{value:'audio',label:'صدا'},{value:'image',label:'عکس'},{value:'text',label:'متن'},{value:'document',label:'فایل'}]}/><CustomSelect value={interval} onChange={setInterval} options={[{value:'15',label:'هر ۱۵ دقیقه'},{value:'30',label:'هر ۳۰ دقیقه'},{value:'60',label:'هر ساعت'},{value:'360',label:'هر ۶ ساعت'},{value:'1440',label:'هر روز'}]}/><label className="input flex items-center gap-2 text-xs text-dark-400">یا رأس ساعت<input dir="ltr" type="time" value={runAt} onChange={event=>setRunAt(event.target.value)} className="min-w-0 flex-1 bg-transparent text-left text-white outline-none"/></label></div>
        <div className="mt-3 rounded-2xl border border-white/[.06] p-3"><p className="mb-2 text-xs text-dark-400">ارسال به</p><div className="flex flex-wrap gap-2">{destinations.map(item=><button key={item.id} onClick={()=>setSelectedDestinations(values=>values.includes(item.id)?values.filter(value=>value!==item.id):[...values,item.id])} className={`rounded-xl border px-3 py-2 text-xs ${selectedDestinations.includes(item.id)?'border-primary-400/35 bg-primary-500/15 text-primary-100':'border-white/10 text-dark-400'}`}>{item.name}</button>)}</div></div>
        <div className="mt-3 flex flex-wrap gap-2"><Toggle checked={includeExisting} onClick={()=>setIncludeExisting(value=>!value)} label="اولین مورد فعلی هم پردازش شود"/><Toggle checked={tts} onClick={()=>setTts(value=>!value)} label="متن‌های تلگرام به صدا تبدیل شوند"/></div><button onClick={()=>void addMonitor()} className="btn-primary mt-4 flex min-h-11 w-full items-center justify-center gap-2"><Plus className="h-4 w-4"/>ساخت پایش</button>
        <div className="mt-6 space-y-4">{monitorsLoading?<div className="flex items-center justify-center gap-2 rounded-2xl border border-white/[.06] py-10 text-sm text-dark-400"><Loader2 className="h-5 w-5 animate-spin"/>در حال دریافت پایش‌ها…</div>:monitors.map(item=>{const SourceIcon=item.source_type==='youtube'?Youtube:item.source_type==='instagram'?Instagram:MessageCircle;return <article key={item.id} className="rounded-2xl border border-white/[.08] bg-dark-800/55 p-4 shadow-lg shadow-black/10"><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-200"><SourceIcon className="h-5 w-5"/></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong className="block truncate text-sm">{item.name}</strong><span className="rounded-md bg-white/[.05] px-1.5 py-0.5 text-[9px] text-dark-400">{item.source_type==='youtube'?'یوتیوب':item.source_type==='instagram'?'اینستاگرام':item.source_type==='saved_messages'?'پیام‌های ذخیره‌شده':'تلگرام'}</span></div><p dir="ltr" className="mt-1 truncate text-left text-[10px] text-dark-500">{item.source_url}</p><small className="mt-2 block text-dark-400"><Clock3 className="ml-1 inline h-3 w-3"/>{item.run_at?`هر روز ساعت ${item.run_at}`:`هر ${item.interval_minutes.toLocaleString('fa-IR')} دقیقه`} · {((item.actions.destination_ids as number[])||[]).map(id=>destinationMap.get(id)).filter(Boolean).join('، ')||'تلگرام خودم'}</small>{item.last_checked_at&&<small className="mt-1 block text-[10px] text-dark-500">آخرین بررسی: {new Date(item.last_checked_at).toLocaleString('fa-IR')}</small>}</div></div><div className="mt-3 grid grid-cols-[1fr_auto_auto] gap-2 border-t border-white/[.06] pt-3"><button onClick={()=>void toggleMonitor(item)} className={`min-h-9 rounded-xl px-3 text-xs ${item.enabled?'bg-emerald-500/10 text-emerald-300':'bg-dark-700 text-dark-400'}`}>{item.enabled?'فعال':'متوقف'}</button><button disabled={runningMonitorId===item.id} title="بررسی حالا" className="btn-icon h-9 w-9 disabled:opacity-50" onClick={()=>void runMonitor(item)}>{runningMonitorId===item.id?<Loader2 className="h-4 w-4 animate-spin"/>:<Play className="h-4 w-4"/>}</button><button className="btn-icon h-9 w-9 text-red-300" onClick={async()=>{await api.delete(`/delivery/monitors/${item.id}`);await load()}}><Trash2 className="h-4 w-4"/></button></div>{item.last_error&&<p className="mt-3 rounded-xl border border-red-400/10 bg-red-500/[.07] p-2.5 text-[11px] leading-5 text-red-200"><strong className="block">خطای آخرین اجرا</strong>{item.last_error}</p>}</article>})}{!monitorsLoading&&!monitors.length&&<p className="rounded-2xl border border-dashed border-white/10 py-10 text-center text-sm text-dark-500">هنوز پایشی ساخته نشده است.</p>}</div>
      </>}
      {activeTab==='captions'&&<><p className="mb-4 text-xs leading-6 text-dark-400">متغیرها: <code>[عنوان]</code>، <code>[سازنده]</code>، <code>[لینک]</code>، <code>[پلتفرم]</code>، <code>[نوع]</code> و <code>[کیفیت]</code>.</p>{Object.entries({youtube:'یوتیوب',instagram:'اینستاگرام',pinterest:'پینترست',telegram:'تلگرام',drive:'گوگل درایو',generic:'سایر فایل‌ها'}).map(([key,label])=><label key={key} className="mt-3 block text-xs text-dark-300">{label}<textarea disabled={!canEdit} dir="rtl" value={templates[key as keyof Templates]} onChange={event=>setTemplates(value=>({...value,[key]:event.target.value}))} className="input mt-2 min-h-44 w-full max-w-full resize-y text-right sm:min-h-52"/></label>)}{canEdit?<button onClick={()=>void saveTemplates()} className="btn-primary mt-4 flex min-h-11 w-full items-center justify-center gap-2"><Save className="h-4 w-4"/>ذخیره برای همه</button>:<p className="mt-4 text-center text-xs text-dark-500">ویرایش قالب عمومی فقط برای مدیر فعال است.</p>}</>}
    </div>
    {editing&&<div className="fixed inset-0 z-[220] flex items-end justify-center bg-black/70 p-3 sm:items-center" onClick={()=>setEditing(null)}><section className="w-full max-w-sm rounded-3xl border border-white/10 bg-dark-900 p-5" onClick={event=>event.stopPropagation()}><div className="flex items-center gap-3"><h3 className="flex-1 font-bold">ویرایش مقصد</h3><button className="btn-icon" onClick={()=>setEditing(null)}><X className="h-4 w-4"/></button></div><input dir="rtl" value={editing.name} onChange={event=>setEditing(value=>value?{...value,name:event.target.value}:value)} className="input mt-4 w-full text-right"/><Toggle checked={editing.enabled} onClick={()=>setEditing(value=>value?{...value,enabled:!value.enabled}:value)} label="مقصد فعال باشد"/><Toggle checked={editing.is_default} onClick={()=>setEditing(value=>value?{...value,is_default:!value.is_default}:value)} label="مقصد پیش‌فرض"/><button className="btn-primary mt-4 flex w-full items-center justify-center gap-2" onClick={()=>void saveDestination()}><Check className="h-4 w-4"/>ذخیره</button></section></div>}
  </section>;
}

function Toggle({checked,onClick,label}:{checked:boolean;onClick:()=>void;label:string}) { return <button type="button" onClick={onClick} className={`mt-2 flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs ${checked?'border-primary-400/30 bg-primary-500/10 text-primary-100':'border-white/[.07] text-dark-400'}`}><span className={`flex h-5 w-5 items-center justify-center rounded-full border ${checked?'border-primary-400 bg-primary-500':'border-white/20'}`}>{checked&&<Check className="h-3 w-3"/>}</span>{label}</button>; }
