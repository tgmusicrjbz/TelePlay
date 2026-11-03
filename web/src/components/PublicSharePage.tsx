import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Gauge, KeyRound, Loader2, LockKeyhole, Maximize, Pause, PictureInPicture2, Play, Repeat2, RotateCcw, RotateCw, ShieldCheck, Volume2, VolumeX } from 'lucide-react';
import { useParams } from 'react-router-dom';

type ShareInfo = {
    file_name: string;
    file_type: 'video' | 'audio' | 'image' | 'text' | 'document';
    file_size: number;
    mime_type?: string | null;
    password_required: boolean;
    allow_download: boolean;
    expires_at?: string | null;
    view_limit?: number | null;
    views_remaining?: number | null;
};

type CollectionItem = { id:number; file_name:string; file_type:ShareInfo['file_type']; file_size:number; mime_type?:string|null; duration?:number|null; stream_url:string };
type CollectionInfo = {
    resource_type:'folder'|'pack'|'playlist'; title:string; password_required:boolean; unlocked:boolean;
    allow_download:boolean; expires_at?:string|null; view_limit?:number|null; views_remaining?:number|null; items:CollectionItem[];
};

function humanSize(value: number) {
    if (!value) return 'بدون حجم';
    const units = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
    let size = value;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
    return `${size.toLocaleString('fa-IR', { maximumFractionDigits: unit ? 1 : 0 })} ${units[unit]}`;
}

