/**
 * MediaPlayer - full screen video/audio player
 */
import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { X, Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward, Download, AlertTriangle, ArrowUpDown, Copy, PictureInPicture2, Gauge, ChevronDown, ChevronUp, Repeat2, Shuffle, Headphones, RotateCcw, RotateCw, Clock3, ListPlus, ListMusic, GripVertical, Trash2, RectangleHorizontal, Smartphone, MonitorSmartphone, Film, LockKeyhole, UnlockKeyhole, MoreHorizontal, Save, History, EyeOff, StopCircle } from 'lucide-react';
import { TelegramFile, useUpdateProgress, useFile, api, useCreatePlaylist, useAddPlaylistItems } from '../lib/api';
import { useAppStore } from '../lib/store';
import { closestCenter, DndContext, DragEndEvent, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { getOfflineMedia } from '../lib/offline';

const PLAYBACK_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4] as const;
const playbackSpeedLabel = (speed: number) => `${speed === 1 ? '1.0' : speed}x`;

export default function MediaPlayer() {
    const { previewFile: file, setPreviewFile, isPlayerMinimized, setPlayerMinimized, clearQueue } = useAppStore();

    if (!file || (file.file_type !== 'video' && file.file_type !== 'audio')) return null;

    return <MediaPlayerContent file={file} onClose={() => { sessionStorage.removeItem('komod-pack-preview-origin'); setPreviewFile(null); clearQueue(); }} isMinimized={isPlayerMinimized} setMinimized={setPlayerMinimized} />;
}

interface MediaPlayerContentProps {
    file: TelegramFile;
    onClose: () => void;
    isMinimized: boolean;
    setMinimized: (minimized: boolean) => void;
    inline?: boolean;
    inlineExpanded?: boolean;
}

export function InlineMediaPlayer({ file, expanded = false }: { file: TelegramFile; expanded?: boolean }) {
    return <MediaPlayerContent file={file} onClose={() => undefined} isMinimized={false} setMinimized={() => undefined} inline inlineExpanded={expanded} />;
}

