import { useEffect, useMemo, useState } from 'react';
import { Download, PlusSquare, RefreshCw, Share, WifiOff, X } from 'lucide-react';

interface InstallPromptEvent extends Event {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export default function PwaManager() {
    const [online, setOnline] = useState(navigator.onLine);
    const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null);
    const [installed, setInstalled] = useState(isStandalone());
    const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
    const [showIosHelp, setShowIosHelp] = useState(false);
    const [showNudge, setShowNudge] = useState(() => Number(localStorage.getItem('komod-install-nudge-until') || 0) < Date.now());
    const isIos = useMemo(() => /iphone|ipad|ipod/i.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1), []);

    useEffect(() => {
        const wentOnline = () => setOnline(true);
        const wentOffline = () => setOnline(false);
        const beforeInstall = (event: Event) => {
            event.preventDefault();
            setInstallPrompt(event as InstallPromptEvent);
        };
        const appInstalled = () => { setInstalled(true); setInstallPrompt(null); };
        window.addEventListener('online', wentOnline);
        window.addEventListener('offline', wentOffline);
        window.addEventListener('beforeinstallprompt', beforeInstall);
        window.addEventListener('appinstalled', appInstalled);
        return () => {
            window.removeEventListener('online', wentOnline);
            window.removeEventListener('offline', wentOffline);
            window.removeEventListener('beforeinstallprompt', beforeInstall);
            window.removeEventListener('appinstalled', appInstalled);
        };
    }, []);

    useEffect(() => {
        if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return;
        let refreshing = false;
        const register = async () => {
            try {
                const registration = await navigator.serviceWorker.register('/sw.js', {
                    scope: '/',
                    updateViaCache: 'none',
                });
                await registration.update();
                if (registration.waiting) setWaitingWorker(registration.waiting);
                registration.addEventListener('updatefound', () => {
                    const worker = registration.installing;
                    worker?.addEventListener('statechange', () => {
                        if (worker.state === 'installed' && navigator.serviceWorker.controller) setWaitingWorker(worker);
                    });
                });
                const timer = window.setInterval(() => registration.update(), 60 * 60 * 1000);
                const checkForUpdate = () => {
                    if (document.visibilityState === 'visible') void registration.update();
                };
                document.addEventListener('visibilitychange', checkForUpdate);
                window.addEventListener('focus', checkForUpdate);
                return () => {
                    window.clearInterval(timer);
                    document.removeEventListener('visibilitychange', checkForUpdate);
                    window.removeEventListener('focus', checkForUpdate);
                };
            } catch (error) {
                console.error('Service worker registration failed', error);
            }
        };
        let cleanup: (() => void) | undefined;
        register().then(result => { cleanup = result; });
        const controllerChanged = () => {
            if (refreshing) return;
            refreshing = true;
            window.location.reload();
        };
        navigator.serviceWorker.addEventListener('controllerchange', controllerChanged);
        return () => {
            cleanup?.();
            navigator.serviceWorker.removeEventListener('controllerchange', controllerChanged);
        };
    }, []);

    const install = async () => {
        if (installPrompt) {
            await installPrompt.prompt();
            const choice = await installPrompt.userChoice;
            if (choice.outcome !== 'accepted') setInstallPrompt(null);
        } else if (isIos) {
            setShowIosHelp(true);
        }
    };

    useEffect(() => {
        const requested = () => void install();
        window.addEventListener('komod-install-request', requested);
        return () => window.removeEventListener('komod-install-request', requested);
    });

    const dismissNudge = () => {
        localStorage.setItem('komod-install-nudge-until', String(Date.now() + 7 * 24 * 60 * 60 * 1000));
        setShowNudge(false);
    };

    const applyUpdate = () => waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
    const showInstall = !installed && (Boolean(installPrompt) || isIos);

    return <>
        {!online && <div className="fixed inset-x-0 top-0 z-[200] flex items-center justify-center gap-2 bg-amber-500 px-4 py-2 text-center text-xs font-semibold text-black shadow-lg" role="status">
            <WifiOff className="h-4 w-4" /> آفلاینی؛ فایل‌های ذخیره‌شده در بخش دانلودها آمادهٔ پخش‌اند.
        </div>}

        {((showInstall && showNudge) || waitingWorker) && <div className="pwa-safe-bottom fixed bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] left-3 z-[190] flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-2 md:bottom-4 md:left-4" dir="rtl">
            {waitingWorker && <button onClick={applyUpdate} className="flex items-center justify-center gap-2 rounded-xl border border-primary-400/30 bg-dark-900/95 px-4 py-3 text-sm font-semibold text-white shadow-2xl backdrop-blur">
                <RefreshCw className="h-4 w-4 text-primary-300" /> نسخه جدید آماده است
            </button>}
            {showInstall && showNudge && <div className="flex w-[min(20rem,calc(100vw-1.5rem))] items-center gap-2 rounded-2xl border border-primary-400/25 bg-dark-900/95 p-2 shadow-2xl backdrop-blur-xl"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/15 text-primary-200"><Download className="h-5 w-5"/></span><button onClick={install} className="min-w-0 flex-1 text-right"><strong className="block text-sm">نصب کمد</strong><small className="block truncate text-[10px] text-dark-400">دسترسی سریع از صفحهٔ اصلی دستگاه</small></button><button onClick={install} className="rounded-xl bg-primary-500 px-3 py-2 text-xs font-semibold text-white">نصب</button><button onClick={dismissNudge} className="btn-icon h-9 w-9" title="فعلاً نه"><X className="h-4 w-4"/></button></div>}
        </div>}

        {showIosHelp && <div className="fixed inset-0 z-[210] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center" onClick={() => setShowIosHelp(false)}>
            <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-dark-900 p-5 text-right shadow-2xl" dir="rtl" onClick={event => event.stopPropagation()}>
                <div className="flex items-center justify-between"><h2 className="font-bold">نصب کمد روی آیفون یا آیپد</h2><button className="btn-icon" onClick={() => setShowIosHelp(false)}><X className="h-5 w-5" /></button></div>
                <ol className="mt-5 space-y-4 text-sm leading-7 text-dark-200">
                    <li className="flex gap-3"><Share className="mt-1 h-5 w-5 shrink-0 text-primary-300" /><span>در Safari دکمهٔ <strong>Share</strong> را بزن.</span></li>
                    <li className="flex gap-3"><PlusSquare className="mt-1 h-5 w-5 shrink-0 text-primary-300" /><span>گزینهٔ <strong>Add to Home Screen</strong> را انتخاب کن.</span></li>
                </ol>
                <button className="btn-primary mt-5 w-full" onClick={() => setShowIosHelp(false)}>متوجه شدم</button>
            </div>
        </div>}
    </>;
}
