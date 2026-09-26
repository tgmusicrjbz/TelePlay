/**
 * MediaPlayer - full screen video/audio player
 */
import { useRef, useEffect, useState, useCallback } from 'react';
import { X, Play, Pause, Volume2, VolumeX, Maximize, Minimize, SkipBack, SkipForward, Download, ExternalLink, AlertTriangle, Copy, PictureInPicture2, Gauge, ChevronDown, ChevronUp, Repeat2, Shuffle, Headphones, Scaling, RotateCcw, RotateCw, Clock3, ListPlus, RectangleHorizontal } from 'lucide-react';
import { TelegramFile, formatDuration, useUpdateProgress, useFile, api } from '../lib/api';
import { useAppStore } from '../lib/store';

export default function MediaPlayer() {
    const { previewFile: file, setPreviewFile, isPlayerMinimized, setPlayerMinimized, clearQueue } = useAppStore();
    
    if (!file || (file.file_type !== 'video' && file.file_type !== 'audio')) return null;

    return <MediaPlayerContent file={file} onClose={() => { setPreviewFile(null); clearQueue(); }} isMinimized={isPlayerMinimized} setMinimized={setPlayerMinimized} />;
}

interface MediaPlayerContentProps {
    file: TelegramFile;
    onClose: () => void;
    isMinimized: boolean;
    setMinimized: (minimized: boolean) => void;
}

