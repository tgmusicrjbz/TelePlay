import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarClock, Download, FileText, Film, Gauge, HardDrive, KeyRound, Loader2, LockKeyhole, Maximize, Minimize, Music2, Pause, PictureInPicture2, Play, Repeat2, RotateCcw, RotateCw, ShieldCheck, UnlockKeyhole, Volume2, VolumeX } from 'lucide-react';
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
    stream_url?: string;
    download_url?: string;
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
    const { publicHash = '', playToken = '' } = useParams();
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
        if(playToken){fetch(`/api/shares/link-info/${encodeURIComponent(playToken)}`).then(async response=>{const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.detail||'این پیوند در دسترس نیست.');return {data,collection:false}}).then(result=>{if(active){setInfo(result.data);setCollection(false)}}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'این پیوند در دسترس نیست.')}).finally(()=>{if(active)setLoading(false)});return()=>{active=false}}
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
    }, [playToken, publicHash]);

    const unlocked = Boolean(info && (!info.password_required || accessToken || (collection && (info as CollectionInfo).unlocked)));
    const streamUrl = useMemo(() => {
        const params = new URLSearchParams();
        if (accessToken) params.set('access_token', accessToken);
        const query = params.toString();
        if(info&&!collection&&(info as ShareInfo).stream_url)return (info as ShareInfo).stream_url!;
        return `/api/stream/s/${encodeURIComponent(publicHash)}${query ? `?${query}` : ''}`;
    }, [accessToken, collection, info, publicHash]);

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
    const downloadUrl=fileInfo.download_url||`${streamUrl}${streamUrl.includes('?') ? '&' : '?'}download=1`;
    const kindLabel=fileInfo.file_type==='video'?'ویدیو':fileInfo.file_type==='audio'?'صدا':fileInfo.file_type==='image'?'تصویر':'فایل';
    const KindIcon=fileInfo.file_type==='video'?Film:fileInfo.file_type==='audio'?Music2:FileText;
    return <main dir="rtl" className="min-h-dvh bg-[radial-gradient(circle_at_top,#25102d_0%,#09090b_45%,#000_100%)] px-3 py-4 text-white sm:px-5 sm:py-8">
        <section className="mx-auto w-full max-w-4xl rounded-[1.75rem] border border-white/[.09] bg-black/55 p-3 shadow-2xl backdrop-blur-xl sm:p-5">
            {!unlocked ? <form onSubmit={unlock} className="mx-auto my-10 max-w-sm rounded-3xl border border-white/[.08] bg-white/[.035] p-5 text-center"><KeyRound className="mx-auto h-8 w-8 text-primary-300"/><h2 className="mt-3 font-bold">این فایل رمز دارد</h2><input autoFocus type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="رمز پیوند" className="input mt-4 w-full text-right"/><button disabled={!password || unlocking} className="btn-primary mt-3 flex min-h-11 w-full items-center justify-center gap-2 disabled:opacity-50">{unlocking && <Loader2 className="h-4 w-4 animate-spin"/>}باز کردن فایل</button></form> : <><header className="mb-3 rounded-2xl border border-white/[.07] bg-white/[.035] p-3 sm:p-4"><div className="flex min-w-0 items-center gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-500/15 text-primary-200"><KindIcon className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h1 dir="auto" title={fileInfo.file_name} className="truncate text-sm font-black sm:text-base">{fileInfo.file_name}</h1><div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-dark-300"><span className="flex items-center gap-1 rounded-lg bg-white/[.05] px-2 py-1"><ShieldCheck className="h-3 w-3 text-emerald-300"/>{kindLabel}</span><span className="flex items-center gap-1 rounded-lg bg-white/[.05] px-2 py-1"><HardDrive className="h-3 w-3 text-sky-300"/>{humanSize(fileInfo.file_size)}</span>{fileInfo.expires_at&&<span className="flex items-center gap-1 rounded-lg bg-white/[.05] px-2 py-1"><CalendarClock className="h-3 w-3 text-amber-300"/>{new Date(fileInfo.expires_at).toLocaleDateString('fa-IR')}</span>}{fileInfo.views_remaining!=null&&<span className="rounded-lg bg-white/[.05] px-2 py-1">👁️ {fileInfo.views_remaining.toLocaleString('fa-IR')} بازدید</span>}</div></div>{fileInfo.allow_download&&<a className="flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-primary-500 px-3 text-xs font-bold text-white shadow-lg shadow-primary-950/30 sm:px-4" href={downloadUrl}><Download className="h-4 w-4"/><span>دانلود فایل</span></a>}</div></header><MediaPreview info={fileInfo} streamUrl={streamUrl}/></>}
            {error && <p className="mt-4 rounded-2xl bg-red-500/10 px-4 py-3 text-center text-sm text-red-200">{error}</p>}
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
    const [playing,setPlaying]=useState(false),[current,setCurrent]=useState(0),[duration,setDuration]=useState(0);
    const [muted,setMuted]=useState(false),[volume,setVolume]=useState(1),[speed,setSpeed]=useState(1),[loop,setLoop]=useState(false);
    const [controls,setControls]=useState(true),[locked,setLocked]=useState(false),[isFullscreen,setIsFullscreen]=useState(false);
    const [speedOpen,setSpeedOpen]=useState(false),[volumeOpen,setVolumeOpen]=useState(false);
    const video=info.file_type==='video';
    const safeDuration=Number.isFinite(duration)?Math.max(0,duration):0;
    const safeCurrent=Number.isFinite(current)?Math.max(0,Math.min(current,safeDuration||current)):0;
    const progress=safeDuration?Math.min(100,(safeCurrent/safeDuration)*100):0;
    const formatTime=(seconds:number)=>{const value=Math.max(0,Math.floor(Number.isFinite(seconds)?seconds:0)),hours=Math.floor(value/3600),minutes=Math.floor((value%3600)/60),secs=value%60;return hours?`${hours}:${String(minutes).padStart(2,'0')}:${String(secs).padStart(2,'0')}`:`${minutes}:${String(secs).padStart(2,'0')}`};
    const reveal=()=>{if(!locked)setControls(true)};
    const seek=(delta:number)=>{const media=mediaRef.current;if(!media)return;media.currentTime=Math.max(0,Math.min(safeDuration||Infinity,media.currentTime+delta));reveal()};
    const toggle=()=>{const media=mediaRef.current;if(!media)return;media.paused?void media.play():media.pause();reveal()};
    const setPlaybackSpeed=(value:number)=>{setSpeed(value);setSpeedOpen(false);if(mediaRef.current)mediaRef.current.playbackRate=value};
    const toggleMute=()=>{const media=mediaRef.current;if(!media)return;media.muted=!media.muted;setMuted(media.muted)};
    const changeVolume=(value:number)=>{const media=mediaRef.current;if(!media)return;media.volume=value;media.muted=value===0;setVolume(value);setMuted(value===0)};
    const togglePiP=async()=>{if(!video)return;const element=mediaRef.current as HTMLVideoElement|null;try{if(document.pictureInPictureElement)await document.exitPictureInPicture();else await element?.requestPictureInPicture?.()}catch{/* unsupported */}};
    const toggleFullscreen=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await frameRef.current?.requestFullscreen()}catch{/* browser keeps inline mode */}};
    useEffect(()=>{const sync=()=>setIsFullscreen(document.fullscreenElement===frameRef.current);document.addEventListener('fullscreenchange',sync);return()=>document.removeEventListener('fullscreenchange',sync)},[]);
    useEffect(()=>{if(!playing||!controls||speedOpen||volumeOpen||locked)return;const timer=window.setTimeout(()=>setControls(false),2800);return()=>window.clearTimeout(timer)},[playing,controls,speedOpen,volumeOpen,locked]);
    const mediaProps={src:streamUrl,preload:'metadata' as const,loop,onTimeUpdate:(event:React.SyntheticEvent<HTMLMediaElement>)=>setCurrent(event.currentTarget.currentTime),onLoadedMetadata:(event:React.SyntheticEvent<HTMLMediaElement>)=>{setDuration(Number.isFinite(event.currentTarget.duration)?event.currentTarget.duration:0);event.currentTarget.playbackRate=speed},onPlay:()=>{setPlaying(true);setControls(true)},onPause:()=>{setPlaying(false);setControls(true)},onEnded:()=>setPlaying(false)};
    return <div ref={frameRef} onPointerMove={reveal} onPointerUp={()=>{if(!controls)reveal()}} onDoubleClick={()=>void toggleFullscreen()} className={`video-player relative mx-auto w-full overflow-hidden bg-black shadow-2xl ${isFullscreen?'h-[100dvh] rounded-none border-0':'h-[min(68dvh,34rem)] min-h-[24rem] rounded-[1.6rem] border border-white/10 sm:aspect-video sm:h-auto sm:min-h-0'}`} data-embedded="true" data-media-kind={video?'video':'audio'} data-public-player="true">
        <div className="absolute inset-0 flex items-center justify-center bg-black">
            {video?<video {...mediaProps} ref={node=>{mediaRef.current=node}} className="h-full w-full object-contain" playsInline/>:<><div className="absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br from-primary-500/20 via-dark-950 to-fuchsia-950"><span className="flex h-28 w-28 items-center justify-center rounded-[2rem] border border-white/10 bg-white/[.06] text-6xl shadow-2xl">🎵</span><strong dir="auto" className="mt-4 max-w-[75%] truncate text-sm">{info.file_name}</strong></div><audio {...mediaProps} ref={node=>{mediaRef.current=node}} className="hidden"/></>}
        </div>
        {locked&&<button onClick={()=>{setLocked(false);setControls(true)}} className="absolute left-3 top-3 z-[70] flex h-11 w-11 items-center justify-center rounded-2xl border border-white/15 bg-black/65 text-white shadow-2xl backdrop-blur-xl" title="باز کردن کنترل‌ها"><UnlockKeyhole className="h-5 w-5"/></button>}
        {!locked&&<div className={`absolute inset-0 z-20 transition-opacity duration-300 ${controls?'opacity-100':'pointer-events-none opacity-0'}`}>
            <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/80 to-transparent"/>
            <h2 dir="auto" title={info.file_name} className="absolute left-4 right-4 top-3 z-30 truncate text-center text-xs font-semibold text-white/90 sm:text-sm">{info.file_name}</h2>
            <div data-player-tools onPointerUp={event=>event.stopPropagation()} className="absolute left-1/2 top-11 z-50 flex w-max max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-0.5 rounded-2xl border border-white/10 bg-black/55 p-1 shadow-2xl backdrop-blur-xl sm:top-14 sm:gap-1">
                <button onClick={()=>{setLoop(value=>!value);setSpeedOpen(false);setVolumeOpen(false)}} className={`rounded-xl p-2 ${loop?'bg-primary-500/25 text-primary-200':'text-white/80 hover:bg-white/10'}`} title="تکرار"><Repeat2 className="h-4 w-4 sm:h-5 sm:w-5"/></button>
                <div className="relative"><button onClick={()=>{setSpeedOpen(value=>!value);setVolumeOpen(false)}} className={`flex items-center gap-1 rounded-xl p-2 text-white/80 hover:bg-white/10 ${speed!==1?'bg-primary-500/20 text-primary-200':''}`} title="سرعت پخش"><Gauge className="h-4 w-4 sm:h-5 sm:w-5"/><span className="text-[10px]">{speed}×</span></button>{speedOpen&&<div dir="ltr" className="absolute left-1/2 top-[calc(100%+.5rem)] z-[90] grid w-44 -translate-x-1/2 grid-cols-3 gap-1 rounded-2xl border border-primary-400/25 bg-black/95 p-1.5 shadow-2xl backdrop-blur-2xl">{[.5,.75,1,1.25,1.5,2].map(value=><button key={value} onClick={()=>setPlaybackSpeed(value)} className={`rounded-lg px-2 py-2 text-xs ${speed===value?'bg-primary-500 text-white':'text-white/75 hover:bg-white/10'}`}>{value}×</button>)}</div>}</div>
                <div className="relative"><button onClick={()=>{setVolumeOpen(value=>!value);setSpeedOpen(false)}} className="rounded-xl p-2 text-white/80 hover:bg-white/10" title="تنظیم صدا">{muted?<VolumeX className="h-4 w-4 sm:h-5 sm:w-5"/>:<Volume2 className="h-4 w-4 sm:h-5 sm:w-5"/>}</button>{volumeOpen&&<div className="absolute left-1/2 top-[calc(100%+.5rem)] z-[90] flex w-44 -translate-x-1/2 items-center gap-2 rounded-2xl border border-white/15 bg-black/95 p-3 shadow-2xl backdrop-blur-2xl"><button onClick={toggleMute} className="rounded-lg p-1.5 text-white/80 hover:bg-white/10">{muted?<VolumeX className="h-4 w-4"/>:<Volume2 className="h-4 w-4"/>}</button><input aria-label="شدت صدا" type="range" min="0" max="1" step="0.05" value={muted?0:volume} onChange={event=>changeVolume(Number(event.target.value))} className="min-w-0 flex-1 accent-primary-500"/></div>}</div>
                {video&&document.pictureInPictureEnabled&&<button onClick={()=>{setSpeedOpen(false);setVolumeOpen(false);void togglePiP()}} className="rounded-xl p-2 text-white/80 hover:bg-white/10" title="تصویر در تصویر"><PictureInPicture2 className="h-4 w-4 sm:h-5 sm:w-5"/></button>}
                <button onClick={()=>{setLocked(true);setControls(false);setSpeedOpen(false);setVolumeOpen(false)}} className="rounded-xl p-2 text-white/80 hover:bg-white/10" title="قفل لمس"><LockKeyhole className="h-4 w-4 sm:h-5 sm:w-5"/></button>
                <button onClick={()=>void toggleFullscreen()} className="rounded-xl p-2 text-white/80 hover:bg-white/10" title={isFullscreen?'خروج از تمام‌صفحه':'تمام‌صفحه'}>{isFullscreen?<Minimize className="h-4 w-4 sm:h-5 sm:w-5"/>:<Maximize className="h-4 w-4 sm:h-5 sm:w-5"/>}</button>
            </div>
            <div data-player-transport onPointerUp={event=>event.stopPropagation()} dir="ltr" className="absolute left-1/2 top-1/2 z-40 flex -translate-x-1/2 -translate-y-1/2 items-center gap-3 sm:gap-7"><button onClick={()=>seek(-10)} className="rounded-full bg-black/25 p-3 text-white/80 backdrop-blur-md hover:bg-white/10" title="۱۰ ثانیه عقب"><RotateCcw className="h-6 w-6"/></button><button onClick={toggle} className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-500 text-white shadow-[0_0_45px_rgba(236,72,153,.42)] transition active:scale-95 sm:h-20 sm:w-20">{playing?<Pause className="h-7 w-7 fill-current sm:h-9 sm:w-9"/>:<Play className="ml-1 h-7 w-7 fill-current sm:h-9 sm:w-9"/>}</button><button onClick={()=>seek(10)} className="rounded-full bg-black/25 p-3 text-white/80 backdrop-blur-md hover:bg-white/10" title="۱۰ ثانیه جلو"><RotateCw className="h-6 w-6"/></button></div>
            <div data-player-bottom onPointerUp={event=>event.stopPropagation()} dir="ltr" className="absolute bottom-2 left-2 right-2 z-50 rounded-2xl border border-white/10 bg-black/45 px-3 py-3 shadow-2xl backdrop-blur-xl sm:bottom-4 sm:left-5 sm:right-5 sm:px-4"><div className="flex items-center gap-2.5 sm:gap-4"><span className="font-player min-w-[42px] text-center text-[11px] font-semibold text-white/85">{formatTime(safeCurrent)}</span><div className="relative h-2 min-w-0 flex-1 rounded-full bg-white/15"><div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary-600 via-primary-500 to-primary-300 shadow-lg shadow-primary-500/30" style={{width:`${progress}%`}}/>{safeDuration>0&&<span className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow" style={{left:`clamp(6px, ${progress}%, calc(100% - 6px))`}}/>}<input aria-label="موقعیت پخش" type="range" min="0" max={safeDuration||0} value={safeCurrent} onChange={event=>{if(mediaRef.current){mediaRef.current.currentTime=Number(event.target.value);setCurrent(Number(event.target.value))}}} className="absolute inset-0 h-full w-full cursor-pointer opacity-0"/></div><span className="font-player min-w-[42px] text-center text-[11px] font-semibold text-white/85">{formatTime(safeDuration)}</span></div></div>
        </div>}
    </div>;
}
function PublicShell({ children }: { children: React.ReactNode }) {
    return <main dir="rtl" className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-dark-950 px-5 text-white">{children}</main>;
}
