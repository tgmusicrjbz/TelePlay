import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, AudioLines, Check, DownloadCloud, FileAudio, Link2, Pause, Play, RefreshCw, Square, Trash2, Upload, X } from 'lucide-react';
import { api } from '../lib/api';
import { cancelOfflineJob, moveQueuedOfflineJob, toggleOfflineJobPause } from '../lib/offline';
import { clearFinishedLocalTransfers, listLocalTransfers, LocalTransfer, TRANSFERS_CHANGED_EVENT } from '../lib/transfers';
import { clearResolvedOfflineMutations, listOfflineMutations, OFFLINE_MUTATIONS_CHANGED, syncOfflineMutations } from '../lib/offlineMutations';

type VisibleState='queued'|'downloading'|'saving'|'paused'|'cancelled'|'done'|'error';
type LinkJob={id:string;url:string;source?:'link'|'drive';state:string;message:string;saved:number;progress?:number;quality?:string};
type SpeechJob={id:string;title?:string;state:string;message:string;progress?:number};
type Row={id:string;kind:'offline'|'upload'|'link'|'drive'|'sync'|'tts'|'stt';title:string;state:VisibleState;detail:string;percent:number};
type Filter='all'|'offline'|'upload'|'link'|'speech';

const visibleState=(state:string):VisibleState=>{
 if(state==='synthesizing'||state==='transcribing')return'downloading';
 if(state==='merging')return'saving';
 return(['queued','downloading','saving','paused','cancelled','done','error'].includes(state)?state:'queued') as VisibleState;
};