export default function PublicSharePage() {
    const { publicHash = '' } = useParams();
    const [info, setInfo] = useState<ShareInfo | CollectionInfo | null>(null);
    const [collection, setCollection] = useState(false);
    const [password, setPassword] = useState('');
    const [accessToken, setAccessToken] = useState('');
    const [loading, setLoading] = useState(true);
    const [unlocking, setUnlocking] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        let active = true;
        setLoading(true);
        fetch(`/api/stream/s/${encodeURIComponent(publicHash)}/info`)
            .then(async response => {
                const data = await response.json().catch(() => ({}));
                if (response.ok) return {data,collection:false};
                const fallback=await fetch(`/api/shares/public/${encodeURIComponent(publicHash)}`);
                const fallbackData=await fallback.json().catch(() => ({}));
                if(!fallback.ok) throw new Error(fallbackData.detail || data.detail || 'این پیوند در دسترس نیست.');
                return {data:fallbackData,collection:true};
            })
            .then(result=>{if(active){setInfo(result.data);setCollection(result.collection)}})
            .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'این پیوند در دسترس نیست.'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [publicHash]);

    const unlocked = Boolean(info && (!info.password_required || accessToken || (collection && (info as CollectionInfo).unlocked)));
    const streamUrl = useMemo(() => {
        const params = new URLSearchParams();
        if (accessToken) params.set('access_token', accessToken);
        const query = params.toString();
        return `/api/stream/s/${encodeURIComponent(publicHash)}${query ? `?${query}` : ''}`;
    }, [accessToken, publicHash]);

    const unlock = async (event: FormEvent) => {
        event.preventDefault();
        setUnlocking(true); setError('');
        try {
            const response = await fetch(collection?`/api/shares/public/${encodeURIComponent(publicHash)}/unlock`:`/api/stream/s/${encodeURIComponent(publicHash)}/unlock`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || 'باز کردن پیوند انجام نشد.');
            setAccessToken(data.access_token);
            if(collection){
                const refreshed=await fetch(`/api/shares/public/${encodeURIComponent(publicHash)}?access_token=${encodeURIComponent(data.access_token)}`);
                const refreshedData=await refreshed.json();
                if(!refreshed.ok)throw new Error(refreshedData.detail||'دریافت محتوا انجام نشد.');
                setInfo(refreshedData);
            }
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'باز کردن پیوند انجام نشد.');
        } finally { setUnlocking(false); }
    };

    if (loading) return <PublicShell><Loader2 className="h-8 w-8 animate-spin text-primary-300"/><p>دارم فایل رو آماده می‌کنم…</p></PublicShell>;
    if (!info) return <PublicShell><LockKeyhole className="h-10 w-10 text-red-300"/><h1 className="text-xl font-black">پیوند در دسترس نیست</h1><p className="max-w-sm text-center text-sm text-dark-400">{error || 'ممکنه پیوند لغو شده یا زمانش تموم شده باشه.'}</p></PublicShell>;

    if(collection) return <CollectionShare info={info as CollectionInfo} unlocked={unlocked} password={password} setPassword={setPassword} unlock={unlock} unlocking={unlocking} error={error}/>;

    const fileInfo=info as ShareInfo;
    return <main dir="rtl" className="min-h-dvh bg-dark-950 px-4 py-8 text-white sm:py-12">
        <section className="mx-auto w-full max-w-3xl overflow-hidden rounded-[2rem] border border-white/[.08] bg-dark-900/90 shadow-2xl">
            <header className="border-b border-white/[.07] p-5 sm:p-7">
                <div className="flex items-start gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-500/15 text-primary-200"><ShieldCheck className="h-6 w-6"/></span><div className="min-w-0"><p className="text-xs text-primary-300">پیوند امن کمد</p><h1 dir="auto" className="mt-1 break-words text-xl font-black sm:text-2xl">{fileInfo.file_name}</h1><p className="mt-2 text-xs text-dark-400">{humanSize(fileInfo.file_size)}{fileInfo.expires_at ? ` · معتبر تا ${new Date(fileInfo.expires_at).toLocaleString('fa-IR')}` : ''}</p></div></div>
            </header>
            <div className="p-4 sm:p-7">
                {!unlocked ? <form onSubmit={unlock} className="mx-auto max-w-sm rounded-3xl bg-white/[.035] p-5 text-center"><KeyRound className="mx-auto h-8 w-8 text-primary-300"/><h2 className="mt-3 font-bold">این فایل رمز داره</h2><p className="mt-1 text-xs text-dark-400">رمزی که فرستنده داده رو وارد کن.</p><input autoFocus type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="رمز پیوند" className="input mt-4 w-full text-right"/><button disabled={!password || unlocking} className="btn-primary mt-3 flex min-h-11 w-full items-center justify-center gap-2 disabled:opacity-50">{unlocking && <Loader2 className="h-4 w-4 animate-spin"/>}باز کردن فایل</button></form> : <MediaPreview info={fileInfo} streamUrl={streamUrl}/>}
                {error && <p className="mt-4 rounded-2xl bg-red-500/10 px-4 py-3 text-center text-sm text-red-200">{error}</p>}
                {unlocked && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{fileInfo.allow_download && <a className="btn-primary flex min-h-11 items-center gap-2 px-5" href={`${streamUrl}${streamUrl.includes('?') ? '&' : '?'}download=1`}><Download className="h-4 w-4"/>دانلود فایل</a>}<span className="rounded-xl bg-white/[.04] px-3 py-2 text-xs text-dark-400">{fileInfo.views_remaining == null ? 'بدون محدودیت مشاهده' : `${fileInfo.views_remaining.toLocaleString('fa-IR')} مشاهده باقی مونده`}</span></div>}
            </div>
        </section>
    </main>;
}