function MediaPlayerContent({ file, onClose, isMinimized, setMinimized, inline = false, inlineExpanded = false }: MediaPlayerContentProps) {
    const { playQueue, queueIndex, repeatMode, playNext, playPrevious, shuffleQueue, reverseQueue, removeQueueItem, moveQueueItem, appendQueueItems, setRepeatMode, setPlaylistFile, addToast } = useAppStore();
    const videoRef = useRef<HTMLVideoElement>(null);
    const nextAudioRef = useRef<HTMLAudioElement>(null);
    const crossfadeCarry = useRef<{fileId:number;time:number}|null>(null);
    const crossfadeStarted = useRef(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const compactInline = inline && !inlineExpanded && !isFullscreen;
    const [playbackSpeed, setPlaybackSpeed] = useState(() => {
        const saved = Number(localStorage.getItem('komod-playback-speed') || 1);
        return PLAYBACK_SPEEDS.includes(saved as typeof PLAYBACK_SPEEDS[number]) ? saved : 1;
    });
    const [isPiP, setIsPiP] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [streamRetry, setStreamRetry] = useState(0);
    // Every queue occurrence receives a persistent id in the store. Deriving the
    // dnd id from its array index made dnd-kit see a new item after every move,
    // which visually snapped the row back to its old position.
    const queueRows = useMemo(() => playQueue.map((item, index) => ({
        item,
        index,
        id: (item as TelegramFile & { _queueEntryId?: string })._queueEntryId || `queue-${item.id}-${index}`,
    })), [playQueue]);
    const hideControlsTimeout = useRef<ReturnType<typeof setTimeout>>();
    const singleTapTimeout = useRef<ReturnType<typeof setTimeout>>();
    const feedbackTimeout = useRef<ReturnType<typeof setTimeout>>();
    const backgroundPlaybackRequested = useRef(false);
    const lastTap = useRef<{ at: number; side: 'left' | 'right' } | null>(null);
    const [publicUrl, setPublicUrl] = useState<string | null>(null);
    const [showSpeedMenu, setShowSpeedMenu] = useState(false);
    const [showVolumePopover, setShowVolumePopover] = useState(false);
    const [showSleepMenu, setShowSleepMenu] = useState(false);
    const [sleepMode, setSleepMode] = useState<'off' | '15' | '30' | '45' | '60' | 'track' | 'end'>('off');
    const sleepTimeout = useRef<ReturnType<typeof setTimeout>>();
    const [audioOnly, setAudioOnly] = useState(false);
    const [videoHidden, setVideoHidden] = useState(false);
    const [audioVariantUrl, setAudioVariantUrl] = useState<string|null>(file.audio_stream_url || null);
    const [preparingAudio, setPreparingAudio] = useState(false);
    const [compatibleVideoUrl, setCompatibleVideoUrl] = useState<string|null>(file.compatible_video_stream_url || null);
    const [compatibilityMessage, setCompatibilityMessage] = useState<string|null>(null);
    const [compatibilityProgress, setCompatibilityProgress] = useState(0);
    const compatibilityAttempted = useRef(false);
    const audioSwitchPosition = useRef<number|null>(null);
    const [videoOrientation, setVideoOrientation] = useState<'auto' | 'portrait' | 'landscape'>('auto');
    const [controlsLocked, setControlsLocked] = useState(false);
    const [skipFeedback, setSkipFeedback] = useState<'backward' | 'forward' | null>(null);
    const [thumbnailFailed, setThumbnailFailed] = useState(false);
    const [showQueue, setShowQueue] = useState(false);
    const [showHistory, setShowHistory] = useState(false);
    const [historyItems, setHistoryItems] = useState<TelegramFile[]>([]);
    const [queueName, setQueueName] = useState('');
    const [showQueueSave, setShowQueueSave] = useState(false);
    const [recommendations, setRecommendations] = useState<TelegramFile[]>([]);
    const [showRecommendations, setShowRecommendations] = useState(false);
    const crossfadeSeconds = useMemo(()=>Math.max(0,Math.min(6,Number(localStorage.getItem('komod-crossfade-seconds')||0))),[]);
    const createPlaylist = useCreatePlaylist();
    const addPlaylistItems = useAddPlaylistItems();
    const [showVideoMoreMenu, setShowVideoMoreMenu] = useState(false);
    const [activeQueueId, setActiveQueueId] = useState<string | null>(null);
    const [offlineStreamUrl,setOfflineStreamUrl]=useState<string|null>(null);
    const [stopAfterCurrent,setStopAfterCurrent]=useState(()=>localStorage.getItem('komod-stop-after-current')==='1');
    useEffect(()=>{if(stopAfterCurrent)localStorage.setItem('komod-stop-after-current','1');else localStorage.removeItem('komod-stop-after-current')},[stopAfterCurrent]);
    const queueDropTargetRef = useRef<string | null>(null);
    const queueSensors = useSensors(
        useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
        useSensor(TouchSensor, { activationConstraint: { distance: 4 } }),
        useSensor(KeyboardSensor, {coordinateGetter:sortableKeyboardCoordinates}),
    );
    const formatPlayerTime = (seconds: number) => {
        const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
        const hours = Math.floor(safe / 3600);
        const minutes = Math.floor((safe % 3600) / 60);
        const secs = safe % 60;
        return hours > 0 ? `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}` : `${minutes}:${secs.toString().padStart(2, '0')}`;
    };
    const formatPersianMetaTime = (seconds: number) => formatPlayerTime(seconds).replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);

    useEffect(() => setThumbnailFailed(false), [file.id]);
    useEffect(() => {
        const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
        document.addEventListener('fullscreenchange', syncFullscreen);
        return () => document.removeEventListener('fullscreenchange', syncFullscreen);
    }, []);
    useEffect(()=>{setAudioOnly(false);setVideoHidden(false);setAudioVariantUrl(file.audio_stream_url||null);setCompatibleVideoUrl(file.compatible_video_stream_url||null);setCompatibilityMessage(null);setCompatibilityProgress(0);compatibilityAttempted.current=false;},[file.id,file.audio_stream_url,file.compatible_video_stream_url]);
    useEffect(()=>{
        let disposed=false; let objectUrl:string|null=null;
        setOfflineStreamUrl(null);
        if(!file.stream_url.startsWith('blob:'))void getOfflineMedia(file.id).then(record=>{if(!record||disposed)return;objectUrl=URL.createObjectURL(record.blob);setOfflineStreamUrl(objectUrl)}).catch(()=>undefined);
        return()=>{disposed=true;if(objectUrl)URL.revokeObjectURL(objectUrl)};
    },[file.id,file.stream_url]);

    // Fetch fresh file details to get latest progress
    const { data: extendedFile } = useFile(file.id);
    const { mutate: updateProgress } = useUpdateProgress();

    const isVideo = file.file_type === 'video';
    const hasQueue = playQueue.length > 0;
    const toggleAudioOnly = async () => {
        if (preparingAudio) return;
        setShowVideoMoreMenu(false);
        audioSwitchPosition.current = videoRef.current?.currentTime || 0;
        if (audioOnly) { setAudioOnly(false); setVideoHidden(false); return; }
        if (audioVariantUrl) { setAudioOnly(true); setVideoHidden(false); return; }
        setPreparingAudio(true);
        setVideoHidden(true);
        try {
            const {data}=await api.post(`/stream/${file.id}/audio-variant`);
            setAudioVariantUrl(data.stream_url); setAudioOnly(true); setVideoHidden(false);
        } catch(error:any) {
            audioSwitchPosition.current=null;
            setVideoHidden(false);
            addToast(error?.response?.data?.detail||'ساخت نسخه صوتی انجام نشد.','error');
        } finally { setPreparingAudio(false); }
    };
    const prepareCompatibleVideo = useCallback(async () => {
        if (!isVideo || compatibilityAttempted.current || offlineStreamUrl) return;
        compatibilityAttempted.current = true;
        const resumeAt = videoRef.current?.currentTime || currentTime || 0;
        setError(null); setIsLoading(true); setCompatibilityMessage('در حال آماده‌سازی نسخه سازگار…'); setCompatibilityProgress(3);
        try {
            let {data} = await api.post<{state:string;progress:number;message:string;stream_url?:string}>(`/stream/${file.id}/compatible-video`);
            for (let attempt=0; attempt<400 && data.state!=='done' && data.state!=='error'; attempt+=1) {
                setCompatibilityMessage(data.message || 'در حال آماده‌سازی نسخه سازگار…');
                setCompatibilityProgress(Math.max(3, Math.min(96, Number(data.progress) || 0)));
                await new Promise(resolve=>window.setTimeout(resolve,3000));
                data=(await api.get<typeof data>(`/stream/${file.id}/compatible-video/status`)).data;
            }
            if (data.state!=='done'||!data.stream_url) throw new Error(data.message||'آماده‌سازی نسخه سازگار انجام نشد.');
            setCompatibleVideoUrl(data.stream_url); setCompatibilityMessage(null); setCompatibilityProgress(100); setError(null);
            window.setTimeout(()=>{if(videoRef.current){videoRef.current.currentTime=resumeAt;void videoRef.current.play().catch(()=>undefined)}},180);
        } catch(error:any) {
            compatibilityAttempted.current=false;
            setCompatibilityMessage(null); setCompatibilityProgress(0); setIsLoading(false);
            setError(error?.response?.data?.detail||error?.message||'آماده‌سازی نسخه سازگار انجام نشد.');
        }
    },[currentTime,file.id,isVideo,offlineStreamUrl]);
    const saveNamedQueue = async () => {
        const name = queueName.trim();
        if (!name || !playQueue.length) return;
        try {
            const playlist = await createPlaylist.mutateAsync({name, description:'ذخیره‌شده از صف پخش'});
            await addPlaylistItems.mutateAsync({id:playlist.id,fileIds:playQueue.map(item=>item.id),allowDuplicates:true});
            setQueueName(''); setShowQueueSave(false);
            addToast('صف پخش به‌عنوان پلی‌لیست ذخیره شد 💾');
        } catch (error:any) { addToast(error?.response?.data?.detail || 'ذخیره صف انجام نشد.', 'error'); }
    };
    const loadHistory = async () => {
        setShowHistory(value=>!value);
        if (!historyItems.length) {
            try { setHistoryItems((await api.get('/files/play-history',{params:{per_page:50}})).data.files || []); }
            catch { addToast('تاریخچه پخش بارگذاری نشد.', 'error'); }
        }
    };
    const loadRecommendations = async () => {
        setShowRecommendations(value=>!value);
        if (!recommendations.length) {
            try { setRecommendations((await api.get('/files/recommendations',{params:{after_file_id:file.id,limit:12}})).data||[]); }
            catch { addToast('پیشنهادهای پخش آماده نشد.', 'error'); }
        }
    };

    // Public links are created only from the explicit share action. Playback,
    // download and copy use the signed-in URL and never publish a file.
    useEffect(() => {
        const fileData = extendedFile || file;
        setPublicUrl(fileData.public_stream_url ? getAbsoluteUrl(fileData.public_stream_url) : null);
    }, [file.id, extendedFile]);

    // Restore progress
    useEffect(() => {
        if (videoRef.current && extendedFile?.last_pos && !currentTime) {
            if (extendedFile.last_pos < (extendedFile.duration || 0) * 0.95) {
                videoRef.current.currentTime = extendedFile.last_pos;
                setCurrentTime(extendedFile.last_pos);
            }
        }
    }, [extendedFile]);

    // Save progress periodically
    useEffect(() => {
        const interval = setInterval(() => {
            if (isPlaying && videoRef.current && !error) {
                updateProgress({
                    fileId: file.id,
                    position: Math.floor(videoRef.current.currentTime),
                    duration: videoRef.current.duration
                });
            }
        }, 10000); // Save every 10s

        return () => clearInterval(interval);
    }, [isPlaying, file.id, error, updateProgress]);

    // Save on close/pause
    const saveProgress = useCallback(() => {
        if (videoRef.current && !error) {
            updateProgress({
                fileId: file.id,
                position: Math.floor(videoRef.current.currentTime),
                duration: videoRef.current.duration
            });
        }
    }, [file.id, error, updateProgress]);

    // Save on unmount
    useEffect(() => {
        return () => saveProgress();
    }, [saveProgress]);

    const togglePlay = (e?: React.SyntheticEvent) => {
        e?.stopPropagation();
        const media = videoRef.current;
        if (media) {
            if (!media.paused) {
                backgroundPlaybackRequested.current = false;
                media.pause();
                saveProgress();
            } else {
                backgroundPlaybackRequested.current = true;
                void media.play();
            }
        }
    };

    const toggleMute = () => {
        if (videoRef.current) {
            videoRef.current.muted = !isMuted;
            setIsMuted(!isMuted);
        }
    };

    const toggleFullscreen = async () => {
        if (!document.fullscreenElement) {
            try {
                await containerRef.current?.requestFullscreen();
                setIsFullscreen(document.fullscreenElement === containerRef.current);
            } catch {
                setIsFullscreen(false);
            }
        } else {
            await document.exitFullscreen();
        }
    };

    const togglePiP = async () => {
        if (document.pictureInPictureElement) {
            await document.exitPictureInPicture();
            setIsPiP(false);
        } else if (videoRef.current) {
            await videoRef.current.requestPictureInPicture();
            setIsPiP(true);
        }
    };

    const setSpeed = (nextSpeed: number) => {
        setPlaybackSpeed(nextSpeed);
        localStorage.setItem('komod-playback-speed', String(nextSpeed));
        if (videoRef.current) {
            videoRef.current.playbackRate = nextSpeed;
        }
        setShowSpeedMenu(false);
    };

    const toggleVideoOrientation = async () => {
        const next = videoOrientation === 'auto' ? 'landscape' : videoOrientation === 'landscape' ? 'portrait' : 'auto';
        const orientation = screen.orientation as ScreenOrientation & { lock?: (value: 'landscape' | 'portrait') => Promise<void>; unlock?: () => void };
        setVideoOrientation(next);
        try {
            if (next === 'auto') {
                orientation?.unlock?.();
                return;
            }
            const telegramApp = (window as Window & { Telegram?: { WebApp?: { requestFullscreen?: () => void } } }).Telegram?.WebApp;
            try { telegramApp?.requestFullscreen?.(); } catch { /* older Telegram clients */ }
            if (!document.fullscreenElement && containerRef.current?.requestFullscreen) {
                try { await containerRef.current.requestFullscreen(); } catch { /* Telegram WebView may reject DOM fullscreen */ }
            }
            await new Promise(resolve => setTimeout(resolve, 120));
            if (!orientation?.lock) throw new Error('orientation-lock-unavailable');
            await orientation.lock(next);
            setIsFullscreen(Boolean(document.fullscreenElement) || Boolean(telegramApp));
        } catch {
            setVideoOrientation('auto');
            addToast('قفل چرخش در این مرورگر پشتیبانی نمی‌شود؛ چرخش خودکار فعال ماند.', 'error');
        }
    };

    const lockControls = () => {
        setControlsLocked(true);
        setShowControls(false);
        setShowSpeedMenu(false);
        setShowSleepMenu(false);
        setShowVolumePopover(false);
    };

    const minimizePlayer = async () => {
        // Update the UI first. Fullscreen/orientation APIs are unreliable in some
        // Telegram WebViews and must never block the minimize action.
        setMinimized(true);
        const orientation = screen.orientation as ScreenOrientation & { unlock?: () => void };
        try { orientation?.unlock?.(); } catch { /* unsupported by this WebView */ }
        setVideoOrientation('auto');
        try { (window as Window & { Telegram?: { WebApp?: { exitFullscreen?: () => void } } }).Telegram?.WebApp?.exitFullscreen?.(); } catch { /* optional API */ }
        try {
            if (document.fullscreenElement) await document.exitFullscreen();
        } catch {
            // Some Telegram WebViews leave fullscreen themselves after orientation unlock.
        }
        setIsFullscreen(false);
    };

    useEffect(() => () => {
        const orientation = screen.orientation as ScreenOrientation & { unlock?: () => void };
        orientation?.unlock?.();
    }, []);

    const handleTimeUpdate = () => {
        if (videoRef.current) {
            const mediaDuration = Number.isFinite(videoRef.current.duration) ? videoRef.current.duration : 0;
            const nextTime = Math.max(0, videoRef.current.currentTime || 0);
            setCurrentTime(mediaDuration > 0 ? Math.min(nextTime, mediaDuration) : nextTime);
            const nextFile = playQueue[queueIndex + 1];
            const remaining = mediaDuration - nextTime;
            if (!isVideo && nextFile?.file_type === 'audio' && crossfadeSeconds > 0 && remaining > 0 && remaining <= crossfadeSeconds && !crossfadeStarted.current && nextAudioRef.current) {
                crossfadeStarted.current = true;
                const outgoing = videoRef.current;
                const incoming = nextAudioRef.current;
                incoming.currentTime = 0; incoming.volume = 0;
                void incoming.play().then(()=>{
                    const started=performance.now();
                    const fade=()=>{const ratio=Math.min(1,(performance.now()-started)/(crossfadeSeconds*1000));outgoing.volume=volume*(1-ratio);incoming.volume=volume*ratio;if(ratio<1&&crossfadeStarted.current)requestAnimationFrame(fade)};
                    requestAnimationFrame(fade);
                }).catch(()=>{crossfadeStarted.current=false});
            }
        }
    };

    const handleLoadedMetadata = () => {
        if (videoRef.current) {
            const nextDuration = Number.isFinite(videoRef.current.duration) ? Math.max(0, videoRef.current.duration) : 0;
            setDuration(nextDuration);
            setCurrentTime(current => nextDuration > 0 ? Math.min(current, nextDuration) : current);
            videoRef.current.playbackRate = playbackSpeed;
            const resumeKey = `komod-player-resume-${file.id}`;
            const resumeAt = Number(sessionStorage.getItem(resumeKey) || 0);
            if (!inline && Number.isFinite(resumeAt) && resumeAt > 0) {
                videoRef.current.currentTime = nextDuration > 0 ? Math.min(resumeAt, Math.max(0, nextDuration - .1)) : resumeAt;
                setCurrentTime(videoRef.current.currentTime);
                sessionStorage.removeItem(resumeKey);
            }
            const carry = crossfadeCarry.current;
            if (carry?.fileId === file.id) {
                videoRef.current.currentTime = Math.min(carry.time, Math.max(0, nextDuration - .1));
                videoRef.current.volume = volume;
                nextAudioRef.current?.pause();
                crossfadeCarry.current = null;
            }
            if (audioSwitchPosition.current !== null) {
                videoRef.current.currentTime = Math.min(audioSwitchPosition.current, Math.max(0, nextDuration - .1));
                setCurrentTime(videoRef.current.currentTime);
                audioSwitchPosition.current = null;
            }
            setIsLoading(false);
        }
    };

    const handleWaiting = () => setIsLoading(true);
    const handlePlaying = () => { backgroundPlaybackRequested.current = true; setIsLoading(false); setIsPlaying(true); };
    const handlePause = () => {
        if (!document.hidden) backgroundPlaybackRequested.current = false;
        setIsPlaying(false);
        // Some mobile WebViews emit a synthetic pause as soon as they are
        // backgrounded. Resume only when the user had not requested a pause.
        if (document.hidden && backgroundPlaybackRequested.current) {
            window.setTimeout(() => void videoRef.current?.play().catch(() => undefined), 120);
        }
    };

    const handleEnded = () => {
        saveProgress();
        if(stopAfterCurrent){setIsPlaying(false);return}
        if (sleepMode === 'track') {
            setIsPlaying(false);
            setSleepMode('off');
            return;
        }
        if (sleepMode === 'end' && (!hasQueue || queueIndex >= playQueue.length - 1)) {
            setIsPlaying(false);
            setSleepMode('off');
            return;
        }
        if (repeatMode === 'one' && videoRef.current) {
            videoRef.current.currentTime = 0;
            videoRef.current.play();
            return;
        }
        const nextFile = playQueue[queueIndex + 1];
        if (crossfadeStarted.current && nextFile && nextAudioRef.current) {
            crossfadeCarry.current = {fileId:nextFile.id,time:nextAudioRef.current.currentTime};
        }
        crossfadeStarted.current = false;
        if (!playNext()) setIsPlaying(false);
    };

    const handleError = () => {
        if (videoRef.current?.error) {
            const code = videoRef.current.error.code;
            if (code === 2) {
                setError('ارتباط با فایل قطع شد یا اینترنت پایدار نیست.');
            } else if (code === 3) {
                if (isVideo && !compatibleVideoUrl && !offlineStreamUrl) { void prepareCompatibleVideo(); return; }
                setError(`فایل دریافت شد، اما مرورگر نتوانست ${isVideo ? 'تصویر ویدیو' : 'صدای آن'} را رمزگشایی کند.`);
            } else if (code === 4) {
                if (isVideo && !compatibleVideoUrl && !offlineStreamUrl) { void prepareCompatibleVideo(); return; }
                setError(isVideo
                    ? 'مرورگر نتوانست این ویدیو را شروع کند. پسوند MP4 به‌تنهایی سازگاری را تضمین نمی‌کند و ممکن است کُدک تصویر یا صدا پشتیبانی نشود؛ یک‌بار تلاش دوباره یا دانلود فایل را امتحان کن.'
                    : 'مرورگر نتوانست این فایل صدا را شروع کند. ممکن است کُدک داخلی فایل پشتیبانی نشود؛ یک‌بار تلاش دوباره یا دانلود فایل را امتحان کن.');
            } else {
                setError('پخش فایل متوقف شد؛ ممکن است اتصال یا دسترسی فایل موقتاً مشکل داشته باشد.');
            }
            setIsLoading(false);
        }
    };

    const handleSkip = (seconds: number) => {
        if (videoRef.current) {
            const mediaDuration = Number.isFinite(videoRef.current.duration) ? videoRef.current.duration : duration;
            const nextTime = Math.max(0, Math.min(videoRef.current.currentTime + seconds, mediaDuration || videoRef.current.currentTime + Math.max(0, seconds)));
            videoRef.current.currentTime = nextTime;
            setCurrentTime(nextTime);
        }
    };

    const setSleepTimer = (mode: 'off' | '15' | '30' | '45' | '60' | 'track' | 'end') => {
        if (sleepTimeout.current) clearTimeout(sleepTimeout.current);
        setSleepMode(mode);
        setShowSleepMenu(false);
        setShowVideoMoreMenu(false);
        if (mode === '15' || mode === '30' || mode === '45' || mode === '60') {
            sleepTimeout.current = setTimeout(() => {
                videoRef.current?.pause();
                setIsPlaying(false);
                setSleepMode('off');
            }, Number(mode) * 60 * 1000);
        }
    };

    useEffect(() => () => {
        if (sleepTimeout.current) clearTimeout(sleepTimeout.current);
    }, []);

    useEffect(() => {
        const keepPlaybackAlive = () => {
            const media = videoRef.current;
            if (!media || !backgroundPlaybackRequested.current || !media.paused || media.ended) return;
            void media.play().catch(() => undefined);
        };
        document.addEventListener('visibilitychange', keepPlaybackAlive);
        window.addEventListener('pageshow', keepPlaybackAlive);
        window.addEventListener('pagehide', keepPlaybackAlive);
        return () => {
            document.removeEventListener('visibilitychange', keepPlaybackAlive);
            window.removeEventListener('pageshow', keepPlaybackAlive);
            window.removeEventListener('pagehide', keepPlaybackAlive);
        };
    }, [file.id]);


    const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (videoRef.current) {
            const time = parseFloat(e.target.value);
            videoRef.current.currentTime = time;
            setCurrentTime(time);
        }
    };

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (videoRef.current) {
            const vol = parseFloat(e.target.value);
            videoRef.current.volume = vol;
            setVolume(vol);
            setIsMuted(vol === 0);
        }
    };

    // Keyboard controls
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)) return;
            if (error) return;

            switch (e.key) {
                case ' ':
                case 'k':
                    e.preventDefault();
                    togglePlay();
                    break;
                case 'ArrowLeft':
                case 'j':
                    e.preventDefault();
                    handleSkip(-10);
                    break;
                case 'ArrowRight':
                case 'l':
                    e.preventDefault();
                    handleSkip(10);
                    break;
                case 'm':
                    toggleMute();
                    break;
                case 'f':
                    toggleFullscreen();
                    break;
                case 'Escape':
                    if (isFullscreen) {
                        document.exitFullscreen();
                    } else if (!isMinimized) {
                        // If full screen mode (not minimized), esc minimizes? or closes?
                        // Standard behavior: ESC closes modal.
                        // But for music we might want minimize.
                        // Let's stick to close on ESC for now, user can minimize via button.
                        onClose();
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isFullscreen, onClose, error, isPlaying, isMinimized]);

    const revealControls = useCallback(() => {
        if (controlsLocked) return;
        setShowControls(true);
        if (hideControlsTimeout.current) {
            clearTimeout(hideControlsTimeout.current);
        }
        // Music controls stay visible. Hiding transport controls on every tap is
        // useful for video, but makes an audio player feel broken.
        if (!isVideo) return;
        if (showVolumePopover || showSpeedMenu || showSleepMenu || showVideoMoreMenu) return;
        hideControlsTimeout.current = setTimeout(() => {
            if (!isMinimized) {
                setShowControls(false);
                setShowSpeedMenu(false);
            }
        }, 3000);
    }, [controlsLocked, isMinimized, isVideo, showSleepMenu, showSpeedMenu, showVideoMoreMenu, showVolumePopover]);

    const toggleVideoControls = useCallback(() => {
        if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current);
        setShowControls(current => {
            const next = !current;
            if (next) {
                hideControlsTimeout.current = setTimeout(() => setShowControls(false), 3000);
            }
            return next;
        });
    }, []);

    const showSkipFeedback = (direction: 'backward' | 'forward') => {
        setSkipFeedback(direction);
        if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
        feedbackTimeout.current = setTimeout(() => setSkipFeedback(null), 650);
    };

    const handlePlayerPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        if (controlsLocked) return;
        const target = event.target as HTMLElement;
        if (target.closest('button, input, a, [role="menu"]')) {
            revealControls();
            return;
        }

        if (event.pointerType !== 'touch') {
            if (isVideo) toggleVideoControls();
            else setShowControls(current => !current);
            return;
        }

        // A tap on the music artwork only toggles the controls. Playback is
        // changed exclusively by the transport button or hardware controls.
        if (!isVideo) {
            setShowControls(current => !current);
            return;
        }

        const bounds = containerRef.current?.getBoundingClientRect();
        if (!bounds) return;
        const side = event.clientX < bounds.left + bounds.width / 2 ? 'left' : 'right';
        const now = Date.now();
        const previousTap = lastTap.current;

        if (previousTap && previousTap.side === side && now - previousTap.at <= 320) {
            if (singleTapTimeout.current) clearTimeout(singleTapTimeout.current);
            handleSkip(side === 'right' ? 10 : -10);
            showSkipFeedback(side === 'right' ? 'forward' : 'backward');
            lastTap.current = null;
            return;
        }

        lastTap.current = { at: now, side };
        if (singleTapTimeout.current) clearTimeout(singleTapTimeout.current);
        singleTapTimeout.current = setTimeout(() => {
            toggleVideoControls();
            lastTap.current = null;
        }, 330);
    };

    useEffect(() => {
        revealControls();
        return () => {
            if (hideControlsTimeout.current) clearTimeout(hideControlsTimeout.current);
            if (singleTapTimeout.current) clearTimeout(singleTapTimeout.current);
            if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
        };
    }, [isPlaying, isMinimized, revealControls]);

    // Auto-play effect
    useEffect(() => {
        setError(null);
        setCurrentTime(0);
        setDuration(0);
        setIsLoading(true);
        setPublicUrl(null);
    }, [file.id]);

    useEffect(() => {
        if (videoRef.current && !error) {
            videoRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
        }
    }, [error, file.id]); // Re-run when file changes

    const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
    const safeCurrentTime = Number.isFinite(currentTime)
        ? Math.max(0, safeDuration > 0 ? Math.min(currentTime, safeDuration) : currentTime)
        : 0;
    const progressPercent = safeDuration > 0 ? Math.min(100, (safeCurrentTime / safeDuration) * 100) : 0;
    const restoreFromMinimized=()=>{
        try {
            const origin=JSON.parse(sessionStorage.getItem('komod-pack-preview-origin')||'null') as {packId?:number;fileId?:number}|null;
            if(origin?.packId&&origin.fileId===file.id){
                const position=videoRef.current?.currentTime??safeCurrentTime;
                if(Number.isFinite(position)&&position>0)sessionStorage.setItem(`komod-player-resume-${file.id}`,String(position));
                sessionStorage.removeItem('komod-pack-preview-origin');
                window.dispatchEvent(new CustomEvent('komod-pack-restore',{detail:{packId:origin.packId,fileId:origin.fileId}}));
                onClose();
                return;
            }
        } catch { sessionStorage.removeItem('komod-pack-preview-origin'); }
        setMinimized(false);
    };
    const cleanFileName = (extendedFile?.file_name || file.file_name).replace(/^[a-f\d]{24,}[-_. ]+/i, '').trim() || file.file_name;
    const queuePosition = hasQueue && queueIndex >= 0 ? queueIndex + 1 : 1;
    const queueLength = hasQueue ? playQueue.length : 1;
    const token = localStorage.getItem('access_token');

    const getAbsoluteUrl = (url: string) => {
        if (!url) return '';
        if (url.startsWith('http')) return url;
        return `${window.location.origin}${url}`;
    };

    const selectedStreamUrl = audioOnly && audioVariantUrl ? audioVariantUrl : (offlineStreamUrl||compatibleVideoUrl||file.stream_url);
    const isOfflineSource = selectedStreamUrl.startsWith('blob:');
    const relativeStreamUrl = isOfflineSource ? selectedStreamUrl : `${selectedStreamUrl}${selectedStreamUrl.includes('?') ? '&' : '?'}token=${encodeURIComponent(token || '')}&retry=${streamRetry}`;
    const authorizedStreamUrl = isOfflineSource ? relativeStreamUrl : getAbsoluteUrl(relativeStreamUrl);
    const externalUrl = publicUrl || authorizedStreamUrl;
    const nextQueueFile = playQueue[queueIndex + 1] || (repeatMode === 'all' ? playQueue[0] : undefined);
    const nextQueueStream = nextQueueFile?.file_type === 'audio'
        ? (nextQueueFile.stream_url.startsWith('blob:') ? nextQueueFile.stream_url : getAbsoluteUrl(`${nextQueueFile.stream_url}${nextQueueFile.stream_url.includes('?')?'&':'?'}token=${encodeURIComponent(token||'')}`))
        : null;

    // Authorized Thumbnail URL
    const relativeThumbnailUrl = file.thumbnail_url ? `${file.thumbnail_url}${file.thumbnail_url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token || '')}` : null;
    const authorizedThumbnailUrl = relativeThumbnailUrl ? getAbsoluteUrl(relativeThumbnailUrl) : null;

    useEffect(() => {
        if (!('mediaSession' in navigator)) return;
        const descriptionLine = (file.description || '').split(/\r?\n/).map(line => line.trim()).find(line => line && !/^https?:\/\//i.test(line))?.replace(/^[📺📷🎧🎬]\s*/u, '');
        const mediaKind = file.file_type === 'audio' ? 'صدای در حال پخش' : file.file_type === 'video' ? 'ویدیوی در حال پخش' : 'در حال پخش';
        navigator.mediaSession.metadata = new MediaMetadata({
            title: cleanFileName,
            artist: descriptionLine?.slice(0, 80) || mediaKind,
            album: hasQueue ? `کمد · قطعه ${queuePosition.toLocaleString('fa-IR')} از ${queueLength.toLocaleString('fa-IR')}` : 'پخش از کمد',
            artwork: authorizedThumbnailUrl ? [96, 128, 192, 256, 384, 512].map(size => ({ src: authorizedThumbnailUrl, sizes: `${size}x${size}` })) : undefined,
        });
        const actions: Array<[MediaSessionAction, MediaSessionActionHandler | null]> = [
            ['play', async () => { backgroundPlaybackRequested.current = true; const media = videoRef.current; if (media?.paused) await media.play(); }],
            ['pause', () => { backgroundPlaybackRequested.current = false; const media = videoRef.current; if (media && !media.paused) media.pause(); }],
            ['previoustrack', hasQueue ? () => { playPrevious(); } : null],
            ['nexttrack', hasQueue ? () => { playNext(); } : null],
            ['seekbackward', details => handleSkip(-(details.seekOffset || 10))],
            ['seekforward', details => handleSkip(details.seekOffset || 10)],
        ];
        actions.forEach(([action, handler]) => {
            try { navigator.mediaSession.setActionHandler(action, handler); } catch { /* unsupported action */ }
        });
        return () => actions.forEach(([action]) => {
            try { navigator.mediaSession.setActionHandler(action, null); } catch { /* unsupported action */ }
        });
    }, [file.id, cleanFileName, authorizedThumbnailUrl, hasQueue, queuePosition, queueLength]);

    useEffect(() => {
        if ('mediaSession' in navigator) navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }, [isPlaying]);

    useEffect(() => {
        if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState || safeDuration <= 0) return;
        try {
            navigator.mediaSession.setPositionState({ duration: safeDuration, playbackRate: videoRef.current?.playbackRate || 1, position: Math.min(safeCurrentTime, safeDuration) });
        } catch { /* Some embedded browsers expose MediaSession without position state support. */ }
    }, [safeCurrentTime, safeDuration]);

    // Common Media Element
    const MediaElement = isVideo ? (
        <video
            key={file.id}
            ref={videoRef}
            src={authorizedStreamUrl}
            className={`max-w-full max-h-full w-full h-full object-contain ${isMinimized ? 'hidden' : ''} ${audioOnly || videoHidden ? 'invisible' : 'visible'}`}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onWaiting={handleWaiting}
            onPlaying={handlePlaying}
            onPause={handlePause}
            onError={handleError}
            onEnded={handleEnded}
            controls={false}
            playsInline
            preload="auto"
        />
    ) : (
        <audio
            key={file.id}
            ref={videoRef as React.RefObject<HTMLAudioElement>}
            src={authorizedStreamUrl}
            onTimeUpdate={handleTimeUpdate}
            onLoadedMetadata={handleLoadedMetadata}
            onWaiting={handleWaiting}
            onPlaying={handlePlaying}
            onPause={handlePause}
            onError={handleError}
            onEnded={handleEnded}
            preload="auto"
        />
    );

    // Unified Render
    return (
        <div
            ref={containerRef}
            className={`${isMinimized ? 'mini-player' : 'video-player'} ${inline ? 'relative h-full w-full overflow-hidden bg-black' : 'fixed z-[240]'} transition-all duration-300 ease-in-out ${
                inline ? '' :
                isMinimized
                    ? 'bottom-[calc(5rem+env(safe-area-inset-bottom))] left-0 right-0 h-20 max-h-[25vh] border-t border-white/10 bg-dark-900 shadow-2xl md:bottom-0'
                : 'inset-0 bg-black flex items-center justify-center font-sans'
            }`}
            data-media-kind={isVideo ? 'video' : 'audio'}
            data-inline={compactInline ? 'true' : 'false'}
            data-embedded={inline ? 'true' : 'false'}
            data-fullscreen={isFullscreen ? 'true' : 'false'}
            data-controls-locked={controlsLocked ? 'true' : 'false'}
            style={!isMinimized && !isVideo ? ({ backgroundImage: authorizedThumbnailUrl ? `linear-gradient(135deg, rgba(8,10,20,.96), rgba(38,12,54,.84)), url(${authorizedThumbnailUrl})` : 'linear-gradient(135deg, #080a14, #260c36)', backgroundPosition: 'center', backgroundSize: 'cover' }) : undefined}
            onMouseMove={undefined}
            onPointerUp={!isMinimized ? handlePlayerPointerUp : undefined}
            onDoubleClick={!isMinimized && !controlsLocked ? toggleFullscreen : undefined}
        >
            {/* Media Element - Always present */}
            {nextQueueStream&&<audio ref={nextAudioRef} src={nextQueueStream} preload="auto" className="hidden"/>}
            <div className={`w-full h-full ${isMinimized ? 'hidden' : 'flex items-center justify-center'}`}>
                {error ? (
                    <div className="text-center p-8 max-w-md glass-panel z-10 animate-scale-in">
                        <div className="w-16 h-16 rounded-2xl bg-yellow-500/20 flex items-center justify-center mx-auto mb-5 border border-yellow-500/30">
                            <AlertTriangle className="w-8 h-8 text-yellow-400" />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">پخش فایل متوقف شد</h3>
                        <p className="text-dark-300 mb-6">{error}</p>

                        <div className="flex flex-col gap-3">
                            <button onClick={() => { setError(null); setIsLoading(true); setStreamRetry(Date.now()); window.setTimeout(() => void videoRef.current?.play().catch(() => undefined), 120); }} className="btn-primary flex items-center justify-center gap-2"><RotateCw className="h-4 w-4"/> تلاش دوباره</button>
                            <div className="flex gap-3">
                                <Button
                                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(externalUrl); }}
                                    className="flex-1 btn-secondary flex items-center justify-center gap-2"
                                >
                                    <Copy className="w-4 h-4" />
                                    کپی پیوند
                                </Button>
                                <a
                                    href={externalUrl}
                                    download={file.file_name}
                                    className="flex-1 btn-secondary flex items-center justify-center gap-2"
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <Download className="w-4 h-4" />
                                    دانلود
                                </a>
                            </div>
                        </div>
                        {!inline && <button
                            onClick={onClose}
                            className="mt-6 text-dark-400 hover:text-white text-sm transition-colors"
                        >
                            بستن
                        </button>}
                    </div>
                ) : (
                    <>
                        {/* Audio Visualization / Thumbnail for non-video files in Fullscreen */}
                        {(!isVideo || audioOnly || videoHidden) && !isMinimized && (
                            <div data-player-artwork className={`absolute z-10 flex flex-col items-center justify-center text-center animate-scale-in ${compactInline?'inset-x-2 top-12 bottom-28':'inset-x-4 top-16 bottom-44'}`}>
                                {authorizedThumbnailUrl && !audioOnly && !thumbnailFailed ? (
                                    <div className={`${compactInline?'mb-2 h-28 w-28 sm:h-36 sm:w-36':'mb-6 h-60 w-60 sm:h-72 sm:w-72 lg:h-80 lg:w-80'} overflow-hidden rounded-3xl bg-dark-800 shadow-[0_12px_30px_rgba(0,0,0,.35)]`}>
                                         <img
                                            src={authorizedThumbnailUrl}
                                            alt={file.file_name}
                                            className="h-full w-full object-cover"
                                            onError={() => setThumbnailFailed(true)}
                                         />
                                    </div>
                                ) : (
                                    <div className={`relative flex items-center justify-center overflow-hidden rounded-3xl bg-gradient-to-br from-primary-500/20 to-pink-500/20 shadow-[0_12px_30px_rgba(0,0,0,.35)] ${compactInline?'mb-2 h-28 w-28 sm:h-36 sm:w-36':'mb-6 h-60 w-60 sm:h-72 sm:w-72 lg:h-80 lg:w-80'}`}>
                                         <div className="absolute inset-0 bg-gradient-to-tr from-primary-500/10 to-transparent animate-pulse"></div>
                                        {audioOnly ? <Headphones className="h-24 w-24 text-primary-300 drop-shadow-lg" /> : videoHidden ? <EyeOff className="h-24 w-24 text-primary-300 drop-shadow-lg" /> : isVideo ? <Film className="h-24 w-24 text-primary-300 drop-shadow-lg" /> : <span className="text-8xl transform transition-transform duration-500 group-hover:scale-125 drop-shadow-lg">🎵</span>}
                                    </div>
                                )}
                                <p dir="auto" className={`max-w-[80vw] truncate text-start font-bold text-white drop-shadow-md ${compactInline?'text-sm':'text-2xl'}`}>{cleanFileName}</p>
                                {audioOnly && <p className="mb-2 text-sm text-dark-300">حالت فقط صدا فعاله</p>}
                                {videoHidden && !audioOnly && <p className="mb-2 text-sm text-dark-300">تصویر خاموشه؛ صدای همین ویدیو پخش می‌شه</p>}
                                <p className="text-primary-400 font-medium" dir="ltr">{formatPersianMetaTime(safeCurrentTime)} / {formatPersianMetaTime(safeDuration)}</p>
                            </div>
                        )}

                        {MediaElement}

                        {/* Loading Spinner */}
                        {isLoading && !error && !isMinimized && (
                            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 pointer-events-none z-20 bg-black/20">
                                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary-500"></div>
                                {compatibilityMessage&&<div dir="rtl" className="w-[min(17rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-dark-950/85 px-4 py-3 text-center shadow-2xl backdrop-blur-xl"><p className="truncate text-xs font-medium text-dark-100">{compatibilityMessage}</p><div className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full rounded-full bg-gradient-to-l from-primary-300 via-primary-500 to-fuchsia-500 transition-[width] duration-500 ease-out" style={{width:`${compatibilityProgress}%`}}/></div></div>}
                            </div>
                        )}
                        {skipFeedback && !isMinimized && (
                            <div className={`pointer-events-none absolute top-1/2 z-40 -translate-y-1/2 rounded-xl border border-white/10 bg-black/70 px-3 py-2 text-sm font-bold text-white shadow-xl backdrop-blur-md ${skipFeedback === 'forward' ? 'right-[18%]' : 'left-[18%]'}`}>
                                {skipFeedback === 'forward' ? '+۱۰ ثانیه' : '−۱۰ ثانیه'}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Minimized Controls */}
            {isMinimized && (
                <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 sm:gap-4 p-3 h-full">
                    <div className="flex items-center gap-3 overflow-hidden flex-1 cursor-pointer" onClick={restoreFromMinimized}>
                         {/* Thumbnail/Icon */}
                        <div className="w-12 h-12 rounded-lg bg-dark-800 flex items-center justify-center flex-shrink-0 overflow-hidden border border-white/5 relative">
                            {authorizedThumbnailUrl && !thumbnailFailed ? (
                                <img src={authorizedThumbnailUrl} alt="Thumb" style={{ imageRendering: 'auto' }} className="w-full h-full object-cover" onError={() => setThumbnailFailed(true)} />
                            ) : (
                                isVideo ? <span className="text-2xl">🎬</span> : <span className="text-2xl">🎵</span>
                            )}
                        </div>
                        <div className="truncate flex-1 min-w-0">
                            <h4 dir="auto" className="truncate text-start text-sm font-bold leading-tight text-white">{cleanFileName}</h4>
                            <p className="font-player text-xs text-dark-400" dir="ltr">{formatPlayerTime(safeCurrentTime)} / {formatPlayerTime(safeDuration)}</p>
                        </div>
                    </div>

                    <div className="flex items-center gap-1 sm:gap-3">
                        <button disabled={!hasQueue} onClick={(e) => { e.stopPropagation(); shuffleQueue(); }} className="hidden p-2 text-dark-300 hover:text-white disabled:opacity-30 sm:block" title="شافل صف پخش"><Shuffle className="h-5 w-5"/></button>
                        <button disabled={!hasQueue} onClick={(e) => { e.stopPropagation(); playPrevious(); }} className="p-2 text-dark-300 hover:text-white disabled:opacity-30" title="ترک قبلی">
                            <SkipBack className="w-5 h-5" />
                        </button>
                        <button
                            onClick={(e) => { e.stopPropagation(); togglePlay(); }}
                            className="p-2 bg-primary-600 rounded-full text-white hover:bg-primary-500 shadow-lg shadow-primary-500/20"
                        >
                            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
                        </button>
                        <button disabled={!hasQueue} onClick={(e) => { e.stopPropagation(); playNext(); }} className="p-2 text-dark-300 hover:text-white disabled:opacity-30" title="ترک بعدی">
                            <SkipForward className="w-5 h-5" />
                        </button>
                    </div>

                    <div className="flex items-center gap-1 sm:gap-2 border-l border-white/10 pl-1 sm:pl-4">
                         <button onClick={restoreFromMinimized} className="p-2 text-dark-400 hover:text-white" title="بازگشت به جعبه">
                            <ChevronUp className="w-5 h-5" />
                        </button>
                        <button onClick={onClose} className="p-2 text-dark-400 hover:text-red-400" title="بستن">
                            <X className="w-5 h-5" />
                        </button>
                    </div>

                    {/* Progress bar line at top */}
                    <div className="absolute top-0 left-0 right-0 h-0.5 bg-dark-800">
                        <div className="h-full bg-primary-500" style={{ width: `${progressPercent}%` }}></div>
                    </div>
                </div>
            )}

            {!isMinimized && controlsLocked && (
                <button
                    onClick={(event) => { event.stopPropagation(); setControlsLocked(false); setShowControls(true); }}
                    className="absolute left-4 top-4 z-[80] flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-black/65 text-white shadow-2xl backdrop-blur-md"
                    title="باز کردن قفل لمس"
                    aria-label="باز کردن قفل لمس"
                >
                    <UnlockKeyhole className="h-5 w-5" />
                </button>
            )}

            {/* Fullscreen Controls overlay */}
            {!error && !isMinimized && !controlsLocked && (
                <div
                    className={`absolute inset-0 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 cursor-none'}`}
                    style={{ pointerEvents: showControls ? 'auto' : 'none' }}
                    onPointerDown={isVideo ? undefined : revealControls}
                >
                    {/* Top bar */}
                    <div data-player-controls className={`absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-2 bg-gradient-to-b from-black/80 to-transparent ${compactInline?'p-2':'p-3 sm:p-4'} ${isVideo ? 'overflow-hidden' : ''}`}>
                        <div className={`min-w-0 flex-1 ${inlineExpanded?'pl-24':''}`}>
                            {isVideo && <h3 dir="auto" className={`w-full truncate text-start font-medium text-white ${compactInline?'text-sm':'text-base sm:text-lg'}`} title={cleanFileName}>{cleanFileName}</h3>}
                        </div>
                        {hasQueue && <p data-track-counter dir="rtl" className="absolute left-1/2 top-16 z-50 -translate-x-1/2 whitespace-nowrap rounded-xl border border-white/15 bg-black/75 px-4 py-2 text-sm font-bold text-white shadow-xl backdrop-blur-md">ترک <span className="font-black text-primary-300">{queuePosition.toLocaleString('fa-IR')}</span> از <span className="font-black text-primary-300">{queueLength.toLocaleString('fa-IR')}</span></p>}
                        {!inline && <div className="flex shrink-0 items-center justify-end gap-1 sm:gap-2">
                             <button
                                onClick={() => void minimizePlayer()}
                                className="p-2 text-white hover:bg-white/20 rounded-full transition-colors"
                                title="کوچک‌نمایی"
                            >
                                <ChevronDown className="w-6 h-6" />
                            </button>
                            <button
                                onClick={onClose}
                                className="p-2 text-white hover:bg-white/20 rounded-full transition-colors"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>}
                    </div>

                    {/* Secondary tools stay away from the transport controls. */}
                    <div data-player-controls data-player-tools className={`absolute left-1/2 z-40 flex w-max max-w-[calc(100%-0.75rem)] -translate-x-1/2 flex-nowrap items-center justify-center gap-0.5 rounded-2xl border border-white/10 bg-black/45 shadow-xl backdrop-blur-md ${compactInline?'top-12 p-0.5':'top-28 p-1 sm:top-28 sm:gap-1 sm:p-1.5'}`}>
                        {isVideo && <div className="relative">
                            <button onClick={() => { setShowVideoMoreMenu(open => !open); setShowSpeedMenu(false); setShowSleepMenu(false); }} className={`rounded-lg p-2 transition-all ${showVideoMoreMenu || repeatMode !== 'off' || audioOnly || sleepMode !== 'off' ? 'bg-primary-500/25 text-primary-200' : 'text-white/80 hover:bg-white/10'}`} title="گزینه‌های بیشتر" aria-expanded={showVideoMoreMenu}><MoreHorizontal className="h-5 w-5"/></button>
                            {showVideoMoreMenu && <div role="menu" aria-label="گزینه‌های بیشتر ویدیو" dir="rtl" onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} className="absolute left-0 top-[calc(100%+.45rem)] z-[80] box-border max-h-[min(60dvh,22rem)] w-44 max-w-[calc(100vw-1.5rem)] overflow-y-auto overscroll-contain rounded-2xl border border-primary-400/25 bg-black/90 p-1.5 text-right shadow-2xl shadow-black/60 backdrop-blur-2xl">
                                <div className="space-y-1">
                                <button className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-xs transition ${videoHidden?'bg-primary-500/20 text-primary-200':'text-dark-200 hover:bg-white/[.07]'}`} onClick={()=>{setVideoHidden(value=>{if(!value&&audioOnly)setAudioOnly(false);return !value});setShowVideoMoreMenu(false)}}><EyeOff className="h-4 w-4 shrink-0"/><span>{videoHidden?'روشن کردن تصویر':'خاموش کردن تصویر'}</span></button>
                                <button disabled={preparingAudio} className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-xs transition disabled:opacity-50 ${audioOnly?'bg-primary-500/20 text-primary-200':'text-dark-200 hover:bg-white/[.07]'}`} onClick={()=>void toggleAudioOnly()}><Headphones className="h-4 w-4 shrink-0"/><span>{preparingAudio?'آماده‌سازی…':audioOnly ? 'بازگشت به ویدیو' : 'فقط صدا'}</span></button>
                                <button className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-xs transition ${repeatMode!=='off'?'bg-primary-500/20 text-primary-200':'text-dark-200 hover:bg-white/[.07]'}`} onClick={() => {setRepeatMode(repeatMode === 'off' ? (hasQueue ? 'all' : 'one') : repeatMode === 'all' ? 'one' : 'off');setShowVideoMoreMenu(false)}}><Repeat2 className="h-4 w-4 shrink-0"/><span>{repeatMode === 'off' ? 'تکرار خاموش' : repeatMode === 'all' ? 'تکرار صف' : 'تکرار همین ویدیو'}</span></button>
                                <button className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-xs transition ${sleepMode!=='off'?'bg-primary-500/20 text-primary-200':'text-dark-200 hover:bg-white/[.07]'}`} onClick={() => setShowSleepMenu(open => !open)}><Clock3 className="h-4 w-4 shrink-0"/><span>تایمر خواب</span><ChevronDown className={`mr-auto h-3.5 w-3.5 transition ${showSleepMenu?'rotate-180':''}`}/></button>
                                {showSleepMenu && <div className="grid grid-cols-2 gap-1 rounded-lg bg-black/20 p-1">
                                    {([['15','۱۵ دقیقه'],['30','۳۰ دقیقه'],['45','۴۵ دقیقه'],['60','۱ ساعت'],['track','پایان ویدیو'],['end','پایان صف']] as const).map(([mode,label])=><button key={mode} onClick={()=>setSleepTimer(mode)} className={`rounded-lg px-2 py-2 text-[11px] ${sleepMode===mode?'bg-primary-500/25 text-primary-200':'text-dark-300 hover:bg-white/[.05]'}`}>{label}</button>)}
                                    {sleepMode !== 'off'&&<button onClick={()=>setSleepTimer('off')} className="col-span-2 rounded-lg px-2 py-2 text-[11px] text-red-300 hover:bg-red-500/10">لغو تایمر</button>}
                                </div>}
                                {document.pictureInPictureEnabled && <button className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 text-xs text-dark-200 hover:bg-white/[.07]" onClick={()=>{setShowVideoMoreMenu(false);void togglePiP()}}><PictureInPicture2 className="h-4 w-4 shrink-0"/><span>{isPiP ? 'خروج از تصویر کوچک' : 'تصویر در تصویر'}</span></button>}
                                </div>
                            </div>}
                        </div>}
                        {!isVideo && <button onClick={() => setPlaylistFile(file)} className="rounded-lg p-2 text-white/80 hover:bg-white/10" title="افزودن به پلی‌لیست"><ListPlus className="h-5 w-5" /></button>}
                        {hasQueue && <button onClick={() => setShowQueue(true)} className="rounded-lg p-2 text-white/80 hover:bg-white/10" title="صف پخش"><ListMusic className="h-5 w-5" /></button>}
                        {!isVideo && <button onClick={() => handleSkip(-10)} className="rounded-lg p-2 text-white/80 hover:bg-white/10" title="۱۰ ثانیه عقب"><RotateCcw className="h-5 w-5" /></button>}
                        <div className="relative">
                            <button onClick={() => { setShowSpeedMenu(open => !open); setShowVideoMoreMenu(false); setShowSleepMenu(false); }} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-all ${playbackSpeed !== 1 ? 'border-primary-500/40 bg-primary-500/30 text-primary-300' : 'border-white/10 bg-white/10 text-white/80 hover:bg-white/20'}`} title="انتخاب سرعت پخش" aria-expanded={showSpeedMenu}><Gauge className="w-4 h-4" /><span>{playbackSpeedLabel(playbackSpeed)}</span></button>
                            {showSpeedMenu && <div role="menu" aria-label="سرعت پخش" className="absolute left-1/2 top-full mt-2 grid w-52 -translate-x-1/2 grid-cols-3 gap-1 overflow-hidden rounded-2xl border border-primary-400/25 bg-black/90 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-2xl">{PLAYBACK_SPEEDS.map(speed => <button key={speed} role="menuitem" onClick={() => setSpeed(speed)} className={`rounded-lg px-2 py-2 text-center text-xs transition-colors ${playbackSpeed === speed ? 'bg-primary-500/25 font-bold text-primary-200' : 'text-white/80 hover:bg-white/10'}`}>{playbackSpeedLabel(speed)}</button>)}</div>}
                        </div>
                        {!isVideo && <button onClick={() => handleSkip(10)} className="rounded-lg p-2 text-white/80 hover:bg-white/10" title="۱۰ ثانیه جلو"><RotateCw className="h-5 w-5" /></button>}
                        {!isVideo && <div className="relative">
                            <button onClick={() => setShowSleepMenu(open => !open)} className={`p-2 rounded-lg transition-all ${sleepMode !== 'off' ? 'bg-primary-500/30 text-primary-300' : 'hover:bg-white/10 text-white/80'}`} title="تایمر خواب"><Clock3 className="h-5 w-5" /></button>
                            {showSleepMenu && <div role="menu" aria-label="تایمر خواب" className="absolute left-1/2 top-full mt-2 w-48 -translate-x-1/2 overflow-hidden rounded-xl border border-white/10 bg-dark-900/95 p-1.5 text-right shadow-2xl backdrop-blur-md">
                                <p className="px-3 py-2 text-xs text-dark-400">توقف خودکار پخش</p>
                                <button className="context-menu-item w-full" onClick={() => setSleepTimer('15')}>۱۵ دقیقه</button>
                                <button className="context-menu-item w-full" onClick={() => setSleepTimer('30')}>۳۰ دقیقه</button>
                                <button className="context-menu-item w-full" onClick={() => setSleepTimer('45')}>۴۵ دقیقه</button>
                                <button className="context-menu-item w-full" onClick={() => setSleepTimer('60')}>۱ ساعت</button>
                                <button className="context-menu-item w-full" onClick={() => setSleepTimer('track')}>پایان این ترک</button>
                                <button className="context-menu-item w-full" onClick={() => setSleepTimer('end')}>پایان پلی‌لیست</button>
                                {sleepMode !== 'off' && <button className="context-menu-item w-full text-red-300" onClick={() => setSleepTimer('off')}>لغو تایمر</button>}
                            </div>}
                        </div>}
                        {isVideo && <button onClick={() => void toggleVideoOrientation()} className={`rounded-lg p-2 transition-all ${videoOrientation !== 'auto' ? 'bg-primary-500/30 text-primary-300' : 'text-white/80 hover:bg-white/10'}`} title={videoOrientation === 'auto' ? 'چرخش خودکار؛ بعدی: افقی' : videoOrientation === 'landscape' ? 'قفل افقی؛ بعدی: عمودی' : 'قفل عمودی؛ بعدی: خودکار'}>{videoOrientation === 'landscape' ? <RectangleHorizontal className="h-5 w-5"/> : videoOrientation === 'portrait' ? <Smartphone className="h-5 w-5"/> : <MonitorSmartphone className="h-5 w-5"/>}</button>}
                        {isVideo && <div className="relative"><button onClick={() => window.matchMedia('(pointer: coarse)').matches ? toggleMute() : setShowVolumePopover(open => !open)} className="rounded-lg p-2 text-white/80 hover:bg-white/10" title="صدا">{isMuted || volume === 0 ? <VolumeX className="h-5 w-5"/> : <Volume2 className="h-5 w-5"/>}</button>{showVolumePopover && <div className="absolute left-1/2 top-full z-50 mt-2 flex w-36 -translate-x-1/2 items-center rounded-xl border border-white/10 bg-dark-900/95 p-3 shadow-2xl"><input type="range" min={0} max={1} step={0.05} value={isMuted ? 0 : volume} onChange={handleVolumeChange} className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/30" aria-label="شدت صدا"/></div>}</div>}
                        <button onClick={lockControls} className="rounded-lg p-2 text-white/80 hover:bg-white/10" title="قفل لمس"><LockKeyhole className="h-5 w-5"/></button>
                        <button onClick={toggleFullscreen} className="p-2 rounded-lg hover:bg-white/10 text-white/80" title={isFullscreen ? 'خروج از تمام‌صفحه' : 'تمام‌صفحه'}>{isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}</button>
                    </div>

                    {/* Transport controls: queue navigation for music, seeking for video. */}
                    <div data-player-controls data-player-transport dir="ltr" className={`absolute left-1/2 z-30 flex -translate-x-1/2 items-center ${isVideo && !audioOnly && !videoHidden ? `top-1/2 -translate-y-1/2 ${compactInline?'gap-0.5':'gap-2 sm:gap-5'}` : `${compactInline?'bottom-20 gap-0.5':'bottom-32 gap-2 sm:gap-5'}`}`}>
                        {isVideo && <button disabled={!hasQueue} onClick={(e) => { e.stopPropagation(); playPrevious(); }} className="rounded-full p-2 text-white/65 transition hover:bg-white/10 hover:text-white disabled:opacity-30" title="ویدیوی قبلی"><SkipBack className="h-5 w-5"/></button>}
                        <button disabled={!isVideo && !hasQueue} onClick={(e) => { e.stopPropagation(); isVideo ? handleSkip(-10) : playPrevious(); }} className="rounded-full p-3 text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-30" title={isVideo ? '۱۰ ثانیه عقب' : 'ترک قبلی'}>{isVideo ? <RotateCcw className="h-6 w-6"/> : <SkipBack className="h-7 w-7"/>}</button>
                        {isVideo ? <button data-primary-play onClick={(e) => { e.stopPropagation(); togglePlay(e); }} className={`flex items-center justify-center rounded-full bg-primary-500 text-white shadow-2xl shadow-primary-500/35 transition duration-200 hover:scale-105 hover:bg-primary-400 active:scale-95 ${compactInline?'h-14 w-14':'h-20 w-20'}`} aria-label={isPlaying ? 'توقف' : 'پخش'}>{isPlaying ? <Pause className={compactInline?'h-6 w-6':'h-9 w-9'}/> : <Play className={`${compactInline?'h-6 w-6':'h-9 w-9'} ml-1`}/>}</button> : <button data-primary-play onClick={(e) => { e.stopPropagation(); togglePlay(e); }} className={`flex items-center justify-center rounded-full bg-primary-500 text-white shadow-xl shadow-primary-500/30 transition hover:scale-105 hover:bg-primary-400 ${compactInline?'h-14 w-14':'h-20 w-20'}`}>{isPlaying ? <Pause className={compactInline?'h-6 w-6':'h-9 w-9'}/> : <Play className={`${compactInline?'h-6 w-6':'h-9 w-9'} ml-1`}/>}</button>}
                        <button disabled={!isVideo && !hasQueue} onClick={(e) => { e.stopPropagation(); isVideo ? handleSkip(10) : playNext(); }} className="rounded-full p-3 text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-30" title={isVideo ? '۱۰ ثانیه جلو' : 'ترک بعدی'}>{isVideo ? <RotateCw className="h-6 w-6"/> : <SkipForward className="h-7 w-7"/>}</button>
                        {isVideo && <button disabled={!hasQueue} onClick={(e) => { e.stopPropagation(); playNext(); }} className="rounded-full p-2 text-white/65 transition hover:bg-white/10 hover:text-white disabled:opacity-30" title="ویدیوی بعدی"><SkipForward className="h-5 w-5"/></button>}
                    </div>

                    {/* Bottom controls */}
                    <div data-player-controls data-player-bottom className={`absolute z-30 rounded-2xl border border-white/[.08] bg-black/35 shadow-[0_10px_35px_rgba(0,0,0,.28)] backdrop-blur-xl ${compactInline?'bottom-2 left-2 right-2 px-2 py-2':'bottom-3 left-3 right-3 px-3 py-3 sm:bottom-4 sm:left-5 sm:right-5 sm:px-4 sm:py-3.5'}`}>
                        {/* Progress bar */}
                        <div className="group/progress mb-4 flex items-center gap-2.5 sm:gap-4">
                            <span dir="ltr" className="font-player min-w-[42px] text-center text-[11px] font-semibold tracking-wide text-white/85">{formatPlayerTime(safeCurrentTime)}</span>
                            <div className={`relative h-2 flex-1 cursor-pointer overflow-visible rounded-full bg-white/15 ${safeDuration<=0?'animate-pulse':''}`}>
                                {/* Buffered progress can be added here */}
                                <div
                                    className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary-600 via-primary-500 to-primary-300 shadow-lg shadow-primary-500/30"
                                    style={{ width: `${progressPercent}%` }}
                                />
                                {safeDuration>0&&<span className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow-md shadow-black/40" style={{ left: `clamp(6px, ${progressPercent}%, calc(100% - 6px))` }}/>}
                                <input
                                    type="range"
                                    min={0}
                                    max={safeDuration || 100}
                                    value={safeCurrentTime}
                                    onChange={handleSeek}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                />
                            </div>
                            <span dir="ltr" className="font-player min-w-[42px] text-center text-[11px] font-semibold tracking-wide text-white/85">{formatPlayerTime(safeDuration)}</span>
                        </div>

                        {/* Control buttons */}
                        {!isVideo && <div dir="ltr" className="flex items-center justify-between gap-3">
                            {!isVideo ? <div className="flex items-center gap-1"><button disabled={!hasQueue} onClick={shuffleQueue} className="rounded-full p-2 text-white/75 hover:bg-white/10 disabled:opacity-30" title="شافل"><Shuffle className="h-5 w-5"/></button><button onClick={() => setRepeatMode(repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off')} className={`rounded-full p-2 ${repeatMode !== 'off' ? 'bg-primary-500/25 text-primary-200' : 'text-white/75 hover:bg-white/10'}`} title="تکرار"><Repeat2 className="h-5 w-5"/></button></div> : <div />}
                            <div className="flex items-center gap-3">
                            <div className="relative">
                                <button
                                    onClick={() => window.matchMedia('(pointer: coarse)').matches ? toggleMute() : setShowVolumePopover(open => !open)}
                                    className="rounded-lg p-2 text-white/80 transition-all hover:bg-white/10 hover:text-white"
                                    title="تنظیم صدا"
                                    aria-expanded={showVolumePopover}
                                >
                                    {isMuted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
                                </button>
                                {showVolumePopover && (
                                    <div className="absolute bottom-full right-0 z-50 mb-2 flex w-36 max-w-[calc(100vw-2rem)] items-center justify-center gap-2 rounded-xl border border-white/10 bg-dark-900/95 p-3 shadow-2xl backdrop-blur-md">
                                        <input
                                            type="range"
                                            min={0}
                                            max={1}
                                            step={0.05}
                                            value={isMuted ? 0 : volume}
                                            onChange={handleVolumeChange}
                                            className="hidden h-1 w-24 cursor-pointer appearance-none rounded-full bg-white/30 sm:block [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white"
                                            aria-label="شدت صدا"
                                        />
                                    </div>
                                )}
                            </div>

                            <div className="hidden">
                                {hasQueue && <button onClick={shuffleQueue} className="p-2 rounded-lg hover:bg-white/10 text-white/80 hover:text-white" title="شافل صف پخش"><Shuffle className="h-5 w-5" /></button>}
                                {hasQueue && <button onClick={() => setRepeatMode(repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off')} className={`relative p-2 rounded-lg transition-colors ${repeatMode !== 'off' ? 'bg-primary-500/20 text-primary-300' : 'hover:bg-white/10 text-white/80'}`} title={repeatMode === 'off' ? 'تکرار خاموش' : repeatMode === 'all' ? 'تکرار همه' : 'تکرار همین مورد'}><Repeat2 className="h-5 w-5" />{repeatMode === 'one' && <span className="absolute -left-0.5 -top-0.5 text-[9px] font-bold">۱</span>}</button>}
                                {/* Speed */}
                                <div className="relative">
                                    {showSpeedMenu && (
                                        <div role="menu" aria-label="سرعت پخش" className="absolute bottom-full right-0 mb-2 grid w-52 grid-cols-3 gap-1 overflow-hidden rounded-2xl border border-primary-400/25 bg-black/90 p-1.5 shadow-2xl shadow-black/60 backdrop-blur-2xl">
                                            {PLAYBACK_SPEEDS.map(speed => (
                                                <button
                                                    key={speed}
                                                    role="menuitem"
                                                    onClick={() => setSpeed(speed)}
                                                    className={`rounded-lg px-2 py-2 text-center text-xs transition-colors ${playbackSpeed === speed ? 'bg-primary-500/25 font-bold text-primary-200' : 'text-white/80 hover:bg-white/10 hover:text-white'}`}
                                                >
                                                    {playbackSpeedLabel(speed)}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    <button
                                        onClick={() => { setShowSpeedMenu(open => !open); setShowVideoMoreMenu(false); setShowSleepMenu(false); }}
                                        className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${playbackSpeed !== 1
                                            ? 'bg-primary-500/30 text-primary-300 border border-primary-500/40'
                                            : 'bg-white/10 text-white/80 border border-white/10 hover:bg-white/20 hover:text-white'
                                            }`}
                                        title="انتخاب سرعت پخش"
                                        aria-expanded={showSpeedMenu}
                                    >
                                        <Gauge className="w-4 h-4" />
                                        <span>{playbackSpeedLabel(playbackSpeed)}</span>
                                    </button>
                                </div>

                                {isVideo && (
                                    <button
                                        onClick={() => void toggleAudioOnly()}
                                        disabled={preparingAudio}
                                        className={`p-2 rounded-lg transition-all ${audioOnly ? 'bg-primary-500/30 text-primary-300' : 'hover:bg-white/10 text-white/80 hover:text-white'}`}
                                        title={audioOnly ? 'بازگشت به پخش ویدیو' : 'پخش فقط صدا'}
                                    >
                                        <Headphones className="w-5 h-5" />
                                    </button>
                                )}

                                {/* PiP */}
                                {isVideo && document.pictureInPictureEnabled && (
                                    <button
                                        onClick={togglePiP}
                                        className={`p-2 rounded-lg transition-all ${isPiP
                                            ? 'bg-primary-500/30 text-primary-300'
                                            : 'hover:bg-white/10 text-white/80 hover:text-white'
                                            }`}
                                        title="تصویر در تصویر"
                                    >
                                        <PictureInPicture2 className="w-5 h-5" />
                                    </button>
                                )}

                                {/* Fullscreen */}
                                <button
                                    onClick={toggleFullscreen}
                                    className="p-2 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-all"
                                    title={isFullscreen ? 'خروج از تمام‌صفحه' : 'تمام‌صفحه'}
                                >
                                    {isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}
                                </button>
                            </div>
                            </div>
                        </div>}
                    </div>
                </div>
            )}

            {!isMinimized && showQueue && (
                <div className="absolute inset-0 z-[100] flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-5" onPointerUp={event=>event.stopPropagation()} onClick={() => setShowQueue(false)}>
                    <section dir="rtl" className="flex max-h-[78dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[2rem] border border-white/10 bg-dark-900/98 shadow-2xl sm:rounded-3xl" onClick={event => event.stopPropagation()}>
                        <header className="flex items-center gap-1.5 border-b border-white/[.07] px-3 py-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-500/12 text-primary-200"><ListMusic className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="font-bold">{showHistory?'تاریخچه پخش':showRecommendations?'پیشنهاد بعدی':'صف پخش'}</h2><p className="mt-0.5 text-[11px] text-dark-400">{showHistory?`${historyItems.length.toLocaleString('fa-IR')} مورد اخیر`:showRecommendations?`${recommendations.length.toLocaleString('fa-IR')} پیشنهاد`:`${Math.max(0, playQueue.length-queueIndex-1).toLocaleString('fa-IR')} مورد در ادامه`}</p></div>{!showHistory&&!showRecommendations&&<><button className={`btn-icon ${stopAfterCurrent?'bg-primary-500/15 text-primary-200':''}`} onClick={()=>setStopAfterCurrent(value=>!value)} title={stopAfterCurrent?'پخش خودکار فایل بعدی':'بعد از همین فایل متوقف شو'}><StopCircle className="h-4 w-4"/></button><button className="btn-icon" onClick={reverseQueue} title="برعکس کردن ترتیب صف"><ArrowUpDown className="h-4 w-4"/></button></>}<button className={`btn-icon ${showRecommendations?'text-primary-300':''}`} onClick={()=>{setShowHistory(false);void loadRecommendations()}} title="پیشنهادها"><ListPlus className="h-4 w-4"/></button><button className={`btn-icon ${showHistory?'text-primary-300':''}`} onClick={()=>{setShowRecommendations(false);void loadHistory()}} title="تاریخچه"><History className="h-4 w-4"/></button><button className="btn-icon" onClick={()=>setShowQueueSave(value=>!value)} title="ذخیره صف"><Save className="h-4 w-4"/></button><button className="btn-icon" onClick={() => setShowQueue(false)} aria-label="بستن صف"><X className="h-5 w-5"/></button></header>
                        {showQueueSave&&<div className="flex gap-2 border-b border-white/[.07] p-3"><input autoFocus value={queueName} onChange={event=>setQueueName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void saveNamedQueue()}} className="input min-w-0 flex-1 text-sm" placeholder="نام این صف"/><button disabled={!queueName.trim()||createPlaylist.isPending||addPlaylistItems.isPending} onClick={()=>void saveNamedQueue()} className="btn-primary shrink-0 px-4 text-xs disabled:opacity-40">ذخیره</button></div>}
                        {showHistory?<div className="min-h-0 overflow-y-auto p-3">{historyItems.map((item,index)=><button key={item.id} onClick={()=>{useAppStore.getState().startQueue(historyItems,index);setShowHistory(false)}} className="mb-1.5 flex w-full items-center gap-3 rounded-2xl bg-white/[.025] p-3 text-right hover:bg-white/[.06]"><History className="h-4 w-4 shrink-0 text-dark-500"/><span dir="auto" className="min-w-0 flex-1 truncate text-sm">{item.file_name.replace(/\.[^.]+$/,'')}</span><span className="text-[10px] text-dark-500">{item.last_pos?`${Math.floor(item.last_pos/60).toLocaleString('fa-IR')} دقیقه`:''}</span></button>)}</div>:showRecommendations?<div className="min-h-0 overflow-y-auto p-3">{recommendations.map(item=><div key={item.id} className="mb-1.5 flex items-center gap-2 rounded-2xl bg-white/[.025] p-2"><button onClick={()=>useAppStore.getState().startQueue([item],0)} dir="auto" className="min-w-0 flex-1 truncate p-1 text-right text-sm">{item.file_name.replace(/\.[^.]+$/,'')}</button><button onClick={()=>{appendQueueItems([item]);setRecommendations(items=>items.filter(value=>value.id!==item.id))}} className="btn-icon h-9 w-9" title="افزودن به صف"><ListPlus className="h-4 w-4"/></button></div>)}</div>:<DndContext sensors={queueSensors} collisionDetection={closestCenter} onDragStart={({active})=>{const id=String(active.id);setActiveQueueId(id);queueDropTargetRef.current=id}} onDragCancel={()=>{setActiveQueueId(null);queueDropTargetRef.current=null}} onDragEnd={({active,over}:DragEndEvent)=>{if(over&&active.id!==over.id){const from=queueRows.findIndex(row=>row.id===String(active.id));const to=queueRows.findIndex(row=>row.id===String(over.id));if(from>=0&&to>=0)moveQueueItem(from,to)}setActiveQueueId(null);queueDropTargetRef.current=null}}>
                            <SortableContext items={queueRows.map(row=>row.id)} strategy={verticalListSortingStrategy}>
                                <div className="min-h-0 overflow-y-auto p-3">{queueRows.map(({item,index,id})=><SortableQueueRow key={id} sortableId={id} item={item} index={index} currentIndex={queueIndex} onPlay={()=>{useAppStore.getState().playQueueItem(index);setShowQueue(false)}} onRemove={()=>removeQueueItem(index)}/>)}</div>
                            </SortableContext>
                            <DragOverlay dropAnimation={{duration:140,easing:'ease-out'}}>{activeQueueId&&<div className="flex min-h-14 w-[min(26rem,calc(100vw-2rem))] items-center gap-3 rounded-2xl border border-primary-400/30 bg-dark-800 px-3 shadow-2xl"><GripVertical className="h-4 w-4 text-primary-300"/><span dir="auto" className="truncate text-sm">{queueRows.find(row=>row.id===activeQueueId)?.item.file_name.replace(/\.[^.]+$/,'')}</span></div>}</DragOverlay>
                        </DndContext>}
                    </section>
                </div>
            )}
        </div>
    );
}

