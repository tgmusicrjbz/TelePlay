import { Routes, Route, Navigate, useSearchParams, useNavigate } from 'react-router-dom';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, AuthResponse, getKomodDeviceId, isTwoFactorChallenge, resolveServerUrl, useCurrentUser, useLoginWithCode, usePasswordLogin, useRegisterAccount, useBotInfo, useGenerateLoginCode } from './lib/api';
import PwaManager from './components/PwaManager';
import OfflineDownloadProgressPanel from './components/OfflineDownloadProgress';
import { restoreSavedSession, saveAuthenticatedAccount } from './lib/accounts';
import { syncOfflineTextOutbox } from './lib/offline';
import { syncOfflineMutations } from './lib/offlineMutations';
import { useAppStore } from './lib/store';
import { checkServerReachability, isEffectivelyOnline, useConnectivity } from './lib/connectivity';
import { clearBrokenAppShell } from './lib/appRecovery';

function lazyWithRecovery(loader:()=>Promise<{default:()=>JSX.Element}>,key:string){
    return lazy(async()=>{
        const marker=`komod-lazy-retry:${key}`;
        try{const module=await loader();sessionStorage.removeItem(marker);return module}
        catch(error){
            if(navigator.onLine&&!sessionStorage.getItem(marker)){
                sessionStorage.setItem(marker,'1');
                await clearBrokenAppShell();
                const target=new URL(window.location.href);
                target.searchParams.set('recover',String(Date.now()));
                window.location.replace(target.toString());
            }
            throw error;
        }
    });
}
const GlobalContextMenu = lazyWithRecovery(() => import('./components/GlobalContextMenu'),'context-menu');
const MediaPlayer = lazyWithRecovery(() => import('./components/MediaPlayer'),'player');
const ContentPreview = lazyWithRecovery(() => import('./components/ContentPreview'),'preview');
const AddToPlaylistDialog = lazyWithRecovery(() => import('./components/AddToPlaylistDialog'),'playlist-dialog');
const FileDetailsSheet = lazyWithRecovery(() => import('./components/FileDetailsSheet'),'details');
const FileAIToolsModal = lazyWithRecovery(() => import('./components/FileAIToolsModal'),'file-ai-tools');
const PublicSharePage = lazyWithRecovery(() => import('./components/PublicSharePage'),'public-share');
const FileBrowser = lazyWithRecovery(() => import('./components/FileBrowser'),'file-browser');