function CollectionShare({info,unlocked,password,setPassword,unlock,unlocking,error}:{info:CollectionInfo;unlocked:boolean;password:string;setPassword:(v:string)=>void;unlock:(e:FormEvent)=>void;unlocking:boolean;error:string}){
    const labels={folder:'پوشه',pack:'جعبه',playlist:'پلی‌لیست'};
    return <main dir="rtl" className="min-h-dvh bg-dark-950 px-3 py-6 text-white sm:px-5 sm:py-10"><section className="mx-auto max-w-5xl"><header className="rounded-[2rem] border border-white/[.08] bg-gradient-to-bl from-primary-500/[.15] to-dark-900 p-5 sm:p-7"><p className="text-xs font-bold text-primary-300">{labels[info.resource_type]} عمومی کمد</p><h1 dir="auto" className="mt-2 break-words text-2xl font-black sm:text-4xl">{info.title}</h1><p className="mt-3 text-xs text-dark-400">{unlocked?`${info.items.length.toLocaleString('fa-IR')} فایل قابل مشاهده`:'برای دیدن محتوا رمز را وارد کن.'}</p></header>{!unlocked?<form onSubmit={unlock} className="mx-auto mt-6 max-w-sm rounded-3xl border border-white/[.07] bg-dark-900 p-5 text-center"><KeyRound className="mx-auto h-8 w-8 text-primary-300"/><input autoFocus type="password" value={password} onChange={e=>setPassword(e.target.value)} className="input mt-4 w-full" placeholder="رمز پیوند"/><button disabled={!password||unlocking} className="btn-primary mt-3 min-h-11 w-full disabled:opacity-50">{unlocking?'در حال باز کردن…':'باز کردن مجموعه'}</button></form>:<div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{info.items.map(item=><article key={item.id} className="overflow-hidden rounded-3xl border border-white/[.07] bg-dark-900/85 p-3"><MediaPreview info={{...item,password_required:false,allow_download:info.allow_download}} streamUrl={item.stream_url}/><div className="mt-3 flex items-center gap-2"><strong dir="auto" className="min-w-0 flex-1 truncate text-sm">{item.file_name}</strong>{info.allow_download&&<a title="دانلود" className="btn-icon shrink-0" href={`${item.stream_url}?download=1`}><Download className="h-4 w-4"/></a>}</div><small className="text-dark-500">{humanSize(item.file_size)}</small></article>)}</div>}{error&&<p className="mx-auto mt-4 max-w-md rounded-2xl bg-red-500/10 p-3 text-center text-sm text-red-200">{error}</p>}</section></main>;
}

function MediaPreview({ info, streamUrl }: { info: ShareInfo; streamUrl: string }) {
    if (info.file_type === 'video' || info.file_type === 'audio') return <PublicMediaPlayer info={info} streamUrl={streamUrl}/>;
    if (info.file_type === 'image') return <img className="mx-auto max-h-[70dvh] max-w-full rounded-3xl object-contain" src={streamUrl} alt={info.file_name}/>;
    if (info.file_type === 'text') return <iframe title={info.file_name} className="h-[60dvh] w-full rounded-3xl border-0 bg-white" src={streamUrl}/>;
    return <div className="rounded-3xl bg-white/[.035] p-10 text-center"><FileText className="mx-auto h-16 w-16 text-primary-200"/><p className="mt-4 text-sm text-dark-300">این فایل پیش‌نمایش مستقیم نداره؛ می‌تونی دانلودش کنی.</p></div>;
}

