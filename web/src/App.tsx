import { Routes, Route, Navigate, useSearchParams, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useCurrentUser, useLoginWithCode, useBotInfo, useGenerateLoginCode, useVerifyLoginCode } from './lib/api';
import FileBrowser from './components/FileBrowser';
import GlobalContextMenu from './components/GlobalContextMenu';
import PwaManager from './components/PwaManager';

function AuthCallback() {
    const [searchParams] = useSearchParams();
    const navigate = useNavigate();
    const token = searchParams.get('token');
    const [status, setStatus] = useState('در حال ورود به کمد…');
    const [saved, setSaved] = useState(false);

    useEffect(() => {
        if (token) {
            try {
                localStorage.setItem('access_token', token);
                const check = localStorage.getItem('access_token');
                if (check === token) {
                    setStatus('✅ ورود انجام شد؛ در حال باز کردن کمد…');
                    setSaved(true);
                    setTimeout(() => {
                        navigate('/', { replace: true });
                    }, 500);
                } else {
                    setStatus('❌ ذخیره اطلاعات ورود انجام نشد. دوباره تلاش کن.');
                }
            } catch {
                setStatus('❌ ورود انجام نشد. دوباره از ربات وارد شو.');
            }
        } else {
            setStatus('❌ اطلاعات ورود در این پیوند وجود ندارد.');
        }
    }, [token, navigate]);

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
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4"></div>
                <p className="text-white text-lg mb-4">{status}</p>

                {token && !saved && <a href="/login" className="btn-secondary mt-4 inline-block">بازگشت به صفحه ورود</a>}
            </div>
        </div>
    );
}

function LoginPage() {
    const { mutate: loginByCode, isPending: isVerifying } = useLoginWithCode();
    const { mutate: generateCode, isPending: isGenerating } = useGenerateLoginCode();
    const { mutate: verifyCode } = useVerifyLoginCode();
    
    const [code, setCode] = useState('');
    const [isPolling, setIsPolling] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Initial code generation
    useEffect(() => {
        generateCode(undefined, {
            onSuccess: (data) => {
                setCode(data.code);
                setIsPolling(true);
            },
            onError: (err: any) => {
                setError(err.response?.data?.detail || 'ساخت کد ورود انجام نشد.');
            }
        });
    }, [generateCode]);

    // Polling logic
    useEffect(() => {
        let timer: any;
        if (isPolling && code) {
            timer = setInterval(() => {
                verifyCode(code, {
                    onSuccess: (data) => {
                        localStorage.setItem('access_token', data.access_token);
                        localStorage.setItem('refresh_token', data.refresh_token);
                        setIsPolling(false);
                        window.location.href = '/';
                    },
                    onError: () => {
                        // Silent failure for polling
                    }
                });
            }, 3000);
        }
        return () => {
            if (timer) clearInterval(timer);
        };
    }, [isPolling, code, verifyCode]);

    const handleManualLogin = (e: React.FormEvent) => {
        e.preventDefault();
        if (!code) return;

        loginByCode(code, {
            onSuccess: (data) => {
                localStorage.setItem('access_token', data.access_token);
                localStorage.setItem('refresh_token', data.refresh_token);
                window.location.href = '/';
            },
            onError: (err: any) => {
                setError(err.response?.data?.detail || 'کد ورود معتبر نیست.');
            }
        });
    };

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
                    درایو ابری و پخش‌کننده شخصی تو روی تلگرام
                </p>

                <div className="space-y-6">
                    {/* Login Code Section */}
                    <div className="glass-card p-6">
                        <h3 className="text-white font-medium mb-4 flex items-center justify-center gap-2">
                            <svg className="w-5 h-5 text-primary-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                            </svg>
                            ورود امن با کد
                        </h3>
                        <form onSubmit={handleManualLogin} className="flex flex-col gap-3">
                            <div className="relative">
                                <input
                                    type="text"
                                    placeholder="کد ۶ رقمی"
                                    value={code}
                                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                                    maxLength={6}
                                    className="w-full bg-dark-900/60 border border-white/[0.08] rounded-xl px-4 py-4 text-center text-xl tracking-[0.1em] sm:text-2xl sm:tracking-[0.3em] font-mono text-white placeholder:text-sm placeholder:tracking-normal placeholder:font-sans placeholder-dark-600 focus:outline-none focus:ring-2 focus:ring-primary-500/50 focus:border-primary-500/50 transition-all duration-200 uppercase"
                                />
                                {isGenerating && (
                                    <div className="absolute inset-0 flex items-center justify-center bg-dark-900/40 rounded-xl">
                                        <div className="w-5 h-5 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"></div>
                                    </div>
                                )}
                            </div>
                            <button
                                type="submit"
                                disabled={code.length < 6 || isVerifying}
                                className="btn-primary w-full py-3 text-base disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isVerifying ? (
                                    <span className="flex items-center justify-center gap-2">
                                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                                        در حال بررسی…
                                    </span>
                                ) : 'ورود به کمد'}
                            </button>
                            {error && (
                                <p className="text-red-400 text-sm mt-1">
                                    {error}
                                </p>
                            )}
                        </form>
                        
                        {isPolling && (
                            <div className="flex items-center justify-center gap-2 mt-4 text-xs text-dark-400">
                                <div className="w-2 h-2 bg-primary-500 rounded-full animate-pulse"></div>
                                منتظر تأیید در تلگرام…
                            </div>
                        )}
                        
                        <p className="text-xs text-dark-500 mt-4">
                            این کد را با دستور <span dir="ltr" className="text-primary-400 font-mono bg-dark-800/50 px-1.5 py-0.5 rounded">/login {code || 'CODE'}</span> برای ربات بفرست و ورود را تأیید کن.
                        </p>
                    </div>

                    <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                            <div className="w-full border-t border-white/[0.06]"></div>
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                            <span className="bg-dark-900/80 px-3 text-dark-500">یا مستقیم وارد ربات شو</span>
                        </div>
                    </div>

                    <BotLink code={code} />
                </div>
            </div>
        </div>
    );
}