function LazyFallback(){return <div dir="rtl" className="fixed inset-x-0 bottom-5 z-[400] mx-auto flex w-fit items-center gap-2 rounded-2xl border border-white/10 bg-dark-900/95 px-4 py-3 text-xs text-dark-200 shadow-2xl"><span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-300 border-t-transparent"/>در حال آماده‌سازی…</div>}

function DeferredOverlays() {
    const previewFile = useAppStore(state => state.previewFile);
    const contentPreviewFile = useAppStore(state => state.contentPreviewFile);
    const detailsFile = useAppStore(state => state.detailsFile);
    const aiToolsFile = useAppStore(state => state.aiToolsFile);
    const contextMenu = useAppStore(state => state.activeContextMenu);
    const playlistFile = useAppStore(state => state.playlistFile);
    const playlistFiles = useAppStore(state => state.playlistFiles);
    return <Suspense fallback={<LazyFallback/>}>
        {contextMenu && <GlobalContextMenu />}
        {previewFile && <MediaPlayer />}
        {contentPreviewFile && <ContentPreview />}
        {(playlistFile || playlistFiles.length > 0) && <AddToPlaylistDialog />}
        {detailsFile && <FileDetailsSheet />}
        {aiToolsFile && <FileAIToolsModal />}
    </Suspense>;
}

function PlayerCloudSync() {
    const connectivity = useConnectivity();
    const playQueue = useAppStore(state => state.playQueue);
    const queueIndex = useAppStore(state => state.queueIndex);
    const repeatMode = useAppStore(state => state.repeatMode);
    const startQueue = useAppStore(state => state.startQueue);
    const setRepeatMode = useAppStore(state => state.setRepeatMode);
    const setPlayerMinimized = useAppStore(state => state.setPlayerMinimized);
    const [hydrated, setHydrated] = useState(false);
    useEffect(() => {
        if (connectivity !== 'online') return;
        let cancelled = false;
        void api.get('/files/player-state').then(({data}) => {
            if (cancelled) return;
            if (!useAppStore.getState().playQueue.length && data.files?.length) {
                startQueue(data.files, Math.max(0, data.current_index));
                setRepeatMode(data.repeat_mode || 'off');
                setPlayerMinimized(true);
            }
        }).catch(() => undefined).finally(() => { if (!cancelled) setHydrated(true); });
        return () => { cancelled = true; };
    }, [connectivity, setPlayerMinimized, setRepeatMode, startQueue]);
    useEffect(() => {
        if (!hydrated || connectivity !== 'online') return;
        const timer = window.setTimeout(() => void api.put('/files/player-state', {
            file_ids: playQueue.map(item => item.id), current_index: queueIndex,
            repeat_mode: repeatMode, position: 0,
        }).catch(() => undefined), 900);
        return () => window.clearTimeout(timer);
    }, [connectivity, hydrated, playQueue, queueIndex, repeatMode]);
    return null;
}

function AuthCallback() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get('token');
    const [status, setStatus] = useState('در حال ورود به کمد…');
    const [saved, setSaved] = useState(false);
    const [otpRequired,setOtpRequired]=useState(false);
    const [otp,setOtp]=useState('');
    const [submitting,setSubmitting]=useState(false);

    const exchange=async(code?:string)=>{
        if(!token||submitting)return;
        setSubmitting(true);
        try{
            const {data}=await api.post<AuthResponse>('/auth/telegram-token',{token,otp:code||undefined});
            saveAuthenticatedAccount(data);
            setStatus('✅ ورود انجام شد؛ در حال باز کردن کمد…');
            setSaved(true);
            setTimeout(()=>navigate('/',{replace:true}),500);
        }catch(error:any){
            const detail=String(error?.response?.data?.detail||'ورود انجام نشد. دوباره از ربات وارد شو.');
            if(isTwoFactorChallenge(error)){setOtpRequired(true);setStatus('کد برنامهٔ تأیید را وارد کن.');}
            else setStatus(`❌ ${detail}`);
        }finally{setSubmitting(false)}
    };

    useEffect(() => {
        if(token)void exchange();
        else setStatus('❌ اطلاعات ورود در این پیوند وجود ندارد.');
        // The initial exchange must only run once for this link.
    }, [token]);

    // If saved but still on this page, try redirect again
    useEffect(() => {
        if (saved) {
            const timer = setTimeout(() => {
                window.location.href = '/';
            }, 1500);
            return () => clearTimeout(timer);
        }
    }, [saved]);

    return (
        <div dir="rtl" className="min-h-screen flex items-center justify-center bg-dark-950 p-4">
            <div className="text-center max-w-lg">
                {!otpRequired&&<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4"></div>}
                <p className="text-white text-lg mb-4">{status}</p>
                {otpRequired&&!saved&&<form className="mx-auto mt-4 max-w-xs space-y-3" onSubmit={event=>{event.preventDefault();void exchange(otp)}}><input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={otp} onChange={event=>setOtp(event.target.value.replace(/\D/g,'').slice(0,6))} className="input w-full text-center font-mono tracking-[.35em]" placeholder="کد ۶ رقمی"/><button disabled={otp.length!==6||submitting} className="btn-primary min-h-11 w-full disabled:opacity-40">{submitting?'در حال بررسی…':'تأیید و ورود'}</button></form>}

                {token && !saved && <a href="/login" className="btn-secondary mt-4 inline-block">بازگشت به صفحه ورود</a>}
            </div>
        </div>
    );
}

function TelegramWebAppBootstrap({ children }: { children: React.ReactNode }) {
    const [ready, setReady] = useState(() => Boolean(localStorage.getItem('access_token')));
    const [pendingInitData,setPendingInitData]=useState<string|null>(null);
    const [telegramOtp,setTelegramOtp]=useState('');
    const [telegramOtpError,setTelegramOtpError]=useState<string|null>(null);
    const [telegramOtpBusy,setTelegramOtpBusy]=useState(false);
    const twoFactorPending=useRef(false);
    useEffect(() => {
        let cancelled = false;
        let syncing = false;
        const telegramIdentity = () => {
            const webApp = (window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp;
            const initData = webApp?.initData;
            if (!initData) return null;
            try {
                const rawUser = new URLSearchParams(initData).get('user');
                const userId = rawUser ? String(JSON.parse(rawUser).id || '') : '';
                return userId ? { initData, userId } : null;
            } catch { return null; }
        };
        const sync = async () => {
            if(twoFactorPending.current)return;
            if (!await checkServerReachability()) { if (!cancelled) setReady(true); return; }
            const identity = telegramIdentity();
            if (!identity) { if (!cancelled) setReady(true); return; }
            const currentId = localStorage.getItem('komod-telegram-user-id');
            const previousInitData = localStorage.getItem('komod-telegram-init-data');
            const manualAccount = localStorage.getItem('komod-manual-account');
            if (manualAccount && previousInitData === identity.initData && localStorage.getItem('access_token')) {
                if (!cancelled) setReady(true);
                return;
            }
            if (previousInitData !== identity.initData) localStorage.removeItem('komod-manual-account');
            if (currentId === identity.userId && localStorage.getItem('access_token')) {
                localStorage.setItem('komod-telegram-init-data', identity.initData);
                try {
                    const { data } = await api.post<AuthResponse>('/auth/session');
                    saveAuthenticatedAccount(data);
                } catch {
                    // Keep the existing local session when the network is unstable.
                }
                if (!cancelled) setReady(true);
                return;
            }
            if (syncing) return;
            syncing = true;
            // Keep the last working account until Telegram authentication for the
            // newly detected account succeeds. This makes transient/offline opens
            // safe instead of leaving the app without a usable local session.
            if (!cancelled && !localStorage.getItem('access_token')) setReady(false);
            const controller = new AbortController();
            const timeout = window.setTimeout(() => controller.abort(), 12000);
            try {
                const response = await fetch(resolveServerUrl('/api/auth/telegram-webapp'), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'X-Komod-Device-ID': getKomodDeviceId() },
                    body: JSON.stringify({ init_data: identity.initData }),
                    signal: controller.signal,
                });
                if (!response.ok){
                    const payload=await response.json().catch(()=>({detail:'ورود تلگرام انجام نشد.'})) as {detail?:string};
                    if(response.status===401&&String(payload.detail||'').includes('تأیید دومرحله‌ای')){
                        twoFactorPending.current=true;
                        if(!cancelled){setPendingInitData(identity.initData);setTelegramOtpError(null);setReady(false)}
                        return;
                    }
                    throw new Error(payload.detail||'Telegram authentication failed');
                }
                const data = await response.json() as AuthResponse;
                saveAuthenticatedAccount(data);
                localStorage.setItem('komod-telegram-user-id', identity.userId);
                localStorage.setItem('komod-telegram-init-data', identity.initData);
                localStorage.removeItem('komod-manual-account');
                localStorage.removeItem('komod-active-workspace');
                if (!cancelled) window.location.replace('/');
            } catch {
                if (!cancelled) setReady(true);
            } finally {
                window.clearTimeout(timeout);
                syncing = false;
            }
        };
        void sync();
        const onVisible = () => { if (!document.hidden) void sync(); };
        const onOnline = () => void sync();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', onOnline);
        window.addEventListener('komod-telegram-ready', onOnline);
        return () => {
            cancelled = true;
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', onOnline);
            window.removeEventListener('komod-telegram-ready', onOnline);
        };
    }, []);
    const submitTelegramOtp=async(event:React.FormEvent)=>{
        event.preventDefault();
        if(!pendingInitData||telegramOtp.length!==6||telegramOtpBusy)return;
        setTelegramOtpBusy(true);setTelegramOtpError(null);
        try{
            const {data}=await api.post<AuthResponse>('/auth/telegram-webapp',{init_data:pendingInitData,otp:telegramOtp},{headers:{'X-Komod-Device-ID':getKomodDeviceId()}});
            saveAuthenticatedAccount(data);
            const rawUser=new URLSearchParams(pendingInitData).get('user');
            const userId=rawUser?String(JSON.parse(rawUser).id||''):'';
            if(userId)localStorage.setItem('komod-telegram-user-id',userId);
            localStorage.setItem('komod-telegram-init-data',pendingInitData);
            localStorage.removeItem('komod-manual-account');
            twoFactorPending.current=false;
            window.location.replace('/');
        }catch(error:any){setTelegramOtpError(error?.response?.data?.detail||'کد تأیید درست نیست.')}
        finally{setTelegramOtpBusy(false)}
    };
    if(pendingInitData)return <div className="flex min-h-screen items-center justify-center bg-dark-950 p-4" dir="rtl"><form onSubmit={submitTelegramOtp} className="glass-card w-full max-w-sm p-6 text-center"><h1 className="text-lg font-bold">تأیید دومرحله‌ای</h1><p className="mt-2 text-xs leading-6 text-dark-400">کد ۶ رقمی برنامهٔ تأیید را برای ورود با تلگرام وارد کن.</p><input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={telegramOtp} onChange={event=>setTelegramOtp(event.target.value.replace(/\D/g,'').slice(0,6))} className="input mt-5 w-full text-center font-mono tracking-[.35em]" placeholder="کد ۶ رقمی"/><button disabled={telegramOtp.length!==6||telegramOtpBusy} className="btn-primary mt-3 min-h-11 w-full disabled:opacity-40">{telegramOtpBusy?'در حال بررسی…':'تأیید و ورود'}</button>{telegramOtpError&&<p className="mt-3 text-xs text-red-300">{telegramOtpError}</p>}</form></div>;
    if (!ready) return <div className="flex min-h-screen items-center justify-center bg-dark-950" dir="rtl"><div className="text-center"><div className="mx-auto mb-4 h-11 w-11 animate-spin rounded-full border-2 border-white/10 border-t-primary-400"/><p className="text-sm text-dark-300">در حال هماهنگ‌کردن حساب تلگرام…</p></div></div>;
    return <>{children}</>;
}