export default function TransferCenter(){
 const [local,setLocal]=useState<LocalTransfer[]>(listLocalTransfers);
 const [links,setLinks]=useState<LinkJob[]>([]);
 const [speech,setSpeech]=useState<Array<SpeechJob&{kind:'tts'|'stt'}>>([]);
 const [filter,setFilter]=useState<Filter>('all');
 const [mutations,setMutations]=useState(listOfflineMutations);
 const loadLocal=useCallback(()=>setLocal(listLocalTransfers()),[]);
 const loadServerJobs=useCallback(async()=>{try{
  const [linkJobs,driveJobs,ttsJobs,sttJobs]=await Promise.all([
   api.get<LinkJob[]>('/files/import-link/status'),api.get<LinkJob[]>('/files/import-drive/status'),
   api.get<SpeechJob[]>('/tts/jobs'),api.get<SpeechJob[]>('/stt/jobs'),
  ]);
  setLinks([...linkJobs.data.map(item=>({...item,source:'link' as const})),...driveJobs.data.map(item=>({...item,source:'drive' as const}))]);
  setSpeech([...ttsJobs.data.map(item=>({...item,kind:'tts' as const})),...sttJobs.data.map(item=>({...item,kind:'stt' as const}))]);
 }catch{/* In offline mode keep the last successful snapshot. */}},[]);
 useEffect(()=>{loadLocal();void loadServerJobs();const loadMutations=()=>setMutations(listOfflineMutations());window.addEventListener(TRANSFERS_CHANGED_EVENT,loadLocal);window.addEventListener(OFFLINE_MUTATIONS_CHANGED,loadMutations);const timer=window.setInterval(loadServerJobs,2500);return()=>{window.removeEventListener(TRANSFERS_CHANGED_EVENT,loadLocal);window.removeEventListener(OFFLINE_MUTATIONS_CHANGED,loadMutations);window.clearInterval(timer)}},[loadLocal,loadServerJobs]);
 const rows=useMemo<Row[]>(()=>[
  ...local.map(item=>({id:item.id,kind:item.kind,title:item.title,state:visibleState(item.state),detail:item.detail||'',percent:item.percent})),
  ...links.map(item=>({id:item.id,kind:(item.source==='drive'?'drive':'link') as 'drive'|'link',title:item.source==='drive'?'گوگل درایو':item.url,state:visibleState(item.state),detail:item.message,percent:item.progress??(item.state==='done'?100:item.state==='queued'?0:15)})),
  ...speech.map(item=>({id:item.id,kind:item.kind,title:item.title||(item.kind==='tts'?'ساخت صدا':'استخراج متن'),state:visibleState(item.state),detail:item.message,percent:item.progress??0})),
  ...mutations.map(item=>({id:item.id,kind:'sync' as const,title:item.entity==='folder'?'تغییر کشو':item.entity==='playlist'?'تغییر پلی‌لیست':'تغییر تگ',state:(item.state==='queued'?'queued':'error') as VisibleState,detail:item.message||(item.state==='queued'?'منتظر اتصال برای همگام‌سازی':'نیاز به بررسی'),percent:0})),
 ].filter(item=>filter==='all'||item.kind===filter||(filter==='link'&&item.kind==='drive')||(filter==='speech'&&(item.kind==='tts'||item.kind==='stt'))),[local,links,speech,mutations,filter]);
 const controlLink=async(id:string,action:'cancel'|'retry',kind:'link'|'drive'='link')=>{await api.post(kind==='drive'?`/files/import-drive/status/${id}/${action}`:`/files/import-link/status/${id}/${action}`);await loadServerJobs()};
 const controlSpeech=async(row:Row,action:'pause'|'cancel')=>{if(row.kind==='tts')await api.post(`/tts/jobs/${row.id}/${action}`);else if(row.kind==='stt'&&action==='cancel')await api.post(`/stt/jobs/${row.id}/cancel`);await loadServerJobs()};
 const cancelAll=async()=>{local.filter(item=>!['done','error','cancelled'].includes(item.state)).forEach(item=>item.kind==='upload'?window.dispatchEvent(new Event('komod-cancel-upload')):cancelOfflineJob(item.id));await Promise.allSettled([api.post('/files/import-link/cancel-all'),api.post('/files/import-drive/cancel-all'),api.post('/tts/jobs/cancel-all'),api.post('/stt/jobs/cancel-all')]);await loadServerJobs();loadLocal()};
 const clearFinished=async()=>{clearFinishedLocalTransfers();clearResolvedOfflineMutations();await Promise.allSettled([api.delete('/files/import-link/status'),api.delete('/files/import-drive/status'),api.delete('/tts/jobs'),api.delete('/stt/jobs')]);await loadServerJobs();loadLocal()};
 const cancelRow=(row:Row)=>{if(row.kind==='link'||row.kind==='drive')void controlLink(row.id,'cancel',row.kind);else if(row.kind==='tts'||row.kind==='stt')void controlSpeech(row,'cancel');else if(row.kind==='upload')window.dispatchEvent(new Event('komod-cancel-upload'));else if(row.kind==='offline')cancelOfflineJob(row.id)};
 return <div className="space-y-4">
  <div className="flex gap-1 overflow-x-auto rounded-2xl border border-white/[.08] bg-dark-900/80 p-1.5 shadow-lg shadow-black/10">{([['all','همه'],['offline','آفلاین'],['upload','آپلود'],['link','لینک و درایو'],['speech','متن و صدا']] as const).map(([value,label])=><button key={value} onClick={()=>setFilter(value)} className={`min-h-10 shrink-0 rounded-xl px-3 text-xs font-semibold transition ${filter===value?'bg-primary-500 text-white shadow-md shadow-primary-950/25':'text-dark-400 hover:bg-white/[.05] hover:text-white'}`}>{label}</button>)}</div>
  <div className="flex items-center justify-between gap-2"><p className="text-xs text-dark-400">همه پردازش‌های این حساب و دستگاه، یک‌جا</p><div className="flex"><button className="btn-icon text-red-300" title="لغو همه کارهای فعال" onClick={()=>void cancelAll()}><Square className="h-4 w-4"/></button><button className="btn-icon" title="همگام‌سازی و تازه‌سازی" onClick={()=>{void loadServerJobs();void syncOfflineMutations(config=>api.request(config))}}><RefreshCw className="h-4 w-4"/></button><button className="btn-icon text-red-300" title="پاک‌کردن موارد تمام‌شده" onClick={()=>void clearFinished()}><Trash2 className="h-4 w-4"/></button></div></div>
  <div className="space-y-2">{rows.map(row=><TransferRow key={`${row.kind}-${row.id}`} row={row} onPause={()=>row.kind==='tts'?void controlSpeech(row,'pause'):toggleOfflineJobPause(row.id)} onCancel={()=>cancelRow(row)} onRetry={()=>{if(row.kind==='link'||row.kind==='drive')void controlLink(row.id,'retry',row.kind)}} onMove={direction=>moveQueuedOfflineJob(row.id,direction)}/>)}{!rows.length&&<div className="rounded-2xl border border-dashed border-white/10 py-12 text-center text-sm text-dark-500">پردازشی برای نمایش وجود ندارد.</div>}</div>
 </div>
}