function MediaPlayerContent({ file, onClose, isMinimized, setMinimized }: MediaPlayerContentProps) {
    const { playQueue, queueIndex, repeatMode, playNext, playPrevious, shuffleQueue, setRepeatMode, setPlaylistFile, addToast } = useAppStore();
    const videoRef = useRef<HTMLVideoElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [volume, setVolume] = useState(1);
    const [isMuted, setIsMuted] = useState(false);
    const [showControls, setShowControls] = useState(true);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [isPiP, setIsPiP] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const hideControlsTimeout = useRef<ReturnType<typeof setTimeout>>();
    const singleTapTimeout = useRef<ReturnType<typeof setTimeout>>();
    const feedbackTimeout = useRef<ReturnType<typeof setTimeout>>();
    const backgroundPlaybackRequested = useRef(false);
    const lastTap = useRef<{ at: number; side: 'left' | 'right' } | null>(null);
    const [publicUrl, setPublicUrl] = useState<string | null>(null);
    const [showSpeedMenu, setShowSpeedMenu] = useState(false);
    const [showSleepMenu, setShowSleepMenu] = useState(false);
    const [sleepMode, setSleepMode] = useState<'off' | '15' | '30' | '45' | '60' | 'track' | 'end'>('off');
    const sleepTimeout = useRef<ReturnType<typeof setTimeout>>();
    const [videoFit, setVideoFit] = useState<'contain' | 'cover'>('contain');
    const [audioOnly, setAudioOnly] = useState(false);
    const [videoOrientation, setVideoOrientation] = useState<'portrait' | 'landscape'>('portrait');
    const [skipFeedback, setSkipFeedback] = useState<'backward' | 'forward' | null>(null);
    const [thumbnailFailed, setThumbnailFailed] = useState(false);

    useEffect(() => setThumbnailFailed(false), [file.id]);

    // Fetch fresh file details to get latest progress
    const { data: extendedFile } = useFile(file.id);
    const { mutate: updateProgress } = useUpdateProgress();

    const isVideo = file.file_type === 'video';
    const hasQueue = playQueue.length > 0;

    // Auto-ensure public link exists for VLC/Download/Copy
    useEffect(() => {
        const ensurePublicLink = async () => {
            const fileData = extendedFile || file;
            if (fileData.public_stream_url) {
                setPublicUrl(getAbsoluteUrl(fileData.public_stream_url));
            } else {
                try {
                    const { data } = await api.post<TelegramFile>(`/files/${file.id}/share`);
                    if (data.public_stream_url) {
                        setPublicUrl(getAbsoluteUrl(data.public_stream_url));
                    }
                } catch (err) {
                    console.error('Failed to create public link:', err);
                }
            }
        };
        ensurePublicLink();
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

    const toggleFullscreen = () => {
        if (!document.fullscreenElement) {
            containerRef.current?.requestFullscreen();
            setIsFullscreen(true);
        } else {
            document.exitFullscreen();
            setIsFullscreen(false);
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
        if (videoRef.current) {
            videoRef.current.playbackRate = nextSpeed;
        }
        setShowSpeedMenu(false);
    };

    const toggleVideoOrientation = async () => {
        const next = videoOrientation === 'portrait' ? 'landscape' : 'portrait';
        const orientation = screen.orientation as ScreenOrientation & { lock?: (value: string) => Promise<void>; unlock?: () => void };
        if (!orientation?.lock) {
            addToast('چرخش خودکار صفحه در این مرورگر پشتیبانی نمی‌شود.', 'error');
            return;
        }
        try {
            (window as Window & { Telegram?: { WebApp?: { requestFullscreen?: () => void } } }).Telegram?.WebApp?.requestFullscreen?.();
            if (!document.fullscreenElement) await containerRef.current?.requestFullscreen();
            await orientation.lock(next === 'landscape' ? 'landscape-primary' : 'portrait-primary');
            setVideoOrientation(next);
            setIsFullscreen(Boolean(document.fullscreenElement));
        } catch {
            addToast('برای چرخش صفحه، اجازهٔ تمام‌صفحه را فعال کن.', 'error');
        }
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
        }
    };

    const handleLoadedMetadata = () => {
        if (videoRef.current) {
            const nextDuration = Number.isFinite(videoRef.current.duration) ? Math.max(0, videoRef.current.duration) : 0;
            setDuration(nextDuration);
            setCurrentTime(current => nextDuration > 0 ? Math.min(current, nextDuration) : current);
            videoRef.current.playbackRate = playbackSpeed;
            setIsLoading(false);
        }
    };

    const handleWaiting = () => setIsLoading(true);
    const handlePlaying = () => { backgroundPlaybackRequested.current = true; setIsLoading(false); setIsPlaying(true); };
    const handlePause = () => { if (!document.hidden) backgroundPlaybackRequested.current = false; setIsPlaying(false); };

    const handleEnded = () => {
        saveProgress();
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
        if (!playNext()) setIsPlaying(false);
    };

    const handleError = () => {
        if (videoRef.current?.error) {
            const code = videoRef.current.error.code;
            if (code === 3 || code === 4) { // MEDIA_ERR_DECODE or MEDIA_ERR_SRC_NOT_SUPPORTED
                setError(`مرورگر نمی‌تواند فرمت این ${isVideo ? 'ویدیو' : 'فایل صوتی'} را پخش کند.`);
            } else {
                setError('هنگام دریافت یا پخش فایل مشکلی پیش آمد.');
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
        return () => {
            document.removeEventListener('visibilitychange', keepPlaybackAlive);
            window.removeEventListener('pageshow', keepPlaybackAlive);
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
        setShowControls(true);
        if (hideControlsTimeout.current) {
            clearTimeout(hideControlsTimeout.current);
        }
        hideControlsTimeout.current = setTimeout(() => {
            if (!isMinimized) {
                setShowControls(false);
                setShowSpeedMenu(false);
            }
        }, 3000);
    }, [isMinimized]);

    const showSkipFeedback = (direction: 'backward' | 'forward') => {
        setSkipFeedback(direction);
        if (feedbackTimeout.current) clearTimeout(feedbackTimeout.current);
        feedbackTimeout.current = setTimeout(() => setSkipFeedback(null), 650);
    };

    const handlePlayerPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        const target = event.target as HTMLElement;
        if (target.closest('button, input, a, [role="menu"]')) return;

        revealControls();
        if (event.pointerType !== 'touch') {
            togglePlay();
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
            setShowControls(true);
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
    const cleanFileName = (extendedFile?.file_name || file.file_name).replace(/^[a-f\d]{24,}[-_. ]+/i, '').trim() || file.file_name;
    const queuePosition = hasQueue && queueIndex >= 0 ? queueIndex + 1 : 1;
    const queueLength = hasQueue ? playQueue.length : 1;
    const token = localStorage.getItem('access_token');

    const getAbsoluteUrl = (url: string) => {
        if (!url) return '';
        if (url.startsWith('http')) return url;
        return `${window.location.origin}${url}`;
    };

    const isOfflineSource = file.stream_url.startsWith('blob:');
    const relativeStreamUrl = isOfflineSource ? file.stream_url : `${file.stream_url}${file.stream_url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token || '')}`;
    const authorizedStreamUrl = isOfflineSource ? relativeStreamUrl : getAbsoluteUrl(relativeStreamUrl);
    const externalUrl = publicUrl || authorizedStreamUrl;
    const vlcUrl = `vlc://${externalUrl}`;

    // Authorized Thumbnail URL
    const relativeThumbnailUrl = file.thumbnail_url ? `${file.thumbnail_url}${file.thumbnail_url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token || '')}` : null;
    const authorizedThumbnailUrl = relativeThumbnailUrl ? getAbsoluteUrl(relativeThumbnailUrl) : null;

    useEffect(() => {
        if (!('mediaSession' in navigator)) return;
        navigator.mediaSession.metadata = new MediaMetadata({
            title: cleanFileName,
            artist: 'کمد',
            album: hasQueue ? `صف پخش · ${queuePosition.toLocaleString('fa-IR')} از ${queueLength.toLocaleString('fa-IR')}` : 'کمد',
            artwork: authorizedThumbnailUrl ? [{ src: authorizedThumbnailUrl }] : undefined,
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

    // Common Media Element
    const MediaElement = isVideo ? (
        <video
            key={file.id}
            ref={videoRef}
            src={authorizedStreamUrl}
            className={`max-w-full max-h-full w-full h-full ${videoFit === 'cover' ? 'object-cover' : 'object-contain'} ${isMinimized ? 'hidden' : ''} ${audioOnly ? 'invisible' : 'visible'}`}
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
            className={`${isMinimized ? 'mini-player' : 'video-player'} fixed z-[120] transition-all duration-300 ease-in-out ${
                isMinimized 
                    ? 'bottom-[calc(5rem+env(safe-area-inset-bottom))] left-0 right-0 h-20 border-t border-white/10 bg-dark-900 shadow-2xl md:bottom-0'
                : 'inset-0 bg-black flex items-center justify-center font-sans'
            }`}
            style={!isMinimized && !isVideo ? ({ backgroundImage: authorizedThumbnailUrl ? `linear-gradient(135deg, rgba(8,10,20,.96), rgba(38,12,54,.84)), url(${authorizedThumbnailUrl})` : 'linear-gradient(135deg, #080a14, #260c36)', backgroundPosition: 'center', backgroundSize: 'cover' }) : undefined}
            onMouseMove={!isMinimized ? revealControls : undefined}
            onPointerUp={!isMinimized ? handlePlayerPointerUp : undefined}
            onDoubleClick={!isMinimized ? toggleFullscreen : undefined}
        >
            {/* Media Element - Always present */}
            <div className={`w-full h-full ${isMinimized ? 'hidden' : 'flex items-center justify-center'}`}>
                {error ? (
                    <div className="text-center p-8 max-w-md glass-panel z-10 animate-scale-in">
                        <div className="w-16 h-16 rounded-2xl bg-yellow-500/20 flex items-center justify-center mx-auto mb-5 border border-yellow-500/30">
                            <AlertTriangle className="w-8 h-8 text-yellow-400" />
                        </div>
                        <h3 className="text-xl font-bold text-white mb-2">پخش این فایل در مرورگر ممکن نیست</h3>
                        <p className="text-dark-300 mb-6">{error}</p>

                        <div className="flex flex-col gap-3">
                            <a
                                href={vlcUrl}
                                className="btn-primary flex items-center justify-center gap-2"
                            >
                                <ExternalLink className="w-4 h-4" />
                                باز کردن در VLC
                            </a>
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
                        <button
                            onClick={onClose}
                            className="mt-6 text-dark-400 hover:text-white text-sm transition-colors"
                        >
                            بستن
                        </button>
                    </div>
                ) : (
                    <>
                        {/* Audio Visualization / Thumbnail for non-video files in Fullscreen */}
                        {(!isVideo || audioOnly) && !isMinimized && (
                            <div className="absolute inset-x-4 top-16 bottom-44 z-10 flex flex-col items-center justify-center text-center animate-scale-in">
                                {authorizedThumbnailUrl && !audioOnly && !thumbnailFailed ? (
                                    <div className="mb-6 h-48 w-48 overflow-hidden rounded-2xl bg-dark-800 shadow-[0_12px_30px_rgba(0,0,0,.35)] sm:h-56 sm:w-56">
                                         <img 
                                            src={authorizedThumbnailUrl} 
                                            alt={file.file_name} 
                                            className="h-full w-full object-cover"
                                            onError={() => setThumbnailFailed(true)}
                                         />
                                    </div>
                                ) : (
                                    <div className="relative mb-6 flex h-48 w-48 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-primary-500/20 to-pink-500/20 shadow-[0_12px_30px_rgba(0,0,0,.35)] sm:h-56 sm:w-56">
                                         <div className="absolute inset-0 bg-gradient-to-tr from-primary-500/10 to-transparent animate-pulse"></div>
                                        {audioOnly ? <Headphones className="h-24 w-24 text-primary-300 drop-shadow-lg" /> : <span className="text-8xl transform transition-transform duration-500 group-hover:scale-125 drop-shadow-lg">🎵</span>}
                                    </div>
                                )}
                                <p dir="auto" className="max-w-[80vw] truncate text-2xl font-bold text-white drop-shadow-md">{cleanFileName}</p>
                                {audioOnly && <p className="mb-2 text-sm text-dark-300">حالت فقط صدا فعاله</p>}
                                <p className="text-primary-400 font-medium">{formatDuration(safeCurrentTime)} / {formatDuration(safeDuration)}</p>
                            </div>
                        )}
                        
                        {MediaElement}

                        {/* Loading Spinner */}
                        {isLoading && !error && !isMinimized && (
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                                <div className="animate-spin rounded-full h-16 w-16 border-b-2 border-primary-500"></div>
                            </div>
                        )}
                        {skipFeedback && !isMinimized && (
                            <div className={`pointer-events-none absolute top-1/2 z-40 -translate-y-1/2 rounded-full bg-black/60 px-5 py-3 text-sm font-bold text-white backdrop-blur ${skipFeedback === 'forward' ? 'right-[18%]' : 'left-[18%]'}`}>
                                {skipFeedback === 'forward' ? '۱۰ ثانیه جلو ⏩' : '⏪ ۱۰ ثانیه عقب'}
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Minimized Controls */}
            {isMinimized && (
                <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 sm:gap-4 p-3 h-full">
                    <div className="flex items-center gap-3 overflow-hidden flex-1 cursor-pointer" onClick={() => setMinimized(false)}>
                         {/* Thumbnail/Icon */}
                        <div className="w-12 h-12 rounded-lg bg-dark-800 flex items-center justify-center flex-shrink-0 overflow-hidden border border-white/5 relative">
                            {authorizedThumbnailUrl && !thumbnailFailed ? (
                                <img src={authorizedThumbnailUrl} alt="Thumb" className="w-full h-full object-cover" onError={() => setThumbnailFailed(true)} />
                            ) : (
                                isVideo ? <span className="text-2xl">🎬</span> : <span className="text-2xl">🎵</span>
                            )}
                        </div>
                        <div className="truncate flex-1 min-w-0">
                            <h4 dir="auto" className="text-sm font-bold text-white truncate leading-tight">{cleanFileName}</h4>
                            <p className="text-xs text-dark-400 font-mono">{formatDuration(safeCurrentTime)} / {formatDuration(safeDuration)}</p>
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
                         <button onClick={() => setMinimized(false)} className="p-2 text-dark-400 hover:text-white" title="بزرگ‌نمایی">
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

            {/* Fullscreen Controls overlay */}
            {!error && !isMinimized && (
                <div
                    className={`absolute inset-0 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 cursor-none'}`}
                    style={{ pointerEvents: showControls ? 'auto' : 'none' }}
                    onPointerDown={revealControls}
                >
                    {/* Top bar */}
                    <div data-player-controls className="absolute top-0 left-0 right-0 p-3 sm:p-4 bg-gradient-to-b from-black/80 to-transparent flex items-center justify-between gap-3 z-30">
                        <div className="min-w-0 flex-1">
                            <h3 dir="auto" className="text-base sm:text-lg font-medium truncate text-white">{cleanFileName}</h3>
                        </div>
                        {hasQueue && <p dir="rtl" className="absolute left-1/2 top-3 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/10 bg-black/35 px-3 py-1.5 text-xs font-semibold tracking-wide text-primary-200 backdrop-blur sm:top-4">ترک <span className="text-white">{queuePosition.toLocaleString('fa-IR')}</span> از <span className="text-white">{queueLength.toLocaleString('fa-IR')}</span></p>}
                        <div className="flex items-center gap-2">
                             <button
                                onClick={() => setMinimized(true)}
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
                        </div>
                    </div>

                    {/* Secondary tools stay away from the transport controls. */}
                    <div data-player-controls className="absolute left-1/2 top-20 z-40 flex max-w-[calc(100%-1rem)] -translate-x-1/2 items-center gap-1 rounded-2xl border border-white/10 bg-black/45 p-1.5 shadow-xl backdrop-blur-md">
                        {isVideo && hasQueue && <button onClick={shuffleQueue} className="rounded-lg p-2 text-white/80 hover:bg-white/10" title="شافل صف پخش"><Shuffle className="h-5 w-5" /></button>}
                        {isVideo && <button onClick={() => setRepeatMode(repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off')} className={`relative rounded-lg p-2 ${repeatMode !== 'off' ? 'bg-primary-500/20 text-primary-300' : 'text-white/80 hover:bg-white/10'}`} title="حالت تکرار"><Repeat2 className="h-5 w-5" />{repeatMode === 'one' && <span className="absolute -left-0.5 -top-0.5 text-[9px] font-bold">۱</span>}</button>}
                        {!isVideo && <button onClick={() => setPlaylistFile(file)} className="rounded-lg p-2 text-white/80 hover:bg-white/10" title="افزودن به پلی‌لیست"><ListPlus className="h-5 w-5" /></button>}
                        {!isVideo && <button onClick={() => handleSkip(-10)} className="rounded-lg p-2 text-white/80 hover:bg-white/10" title="۱۰ ثانیه عقب"><RotateCcw className="h-5 w-5" /></button>}
                        <div className="relative">
                            <button onClick={() => setShowSpeedMenu(open => !open)} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm font-medium transition-all ${playbackSpeed !== 1 ? 'border-primary-500/40 bg-primary-500/30 text-primary-300' : 'border-white/10 bg-white/10 text-white/80 hover:bg-white/20'}`} title="انتخاب سرعت پخش" aria-expanded={showSpeedMenu}><Gauge className="w-4 h-4" /><span>{playbackSpeed === 1 ? '1.0' : playbackSpeed}x</span></button>
                            {showSpeedMenu && <div role="menu" aria-label="سرعت پخش" className="absolute left-1/2 top-full mt-2 w-32 -translate-x-1/2 overflow-hidden rounded-xl border border-white/10 bg-dark-900/95 p-1.5 shadow-2xl backdrop-blur-md">{[0.75, 1, 1.25, 1.5, 2].map(speed => <button key={speed} role="menuitem" onClick={() => setSpeed(speed)} className={`block w-full rounded-lg px-3 py-2 text-center text-sm transition-colors ${playbackSpeed === speed ? 'bg-primary-500/25 text-primary-200' : 'text-white/80 hover:bg-white/10'}`}>{speed === 1 ? '1.0' : speed}x</button>)}</div>}
                        </div>
                        {!isVideo && <button onClick={() => handleSkip(10)} className="rounded-lg p-2 text-white/80 hover:bg-white/10" title="۱۰ ثانیه جلو"><RotateCw className="h-5 w-5" /></button>}
                        <div className="relative">
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
                        </div>
                        {isVideo && <button onClick={() => setVideoFit(current => current === 'contain' ? 'cover' : 'contain')} className={`p-2 rounded-lg transition-all ${videoFit === 'cover' ? 'bg-primary-500/30 text-primary-300' : 'hover:bg-white/10 text-white/80'}`} title={videoFit === 'contain' ? 'پر کردن قاب ویدیو' : 'نمایش کامل ویدیو'}><Scaling className="w-5 h-5" /></button>}
                        {isVideo && <button onClick={() => setAudioOnly(current => !current)} className={`p-2 rounded-lg transition-all ${audioOnly ? 'bg-primary-500/30 text-primary-300' : 'hover:bg-white/10 text-white/80'}`} title={audioOnly ? 'بازگشت به پخش ویدیو' : 'پخش فقط صدا'}><Headphones className="w-5 h-5" /></button>}
                        {isVideo && <button onClick={() => void toggleVideoOrientation()} className={`rounded-lg p-2 transition-all ${videoOrientation === 'landscape' ? 'bg-primary-500/30 text-primary-300' : 'text-white/80 hover:bg-white/10'}`} title={videoOrientation === 'portrait' ? 'چرخش واقعی به حالت افقی' : 'بازگشت به حالت عمودی'}><RectangleHorizontal className="h-5 w-5"/></button>}
                        {isVideo && document.pictureInPictureEnabled && <button onClick={togglePiP} className={`p-2 rounded-lg transition-all ${isPiP ? 'bg-primary-500/30 text-primary-300' : 'hover:bg-white/10 text-white/80'}`} title="تصویر در تصویر"><PictureInPicture2 className="w-5 h-5" /></button>}
                        <button onClick={toggleFullscreen} className="p-2 rounded-lg hover:bg-white/10 text-white/80" title={isFullscreen ? 'خروج از تمام‌صفحه' : 'تمام‌صفحه'}>{isFullscreen ? <Minimize className="w-5 h-5" /> : <Maximize className="w-5 h-5" />}</button>
                    </div>

                    {/* Transport controls: queue navigation for music, seeking for video. */}
                    <div data-player-controls dir="ltr" className={`absolute left-1/2 z-30 flex -translate-x-1/2 items-center ${isVideo ? 'top-1/2 -translate-y-1/2 gap-24' : 'bottom-32 gap-8 sm:gap-12'}`}>
                        <button disabled={!isVideo && !hasQueue} onClick={(e) => { e.stopPropagation(); isVideo ? handleSkip(-10) : playPrevious(); }} className="rounded-full p-3 text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-30" title={isVideo ? '۱۰ ثانیه عقب' : 'ترک قبلی'}>{isVideo ? <RotateCcw className="h-7 w-7"/> : <SkipBack className="h-7 w-7"/>}</button>
                        {!isVideo && <button onClick={(e) => { e.stopPropagation(); togglePlay(e); }} className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-500 text-white shadow-xl shadow-primary-500/30 transition hover:scale-105 hover:bg-primary-400">{isPlaying ? <Pause className="h-9 w-9"/> : <Play className="ml-1 h-9 w-9"/>}</button>}
                        <button disabled={!isVideo && !hasQueue} onClick={(e) => { e.stopPropagation(); isVideo ? handleSkip(10) : playNext(); }} className="rounded-full p-3 text-white/70 transition hover:bg-white/10 hover:text-white disabled:opacity-30" title={isVideo ? '۱۰ ثانیه جلو' : 'ترک بعدی'}>{isVideo ? <RotateCw className="h-7 w-7"/> : <SkipForward className="h-7 w-7"/>}</button>
                    </div>

                    {/* Bottom controls */}
                    <div data-player-controls className="absolute bottom-0 left-0 right-0 p-3 sm:p-6 bg-gradient-to-t from-black/95 via-black/70 to-transparent z-30">
                        {/* Progress bar */}
                        <div className="flex items-center gap-4 mb-4 group/progress">
                            <span className="text-sm font-medium text-white/90 min-w-[50px] font-mono">{formatDuration(Math.floor(safeCurrentTime))}</span>
                            <div className="relative flex-1 h-1 bg-white/20 rounded-full cursor-pointer group-hover/progress:h-2 transition-all">
                                {/* Buffered progress can be added here */}
                                <div
                                    className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary-500 to-primary-400 rounded-full transition-all"
                                    style={{ width: `${progressPercent}%` }}
                                >
                                    <div className="absolute right-0 top-1/2 transform -translate-y-1/2 w-4 h-4 bg-white rounded-full opacity-0 group-hover/progress:opacity-100 transition-all shadow-lg shadow-primary-500/50 scale-75 group-hover/progress:scale-100"></div>
                                </div>
                                <input
                                    type="range"
                                    min={0}
                                    max={safeDuration || 100}
                                    value={safeCurrentTime}
                                    onChange={handleSeek}
                                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                />
                            </div>
                            <span className="text-sm font-medium text-white/90 min-w-[50px] text-right font-mono">{formatDuration(Math.floor(safeDuration))}</span>
                        </div>

                        {/* Control buttons */}
                        <div dir="ltr" className="flex items-center justify-between gap-3">
                            {!isVideo ? <div className="flex items-center gap-1"><button disabled={!hasQueue} onClick={shuffleQueue} className="rounded-full p-2 text-white/75 hover:bg-white/10 disabled:opacity-30" title="شافل"><Shuffle className="h-5 w-5"/></button><button onClick={() => setRepeatMode(repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off')} className={`rounded-full p-2 ${repeatMode !== 'off' ? 'bg-primary-500/25 text-primary-200' : 'text-white/75 hover:bg-white/10'}`} title="تکرار"><Repeat2 className="h-5 w-5"/></button></div> : <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-2xl bg-black/45 p-1.5 backdrop-blur"><button disabled={!hasQueue} onClick={playPrevious} className="rounded-lg p-2.5 text-white/80 hover:bg-white/10 disabled:opacity-30" title="فایل قبلی"><SkipBack className="h-6 w-6"/></button><button onClick={togglePlay} className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-500 text-white shadow-lg">{isPlaying ? <Pause className="h-6 w-6"/> : <Play className="ml-0.5 h-6 w-6"/>}</button><button disabled={!hasQueue} onClick={playNext} className="rounded-lg p-2.5 text-white/80 hover:bg-white/10 disabled:opacity-30" title="فایل بعدی"><SkipForward className="h-6 w-6"/></button></div>}
                            <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2 group/vol">
                                <button
                                    onClick={toggleMute}
                                    className="p-2 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-all"
                                >
                                    {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                                </button>
                                <div className="desktop-volume-slider w-0 overflow-hidden group-hover/vol:w-24 transition-all duration-300">
                                    <input
                                        type="range"
                                        min={0}
                                        max={1}
                                        step={0.05}
                                        value={isMuted ? 0 : volume}
                                        onChange={handleVolumeChange}
                                        className="w-20 h-1 bg-white/30 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg"
                                    />
                                </div>
                            </div>
                            {/* Volume */}
                            <div className="hidden">
                                <div className="flex items-center gap-2 group/vol">
                                    <button
                                        onClick={toggleMute}
                                        className="p-2 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-all"
                                    >
                                        {isMuted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                                    </button>
                                    <div className="desktop-volume-slider w-0 overflow-hidden group-hover/vol:w-24 transition-all duration-300">
                                        <input
                                            type="range"
                                            min={0}
                                            max={1}
                                            step={0.05}
                                            value={isMuted ? 0 : volume}
                                            onChange={handleVolumeChange}
                                            className="w-20 h-1 bg-white/30 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-lg"
                                        />
                                    </div>
                                </div>
                            </div>

                            <div className="hidden">
                                {hasQueue && <button onClick={shuffleQueue} className="p-2 rounded-lg hover:bg-white/10 text-white/80 hover:text-white" title="شافل صف پخش"><Shuffle className="h-5 w-5" /></button>}
                                {hasQueue && <button onClick={() => setRepeatMode(repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off')} className={`relative p-2 rounded-lg transition-colors ${repeatMode !== 'off' ? 'bg-primary-500/20 text-primary-300' : 'hover:bg-white/10 text-white/80'}`} title={repeatMode === 'off' ? 'تکرار خاموش' : repeatMode === 'all' ? 'تکرار همه' : 'تکرار همین مورد'}><Repeat2 className="h-5 w-5" />{repeatMode === 'one' && <span className="absolute -left-0.5 -top-0.5 text-[9px] font-bold">۱</span>}</button>}
                                {/* Speed */}
                                <div className="relative">
                                    {showSpeedMenu && (
                                        <div role="menu" aria-label="سرعت پخش" className="absolute bottom-full right-0 mb-2 w-32 overflow-hidden rounded-xl border border-white/10 bg-dark-900/95 p-1.5 shadow-2xl backdrop-blur-md">
                                            {[0.75, 1, 1.25, 1.5, 2].map(speed => (
                                                <button
                                                    key={speed}
                                                    role="menuitem"
                                                    onClick={() => setSpeed(speed)}
                                                    className={`block w-full rounded-lg px-3 py-2 text-center text-sm transition-colors ${playbackSpeed === speed ? 'bg-primary-500/25 text-primary-200' : 'text-white/80 hover:bg-white/10 hover:text-white'}`}
                                                >
                                                    {speed === 1 ? '1.0' : speed}x
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    <button
                                        onClick={() => setShowSpeedMenu(open => !open)}
                                        className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${playbackSpeed !== 1
                                            ? 'bg-primary-500/30 text-primary-300 border border-primary-500/40'
                                            : 'bg-white/10 text-white/80 border border-white/10 hover:bg-white/20 hover:text-white'
                                            }`}
                                        title="انتخاب سرعت پخش"
                                        aria-expanded={showSpeedMenu}
                                    >
                                        <Gauge className="w-4 h-4" />
                                        <span>{playbackSpeed === 1 ? '1.0' : playbackSpeed}x</span>
                                    </button>
                                </div>

                                {isVideo && (
                                    <button
                                        onClick={() => setVideoFit(current => current === 'contain' ? 'cover' : 'contain')}
                                        className={`p-2 rounded-lg transition-all ${videoFit === 'cover' ? 'bg-primary-500/30 text-primary-300' : 'hover:bg-white/10 text-white/80 hover:text-white'}`}
                                        title={videoFit === 'contain' ? 'پر کردن قاب ویدیو' : 'نمایش کامل ویدیو'}
                                    >
                                        <Scaling className="w-5 h-5" />
                                    </button>
                                )}

                                {isVideo && (
                                    <button
                                        onClick={() => setAudioOnly(current => !current)}
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
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Helper button component for cleaner code
function Button({ onClick, className, children }: { onClick?: (e: any) => void, className?: string, children: React.ReactNode }) {
    return (
        <button onClick={onClick} className={className}>
            {children}
        </button>
    );
}