function OfflineTextSync() {
    const addToast = useAppStore(state=>state.addToast);
    const queryClient=useQueryClient();
    useEffect(() => {
        const sync = () => { if (isEffectivelyOnline()) { void syncOfflineTextOutbox(); void syncOfflineMutations(config=>api.request(config)); } };
        const reconnect = () => {
            if (!isEffectivelyOnline()) return;
            sync();
            void queryClient.invalidateQueries({ refetchType: 'active' });
        };
        const finished=(event:Event)=>{const result=(event as CustomEvent<{synced:number;conflicts:number}>).detail;if(result?.synced){addToast(`${result.synced.toLocaleString('fa-IR')} تغییر آفلاین همگام شد.`);void queryClient.invalidateQueries()}if(result?.conflicts)addToast(`${result.conflicts.toLocaleString('fa-IR')} تغییر به‌خاطر نسخه جدیدتر آنلاین اعمال نشد.`,'error')};
        sync();
        const timer = window.setInterval(sync, 30000);
        window.addEventListener('online', reconnect);
        window.addEventListener('komod-connectivity-changed', reconnect);
        window.addEventListener('komod-offline-sync-finished',finished);
        document.addEventListener('visibilitychange', sync);
        return () => { window.clearInterval(timer); window.removeEventListener('online', reconnect); window.removeEventListener('komod-connectivity-changed', reconnect); window.removeEventListener('komod-offline-sync-finished',finished); document.removeEventListener('visibilitychange', sync); };
    }, [addToast,queryClient]);
    return null;
}