function TransferRow({row,onPause,onCancel,onRetry,onMove}:{row:Row;onPause:()=>void;onCancel:()=>void;onRetry:()=>void;onMove:(direction:-1|1)=>void}){
 const active=row.kind!=='sync'&&['queued','downloading','saving','paused'].includes(row.state);
 const Icon=row.kind==='sync'?RefreshCw:row.kind==='link'?Link2:row.kind==='drive'?DownloadCloud:row.kind==='upload'?Upload:row.kind==='tts'?AudioLines:row.kind==='stt'?FileAudio:DownloadCloud;
 const canPause=(row.kind==='tts'||(row.kind==='offline'&&row.id.startsWith('playlist-')))&&active;
 return <article className="rounded-2xl border border-white/[.07] bg-dark-800/45 p-3"><div className="flex items-center gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-300">{row.state==='done'?<Check className="h-4 w-4"/>:row.state==='error'||row.state==='cancelled'?<X className="h-4 w-4"/>:<Icon className="h-4 w-4"/>}</span><div className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm">{row.title}</strong><p className="mt-1 truncate text-[11px] text-dark-400">{row.detail||stateLabel(row.state)}</p></div>{(row.kind==='link'||row.kind==='drive')&&['error','cancelled'].includes(row.state)&&<button className="flex h-9 shrink-0 items-center gap-1 rounded-xl bg-primary-500/10 px-2.5 text-xs font-semibold text-primary-200" onClick={onRetry}><RefreshCw className="h-3.5 w-3.5"/>تلاش دوباره</button>}{active&&<><span className="text-xs font-bold text-primary-200">{Math.round(row.percent).toLocaleString('fa-IR')}٪</span>{row.kind==='offline'&&row.state==='queued'&&<div className="flex"><button className="btn-icon h-8 w-8" title="بالاتر در صف" onClick={()=>onMove(-1)}><ArrowUp className="h-3.5 w-3.5"/></button><button className="btn-icon h-8 w-8" title="پایین‌تر در صف" onClick={()=>onMove(1)}><ArrowDown className="h-3.5 w-3.5"/></button></div>}{canPause&&<button className="btn-icon h-8 w-8" onClick={onPause} title={row.state==='paused'?'ادامه':'توقف موقت'}>{row.state==='paused'?<Play className="h-3.5 w-3.5"/>:<Pause className="h-3.5 w-3.5"/>}</button>}<button className="btn-icon h-8 w-8 text-red-300" onClick={onCancel} title="لغو"><X className="h-3.5 w-3.5"/></button></>}</div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-dark-950"><div className={`h-full rounded-full transition-[width] ${row.state==='error'||row.state==='cancelled'?'bg-red-500':row.state==='done'?'bg-emerald-500':'bg-primary-500'}`} style={{width:`${Math.max(2,row.percent)}%`}}/></div></article>
}
function stateLabel(state:VisibleState){return ({queued:'در صف',downloading:'در حال پردازش',saving:'در حال ذخیره',paused:'متوقف شده',cancelled:'لغو شد',done:'تمام شد',error:'ناموفق'})[state]}