function PublicMediaPlayer({info,streamUrl}:{info:ShareInfo;streamUrl:string}){
    const mediaRef=useRef<HTMLMediaElement|null>(null),frameRef=useRef<HTMLDivElement|null>(null);
    const [playing,setPlaying]=useState(false),[current,setCurrent]=useState(0),[duration,setDuration]=useState(0),[muted,setMuted]=useState(false),[speed,setSpeed]=useState(1),[loop,setLoop]=useState(false),[speedOpen,setSpeedOpen]=useState(false);
    const video=info.file_type==='video';
    const seek=(delta:number)=>{const media=mediaRef.current;if(media)media.currentTime=Math.max(0,Math.min(duration||Infinity,media.currentTime+delta))};
    const setPlaybackSpeed=(value:number)=>{setSpeed(value);setSpeedOpen(false);if(mediaRef.current)mediaRef.current.playbackRate=value};
    const mediaProps={src:streamUrl,preload:'metadata' as const,loop,onTimeUpdate:(event:React.SyntheticEvent<HTMLMediaElement>)=>setCurrent(event.currentTarget.currentTime),onLoadedMetadata:(event:React.SyntheticEvent<HTMLMediaElement>)=>{setDuration(Number.isFinite(event.currentTarget.duration)?event.currentTarget.duration:0);event.currentTarget.playbackRate=speed},onPlay:()=>setPlaying(true),onPause:()=>setPlaying(false),onEnded:()=>setPlaying(false)};
    return <div ref={frameRef} className="video-player relative mx-auto aspect-video w-full overflow-hidden rounded-3xl border border-white/10 bg-black shadow-2xl" data-embedded="true" data-media-kind={video?'video':'audio'}>{video?<video {...mediaProps} ref={node=>{mediaRef.current=node}} className="h-full w-full object-contain" playsInline/>:<><div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-primary-500/20 via-dark-950 to-fuchsia-950"><span className="flex h-28 w-28 items-center justify-center rounded-3xl bg-white/[.06] text-6xl shadow-2xl">🎵</span><strong dir="auto" className="mt-4 max-w-[80%] truncate">{info.file_name}</strong></div><audio {...mediaProps} ref={node=>{mediaRef.current=node}} className="hidden"/></>}<div dir="ltr" className="absolute inset-x-3 bottom-3 z-10 rounded-2xl border border-white/10 bg-black/55 p-3 shadow-xl backdrop-blur-xl"><div className="flex items-center gap-2"><span className="w-10 text-[10px] tabular-nums text-white/70">{Math.floor(current/60)}:{Math.floor(current%60).toString().padStart(2,'0')}</span><input type="range" min="0" max={duration||0} value={Math.min(current,duration||0)} onChange={event=>{if(mediaRef.current)mediaRef.current.currentTime=Number(event.target.value)}} className="h-1 min-w-0 flex-1 accent-primary-500"/><span className="w-10 text-[10px] tabular-nums text-white/70">{Math.floor(duration/60)}:{Math.floor(duration%60).toString().padStart(2,'0')}</span></div><div className="mt-2 flex items-center justify-center gap-1 sm:gap-2"><button onClick={()=>seek(-10)} className="btn-icon h-9 w-9" title="۱۰ ثانیه عقب"><RotateCcw className="h-4 w-4"/></button><button onClick={()=>{const media=mediaRef.current;if(media)media.paused?void media.play():media.pause()}} className="flex h-11 w-11 items-center justify-center rounded-full bg-primary-500 text-white shadow-lg">{playing?<Pause className="h-5 w-5"/>:<Play className="h-5 w-5 fill-current"/>}</button><button onClick={()=>seek(10)} className="btn-icon h-9 w-9" title="۱۰ ثانیه جلو"><RotateCw className="h-4 w-4"/></button><button onClick={()=>{const media=mediaRef.current;if(media){media.muted=!media.muted;setMuted(media.muted)}}} className="btn-icon h-9 w-9" title={muted?'وصل کردن صدا':'قطع صدا'}>{muted?<VolumeX className="h-4 w-4"/>:<Volume2 className="h-4 w-4"/>}</button><button onClick={()=>setLoop(value=>!value)} className={`btn-icon h-9 w-9 ${loop?'bg-primary-500/25 text-primary-200':''}`} title={loop?'تکرار روشن':'تکرار خاموش'}><Repeat2 className="h-4 w-4"/></button><div className="relative"><button onClick={()=>setSpeedOpen(value=>!value)} className="btn-icon h-9 w-9" title="سرعت پخش"><Gauge className="h-4 w-4"/></button>{speedOpen&&<div className="absolute bottom-11 left-1/2 grid w-36 -translate-x-1/2 grid-cols-3 gap-1 rounded-xl border border-white/10 bg-black/90 p-1 shadow-2xl">{[.5,.75,1,1.25,1.5,2].map(value=><button key={value} onClick={()=>setPlaybackSpeed(value)} className={`rounded-lg p-1.5 text-[10px] ${speed===value?'bg-primary-500 text-white':'hover:bg-white/10'}`}>{value}×</button>)}</div>}</div>{video&&document.pictureInPictureEnabled&&<button onClick={()=>{const element=mediaRef.current as HTMLVideoElement;if(document.pictureInPictureElement)void document.exitPictureInPicture();else void element.requestPictureInPicture?.()}} className="btn-icon h-9 w-9" title="تصویر در تصویر"><PictureInPicture2 className="h-4 w-4"/></button>}<button onClick={()=>void frameRef.current?.requestFullscreen()} className="btn-icon h-9 w-9" title="تمام‌صفحه"><Maximize className="h-4 w-4"/></button></div></div></div>;
}

function PublicShell({ children }: { children: React.ReactNode }) {
    return <main dir="rtl" className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-dark-950 px-5 text-white">{children}</main>;
}