function BotLink({ code }: { code?: string }) {
    const { data: botInfo } = useBotInfo();
    const botUrl = botInfo?.username 
        ? `https://t.me/${botInfo.username}${code ? `?start=${code}` : ''}` 
        : '#';

    return (
        <a
            href={botUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={`btn-secondary inline-flex items-center justify-center gap-2 w-full py-3 ${!botInfo?.username ? 'opacity-50 pointer-events-none' : ''}`}
        >
            <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.692-1.653-1.123-2.678-1.799-1.185-.781-.417-1.21.258-1.911.177-.184 3.247-2.977 3.307-3.23.007-.032.015-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.009-1.252-.242-1.865-.442-.751-.244-1.349-.374-1.297-.789.027-.216.324-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.015 3.333-1.386 4.025-1.627 4.477-1.635.099-.002.321.023.465.141.121.099.155.232.17.325.015.094.034.31.019.478z" />
            </svg>
            باز کردن ربات در تلگرام
        </a>
    );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
    const { isLoading, error } = useCurrentUser();
    const token = localStorage.getItem('access_token');
    const [online, setOnline] = useState(navigator.onLine);

    useEffect(() => {
        const update = () => setOnline(navigator.onLine);
        window.addEventListener('online', update);
        window.addEventListener('offline', update);
        return () => {
            window.removeEventListener('online', update);
            window.removeEventListener('offline', update);
        };
    }, []);

    if (!token) {
        return <Navigate to="/login" replace />;
    }

    if (!online) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-dark-950 p-4" dir="rtl">
                <div className="glass-panel w-full max-w-sm p-7 text-center">
                    <div className="text-5xl mb-4">🗄️</div>
                    <h2 className="text-xl font-bold text-white">کمد فعلاً آفلاینه</h2>
                    <p className="mt-3 text-sm leading-7 text-dark-400">برای بررسی حساب، دیدن فایل‌ها و پخش محتوا باید دوباره به اینترنت وصل بشی.</p>
                    <button className="btn-primary mt-6 w-full" onClick={() => window.location.reload()}>تلاش دوباره</button>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-dark-950">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary-500 mx-auto mb-4"></div>
                    <p className="text-dark-400">در حال بررسی ورود…</p>
                </div>
            </div>
        );
    }

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

import MediaPlayer from './components/MediaPlayer';
import ContentPreview from './components/ContentPreview';
import AddToPlaylistDialog from './components/AddToPlaylistDialog';

function App() {
    return (
        <>
            <PwaManager />
            <GlobalContextMenu />
            <MediaPlayer />
            <ContentPreview />
            <AddToPlaylistDialog />
            <Routes>
                <Route path="/login" element={<LoginPage />} />
                <Route path="/auth" element={<AuthCallback />} />
                <Route
                    path="/*"
                    element={
                        <ProtectedRoute>
                            <FileBrowser />
                        </ProtectedRoute>
                    }
                />
            </Routes>
        </>
    );
}

export default App;