function LoginPage() {
    const { mutate: loginByCode, isPending: isVerifying } = useLoginWithCode();
    const { mutate: generateCode, isPending: isGenerating } = useGenerateLoginCode();
    const passwordLogin = usePasswordLogin();
    const registerAccount = useRegisterAccount();

    const queryCode = new URLSearchParams(window.location.search).get('code')
        ?.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6) || '';
    const initialTelegramCode = queryCode.length === 6 ? queryCode : '';
    const [code, setCode] = useState(initialTelegramCode);
    const [codeSource, setCodeSource] = useState<'device'|'bot'>(initialTelegramCode ? 'bot' : 'device');
    const [isPolling, setIsPolling] = useState(Boolean(initialTelegramCode));
    const [error, setError] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const [loginMode, setLoginMode] = useState<'password'|'telegram'>(initialTelegramCode ? 'telegram' : 'password');
    const [loginUsername, setLoginUsername] = useState('');
    const [loginPassword, setLoginPassword] = useState('');
    const [loginOtp, setLoginOtp] = useState('');
    const [needsOtp, setNeedsOtp] = useState(false);
    const [telegramOtp,setTelegramOtp]=useState('');
    const [telegramNeedsOtp,setTelegramNeedsOtp]=useState(false);
    const [showTelegramCodeLogin,setShowTelegramCodeLogin]=useState(Boolean(initialTelegramCode));
    const [telegramCodeInput,setTelegramCodeInput]=useState(initialTelegramCode);
    const [commandCopied,setCommandCopied]=useState(false);
    const [accountMode,setAccountMode]=useState<'login'|'register'>('login');
    const [registerName,setRegisterName]=useState('');
    const [registerPasswordAgain,setRegisterPasswordAgain]=useState('');
    const pollBusy = useRef(false);
    const localRuntime = ['localhost', '127.0.0.1'].includes(window.location.hostname);

    // Initial code generation
    useEffect(() => {
        if (loginMode !== 'telegram' || code) return;
        generateCode(undefined, {
            onSuccess: (data) => {
                setCode(data.code);
                setCodeSource('device');
                setTelegramCodeInput('');
                setIsPolling(true);
            },
            onError: (err: any) => {
                setError(err.response?.data?.detail || 'ساخت کد ورود انجام نشد.');
            }
        });
    }, [generateCode, loginMode, code]);

    // Polling logic
    useEffect(() => {
        if (!isPolling || !code) return;
        let cancelled = false;
        let timer = 0;
        let networkFailures = 0;
        const poll = async () => {
            if (cancelled || pollBusy.current) return;
            pollBusy.current = true;
            try {
                const { data } = await api.post<AuthResponse>('/auth/verify-code', { code });
                if (cancelled) return;
                cancelled = true;
                saveAuthenticatedAccount(data);
                setIsPolling(false);
                if(sessionStorage.getItem('komod-password-recovery')==='1'){
                    sessionStorage.removeItem('komod-password-recovery');
                    localStorage.setItem('komod-settings-target','security');
                    localStorage.setItem('komod-open-settings-after-login','1');
                }
                window.location.replace('/');
            } catch (pollError: any) {
                if (cancelled) return;
                const detail = String(pollError?.response?.data?.detail || '');
                const status = Number(pollError?.response?.status || 0);
                if(status===401&&detail.includes('تأیید دومرحله‌ای')){
                    cancelled=true;
                    setIsPolling(false);
                    setTelegramNeedsOtp(true);
                    setError(null);
                    return;
                }
                if (status === 400 && /expired|invalid|منقضی|اعتبار.*تمام|معتبر نیست/i.test(detail)) {
                    cancelled = true;
                    setError('کد قبلی منقضی شد؛ یک کد تازه می‌سازیم…');
                    setIsPolling(false);
                    setCode('');
                    return;
                }
                if (!pollError?.response) {
                    networkFailures += 1;
                    if (networkFailures >= 3) setError('ارتباط با سرور ناپایدار است؛ بررسی ورود خودکار ادامه دارد.');
                } else if (!/not yet verified|هنوز.*تأیید نشده/i.test(detail)) {
                    setError(detail || 'بررسی کد ورود انجام نشد؛ دوباره تلاش می‌کنیم.');
                }
            } finally {
                pollBusy.current = false;
                if (!cancelled) timer = window.setTimeout(poll, 1800);
            }
        };
        void poll();
        return () => { cancelled = true; window.clearTimeout(timer); pollBusy.current = false; };
    }, [isPolling, code]);

    const handleManualLogin = (e: React.FormEvent) => {
        e.preventDefault();
        if (!code) return;

        loginByCode({code,otp:telegramNeedsOtp?telegramOtp:undefined}, {
            onSuccess: (data) => {
                saveAuthenticatedAccount(data);
                if(sessionStorage.getItem('komod-password-recovery')==='1'){
                    sessionStorage.removeItem('komod-password-recovery');
                    localStorage.setItem('komod-settings-target','security');
                    localStorage.setItem('komod-open-settings-after-login','1');
                }
                window.location.href = '/';
            },
            onError: (err: any) => {
                const detail=String(err.response?.data?.detail||'کد ورود معتبر نیست.');
                if(isTwoFactorChallenge(err))setTelegramNeedsOtp(true);
                setError(detail);
            }
        });
    };

    const handleTelegramCodeLogin = (event: React.FormEvent) => {
        event.preventDefault();
        const normalized = telegramCodeInput.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
        if (normalized.length !== 6) {
            setError('کد ۶ کاراکتری ربات را کامل وارد کن.');
            return;
        }
        setCode(normalized);
        setCodeSource('bot');
        setTelegramCodeInput(normalized);
        setTelegramNeedsOtp(false);
        setTelegramOtp('');
        setError(null);
        setIsPolling(true);
    };

    const copyLoginCommand = async () => {
        if (!code) return;
        try {
            await navigator.clipboard.writeText(`/login ${code}`);
            setCommandCopied(true);
            window.setTimeout(() => setCommandCopied(false), 1800);
        } catch {
            setError('کپی خودکار انجام نشد؛ دستور را با نگه‌داشتن روی آن کپی کن.');
        }
    };

    const handlePasswordLogin = (event: React.FormEvent) => {
        event.preventDefault();
        setError(null);
        setNotice(null);
        passwordLogin.mutate({ username: loginUsername.trim(), password: loginPassword, otp: needsOtp ? loginOtp : undefined }, {
            onSuccess: data => {
                saveAuthenticatedAccount(data);
                localStorage.setItem('komod-manual-account', String(data.user.telegram_id));
                window.location.href = '/';
            },
            onError: (err: any) => {
                const detail=String(err.response?.data?.detail||'');
                if(isTwoFactorChallenge(err)){setNeedsOtp(true);setLoginOtp('');setError('کد ۶ رقمی برنامهٔ تأیید را وارد کن.');return;}
                setError(detail||'ورود انجام نشد.');
            },
        });
    };

    const handleRegister=(event:React.FormEvent)=>{
        event.preventDefault();setError(null);setNotice(null);
        if(loginPassword!==registerPasswordAgain){setError('تکرار رمز عبور یکسان نیست.');return;}
        registerAccount.mutate({username:loginUsername.trim(),password:loginPassword,display_name:registerName.trim()},{
            onSuccess:data=>{setAccountMode('login');setLoginPassword('');setRegisterPasswordAgain('');setNotice(data.message);},
            onError:(err:any)=>setError(err.response?.data?.detail||'ساخت حساب انجام نشد.'),
        });
    };
    const passwordStrong=loginPassword.length>=8&&/[a-z]/.test(loginPassword)&&/[A-Z]/.test(loginPassword)&&/\d/.test(loginPassword)&&/[^A-Za-z0-9]/.test(loginPassword);

    return (
        <div dir="rtl" className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden">
            {/* Gradient mesh background */}
            <div className="absolute inset-0 bg-dark-950">
                <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary-600/20 rounded-full blur-3xl"></div>
                <div className="absolute bottom-0 right-1/4 w-96 h-96 bg-primary-500/10 rounded-full blur-3xl"></div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary-700/5 rounded-full blur-3xl"></div>
            </div>

            <div className="glass-panel p-8 max-w-md w-full text-center animate-scale-in relative z-10">
                {/* Logo */}
                <img src="/komod.svg" alt="کمد" className="w-24 h-24 mx-auto mb-6 drop-shadow-2xl" />

                <h1 className="text-3xl font-bold mb-2 text-gradient">
                    کمد
                </h1>
                <p className="text-dark-400 mb-8">
                    درایو ابری و پخش‌کننده شخصی تو
                </p>

                <div className="mb-5 grid grid-cols-2 rounded-xl border border-white/[.07] bg-dark-950/50 p-1">
                    <button onClick={()=>{setLoginMode('password');setError(null);setNotice(null);}} className={`min-h-10 rounded-lg text-sm transition ${loginMode==='password'?'bg-primary-500 text-white':'text-dark-400'}`}>نام کاربری</button>
                    <button disabled={localRuntime} title={localRuntime?'برای جلوگیری از اجرای هم‌زمان ربات، ورود تلگرام در نسخهٔ محلی غیرفعال است.':'ورود با تلگرام'} onClick={()=>{setLoginMode('telegram');setError(null);setNotice(null);setTelegramNeedsOtp(false);setTelegramOtp('');}} className={`min-h-10 rounded-lg text-sm transition disabled:cursor-not-allowed disabled:opacity-45 ${loginMode==='telegram'?'bg-primary-500 text-white':'text-dark-400'}`}>ورود با تلگرام</button>
                </div>

                <div className="space-y-6">
                    {loginMode === 'password' && <div className="glass-card p-6 text-right"><div className="mb-4 grid grid-cols-2 rounded-xl bg-dark-950/55 p-1"><button type="button" onClick={()=>{setAccountMode('login');setError(null)}} className={`min-h-9 rounded-lg text-xs ${accountMode==='login'?'bg-primary-500 text-white':'text-dark-400'}`}>ورود</button><button type="button" onClick={()=>{setAccountMode('register');setNeedsOtp(false);setError(null);setNotice(null)}} className={`min-h-9 rounded-lg text-xs ${accountMode==='register'?'bg-primary-500 text-white':'text-dark-400'}`}>ساخت حساب</button></div>{localRuntime&&accountMode==='login'&&<p className="mb-4 rounded-xl bg-primary-500/10 px-3 py-2 text-center text-xs leading-6 text-primary-100">نسخهٔ محلی به دیتابیس اصلی وصل است. برای جلوگیری از اجرای هم‌زمان ربات، با نام کاربری و رمز وارد شو.</p>}{accountMode==='register'&&<p className="mb-4 rounded-xl border border-primary-400/15 bg-primary-500/[.07] px-3 py-2 text-center text-xs leading-6 text-primary-100">این حساب بدون تلگرام ساخته می‌شود و پس از تأیید مدیر قابل استفاده است.</p>}{notice&&<p className="mb-4 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2 text-center text-xs leading-6 text-emerald-200">{notice}</p>}<form onSubmit={accountMode==='login'?handlePasswordLogin:handleRegister} className="space-y-3">{accountMode==='register'&&<input dir="rtl" autoComplete="name" value={registerName} onChange={event=>setRegisterName(event.target.value)} className="input w-full text-right" placeholder="نام نمایشی"/>}<input dir="rtl" autoComplete="username" value={loginUsername} onChange={event=>setLoginUsername(event.target.value)} className="input w-full text-right" placeholder="نام کاربری"/><input dir="rtl" type="password" autoComplete={accountMode==='login'?'current-password':'new-password'} value={loginPassword} onChange={event=>setLoginPassword(event.target.value)} className="input w-full text-right" placeholder="رمز عبور"/>{accountMode==='register'&&<><input dir="rtl" type="password" autoComplete="new-password" value={registerPasswordAgain} onChange={event=>setRegisterPasswordAgain(event.target.value)} className="input w-full text-right" placeholder="تکرار رمز عبور"/><p className={`text-[11px] leading-5 ${loginPassword&&!passwordStrong?'text-amber-300':'text-dark-500'}`}>حداقل ۸ نویسه شامل حرف بزرگ و کوچک انگلیسی، عدد و نماد</p></>}{accountMode==='login'&&needsOtp&&<input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={loginOtp} onChange={event=>setLoginOtp(event.target.value.replace(/\D/g,'').slice(0,6))} className="input w-full text-center font-mono tracking-[.35em]" placeholder="کد ۶ رقمی"/>}<button disabled={accountMode==='login'?(passwordLogin.isPending||loginUsername.trim().length<4||!loginPassword||(needsOtp&&loginOtp.length!==6)):(registerAccount.isPending||registerName.trim().length<2||loginUsername.trim().length<4||!passwordStrong||loginPassword!==registerPasswordAgain)} className="btn-primary min-h-11 w-full disabled:opacity-50">{accountMode==='login'?(passwordLogin.isPending?'در حال ورود…':'ورود'):(registerAccount.isPending?'در حال ثبت درخواست…':'ارسال درخواست ساخت حساب')}</button>{error&&<p className="text-center text-sm text-red-300">{error}</p>}</form>{accountMode==='login'&&!localRuntime&&<button onClick={()=>{sessionStorage.setItem('komod-password-recovery','1');setLoginMode('telegram');setError(null);}} className="mt-4 w-full text-center text-xs text-primary-300">رمزم را فراموش کرده‌ام</button>}</div>}
                    <div className={`${loginMode === 'telegram' ? 'block' : 'hidden'} glass-card p-5 text-right sm:p-6`}>
                        <h3 className="mb-2 flex items-center gap-2 font-semibold text-white">
                            <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                            </svg>
                            ورود یا بازیابی با تلگرام
                        </h3>
                        <p className="text-xs leading-6 text-dark-400">ربات هویتت را تأیید می‌کند و همین صفحه بعدش خودکار وارد کمد می‌شود.</p>
                        <div className="mt-4 space-y-2 text-xs text-dark-300">
                            <div className="flex items-center gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary-500/15 text-primary-200">۱</span><span>دکمهٔ زیر را بزن و ربات را باز کن.</span></div>
                            <div className="flex items-center gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary-500/15 text-primary-200">۲</span><span>در تلگرام «شروع» یا تأیید ورود را بزن.</span></div>
                            <div className="flex items-center gap-2"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-primary-500/15 text-primary-200">۳</span><span>به این صفحه برگرد؛ ورود خودکار انجام می‌شود.</span></div>
                        </div>
                        <div className="mt-4"><BotLink code={code}/></div>
                        <button type="button" onClick={()=>setShowTelegramCodeLogin(value=>!value)} className="mt-3 flex min-h-10 w-full items-center justify-between rounded-xl border border-white/[.07] bg-dark-950/35 px-3 text-xs text-dark-300 transition hover:border-primary-400/25 hover:text-primary-100">
                            <span>ورود با دستور یا کد</span>
                            <svg className={`h-4 w-4 transition ${showTelegramCodeLogin?'rotate-180':''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/></svg>
                        </button>
                        {showTelegramCodeLogin&&<div className="mt-2 space-y-3 rounded-2xl border border-white/[.07] bg-dark-950/45 p-3">
                            {codeSource==='device'&&code&&<div>
                                <p className="mb-2 text-xs leading-6 text-dark-400">اگر دکمه باز نشد، این دستور را در گفت‌وگوی خصوصی ربات بفرست:</p>
                                <button type="button" onClick={copyLoginCommand} className="flex min-h-11 w-full items-center justify-between rounded-xl border border-primary-400/15 bg-primary-500/[.07] px-3 text-left font-mono text-sm tracking-wide text-primary-100" dir="ltr">
                                    <span>/login {code}</span><span className="font-sans text-[11px] text-primary-300">{commandCopied?'کپی شد ✓':'کپی'}</span>
                                </button>
                            </div>}
                            <form onSubmit={handleTelegramCodeLogin} className="space-y-2">
                                <p className="text-xs leading-6 text-dark-400">یا در ربات فقط <span dir="ltr" className="font-mono text-dark-200">/login</span> را بزن و کدی که می‌دهد اینجا وارد کن:</p>
                                <div className="flex gap-2">
                                    <input dir="ltr" inputMode="text" autoComplete="one-time-code" maxLength={6} value={telegramCodeInput} onChange={event=>setTelegramCodeInput(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6))} className="input min-w-0 flex-1 text-center font-mono tracking-[.28em]" placeholder="ABC123"/>
                                    <button type="submit" disabled={telegramCodeInput.length!==6} className="btn-secondary shrink-0 px-4 disabled:opacity-40">ورود</button>
                                </div>
                            </form>
                            <p className="text-[11px] leading-5 text-dark-500">کد را داخل گروه نفرست؛ فقط گفت‌وگوی خصوصی ربات امن است.</p>
                        </div>}
                        {isGenerating&&<div className="mt-3 flex items-center justify-center gap-2 text-xs text-dark-400"><div className="h-4 w-4 animate-spin rounded-full border border-white/15 border-t-primary-400"/>در حال آماده‌سازی ورود امن…</div>}
                        {isPolling&&<div className="mt-3 flex items-center justify-center gap-2 text-xs text-dark-400"><div className="h-2 w-2 animate-pulse rounded-full bg-primary-500"/>منتظر تأیید در تلگرام…</div>}
                        {telegramNeedsOtp&&<div className="mt-4 rounded-2xl border border-primary-400/15 bg-primary-500/[.06] p-3"><p className="mb-3 text-center text-xs leading-6 text-primary-100">تلگرام تأیید شد. حالا کد برنامهٔ تأیید را وارد کن.</p><input dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={telegramOtp} onChange={event=>setTelegramOtp(event.target.value.replace(/\D/g,'').slice(0,6))} className="input w-full text-center font-mono tracking-[.35em]" placeholder="کد ۶ رقمی"/></div>}
                        {error&&<p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-center text-xs leading-6 text-red-300">{error}</p>}
                        <form onSubmit={handleManualLogin} className="mt-2 text-center"><button type="submit" disabled={code.length<6||isVerifying||(telegramNeedsOtp&&telegramOtp.length!==6)} className={telegramNeedsOtp?'btn-primary min-h-11 w-full disabled:opacity-40':'px-3 py-2 text-[11px] text-dark-500 transition hover:text-primary-200 disabled:opacity-40'}>{isVerifying?'در حال بررسی…':telegramNeedsOtp?'تأیید و ورود':'بررسی دوباره ورود'}</button></form>
                        </div>
                </div>
            </div>
        </div>
    );
}

function BotLink({ code }: { code?: string }) {
    const { data: botInfo } = useBotInfo();
    const ready = Boolean(botInfo?.username && code);
    const botUrl = ready
        ? `https://t.me/${botInfo!.username}?start=login_${code}`
        : '#';

    return (
        <a
            href={botUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-disabled={!ready}
            className={`btn-secondary inline-flex items-center justify-center gap-2 w-full py-3 ${!ready ? 'opacity-50 pointer-events-none' : ''}`}
        >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.015-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.751-.244-1.349-.374-1.297-.789.027-.216.324-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.015 3.333-1.386 4.025-1.627 4.477-1.635.099-.002.321.023.465.141.121.099.155.232.17.325.015.094.034.31.019.478z" />
            </svg>
            تأیید ورود در تلگرام
        </a>
    );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
    restoreSavedSession();
    const connectivity = useConnectivity();
    const { isLoading, error } = useCurrentUser(connectivity === 'online');
    const token = localStorage.getItem('access_token');
    const online = connectivity === 'online';
    const [authWaitExpired, setAuthWaitExpired] = useState(false);

    useEffect(() => {
        if (!isLoading) { setAuthWaitExpired(false); return; }
        const timer = window.setTimeout(() => setAuthWaitExpired(true), 3000);
        return () => window.clearTimeout(timer);
    }, [isLoading]);

    if (!token) {
        return <Navigate to="/login" replace />;
    }

    if (!online) return <>{children}</>;

    if (isLoading && !authWaitExpired) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-dark-950">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4"></div>
                    <p className="text-dark-400">در حال بررسی ورود…</p>
                </div>
            </div>
        );
    }

    const authStatus = (error as { response?: { status?: number } } | null)?.response?.status;
    // Connectivity, rate-limit and server errors must not masquerade as an
    // expired login. The cached account remains usable and the API client can
    // recover when the server becomes reachable again.
    if (error && authStatus !== 401 && authStatus !== 403) return <>{children}</>;

    if (error) {
        return (
            <div dir="rtl" className="min-h-screen flex items-center justify-center bg-dark-950 p-4">
                <div className="text-center max-w-md">
                    <p className="text-red-400 text-lg mb-4">ورود به کمد انجام نشد</p>
                    <p className="text-dark-400 text-sm mb-4">
                        نشستت منقضی شده یا اطلاعات ورود معتبر نیست. دوباره از طریق ربات وارد شو.
                    </p>
                    <button
                        onClick={() => {
                            localStorage.removeItem('access_token');
                            window.location.href = '/login';
                        }}
                        className="px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded text-white"
                    >
                        رفتن به صفحه ورود
                    </button>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}

function App() {
    return (
        <TelegramWebAppBootstrap>
            <PwaManager />
            <OfflineTextSync />
            <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/auth" element={<AuthCallback />} />
                <Route path="/s/:publicHash" element={<Suspense fallback={<LazyFallback/>}><PublicSharePage /></Suspense>} />
                <Route
                    path="/*"
                    element={
                        <ProtectedRoute>
                            <DeferredOverlays />
                            <PlayerCloudSync />
                            <OfflineDownloadProgressPanel />
                            <Suspense fallback={<LazyFallback/>}><FileBrowser /></Suspense>
                        </ProtectedRoute>
                    }
                />
            </Routes>
        </TelegramWebAppBootstrap>
    );
}

export default App;