function SortableQueueRow({sortableId,item,index,currentIndex,onPlay,onRemove}:{sortableId:string;item:TelegramFile;index:number;currentIndex:number;onPlay:()=>void;onRemove:()=>void}) {
    const sortable=useSortable({id:sortableId});
    const current=index===currentIndex;
    return <article ref={sortable.setNodeRef} style={{transform:CSS.Transform.toString(sortable.transform),transition:sortable.transition}} className={`mb-1.5 flex items-center gap-2 rounded-2xl p-2 ${current?'bg-primary-500/12 ring-1 ring-primary-400/20':'bg-white/[.025]'} ${sortable.isDragging?'z-20 opacity-70 shadow-2xl':''}`}>
        <button {...sortable.attributes} {...sortable.listeners} className="flex h-9 w-8 shrink-0 touch-none items-center justify-center rounded-xl text-dark-400 hover:bg-white/[.06] hover:text-white" aria-label="جابه‌جایی در صف"><GripVertical className="h-4 w-4"/></button>
        <button onClick={onPlay} className="min-w-0 flex-1 text-right"><span dir="auto" className="block truncate text-sm font-medium">{item.file_name.replace(/\.[^.]+$/,'')}</span>{current&&<span className="mt-0.5 block text-[10px] text-primary-300">در حال پخش</span>}</button>
        {!current&&<button onClick={onRemove} className="btn-icon h-8 w-8 shrink-0 text-red-300" title="حذف موقت از صف"><Trash2 className="h-3.5 w-3.5"/></button>}
    </article>;
}

// Helper button component for cleaner code
function Button({ onClick, className, children }: { onClick?: (e: any) => void, className?: string, children: React.ReactNode }) {
    return (
        <button onClick={onClick} className={className}>
            {children}
        </button>
    );
}
