import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Download, FileText, KeyRound, Loader2, LockKeyhole, Play, ShieldCheck } from 'lucide-react';
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
    const [info, setInfo] = useState<ShareInfo | null>(null);
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
                if (!response.ok) throw new Error(data.detail || 'این پیوند در دسترس نیست.');
                if (active) setInfo(data);
            })
            .catch(reason => { if (active) setError(reason instanceof Error ? reason.message : 'این پیوند در دسترس نیست.'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [publicHash]);

    const unlocked = Boolean(info && (!info.password_required || accessToken));
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
            const response = await fetch(`/api/stream/s/${encodeURIComponent(publicHash)}/unlock`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.detail || 'باز کردن پیوند انجام نشد.');
            setAccessToken(data.access_token);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'باز کردن پیوند انجام نشد.');
        } finally { setUnlocking(false); }
    };

    if (loading) return <PublicShell><Loader2 className="h-8 w-8 animate-spin text-primary-300"/><p>دارم فایل رو آماده می‌کنم…</p></PublicShell>;
    if (!info) return <PublicShell><LockKeyhole className="h-10 w-10 text-red-300"/><h1 className="text-xl font-black">پیوند در دسترس نیست</h1><p className="max-w-sm text-center text-sm text-dark-400">{error || 'ممکنه پیوند لغو شده یا زمانش تموم شده باشه.'}</p></PublicShell>;

    return <main dir="rtl" className="min-h-dvh bg-dark-950 px-4 py-8 text-white sm:py-12">
        <section className="mx-auto w-full max-w-3xl overflow-hidden rounded-[2rem] border border-white/[.08] bg-dark-900/90 shadow-2xl">
            <header className="border-b border-white/[.07] p-5 sm:p-7">
                <div className="flex items-start gap-3"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-500/15 text-primary-200"><ShieldCheck className="h-6 w-6"/></span><div className="min-w-0"><p className="text-xs text-primary-300">پیوند امن کمد</p><h1 dir="auto" className="mt-1 break-words text-xl font-black sm:text-2xl">{info.file_name}</h1><p className="mt-2 text-xs text-dark-400">{humanSize(info.file_size)}{info.expires_at ? ` · معتبر تا ${new Date(info.expires_at).toLocaleString('fa-IR')}` : ''}</p></div></div>
            </header>
            <div className="p-4 sm:p-7">
                {!unlocked ? <form onSubmit={unlock} className="mx-auto max-w-sm rounded-3xl bg-white/[.035] p-5 text-center"><KeyRound className="mx-auto h-8 w-8 text-primary-300"/><h2 className="mt-3 font-bold">این فایل رمز داره</h2><p className="mt-1 text-xs text-dark-400">رمزی که فرستنده داده رو وارد کن.</p><input autoFocus type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="رمز پیوند" className="input mt-4 w-full text-right"/><button disabled={!password || unlocking} className="btn-primary mt-3 flex min-h-11 w-full items-center justify-center gap-2 disabled:opacity-50">{unlocking && <Loader2 className="h-4 w-4 animate-spin"/>}باز کردن فایل</button></form> : <MediaPreview info={info} streamUrl={streamUrl}/>} 
                {error && <p className="mt-4 rounded-2xl bg-red-500/10 px-4 py-3 text-center text-sm text-red-200">{error}</p>}
                {unlocked && <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{info.allow_download && <a className="btn-primary flex min-h-11 items-center gap-2 px-5" href={`${streamUrl}${streamUrl.includes('?') ? '&' : '?'}download=1`}><Download className="h-4 w-4"/>دانلود فایل</a>}<span className="rounded-xl bg-white/[.04] px-3 py-2 text-xs text-dark-400">{info.views_remaining == null ? 'بدون محدودیت مشاهده' : `${info.views_remaining.toLocaleString('fa-IR')} مشاهده باقی مونده`}</span></div>}
            </div>
        </section>
    </main>;
}

function MediaPreview({ info, streamUrl }: { info: ShareInfo; streamUrl: string }) {
    if (info.file_type === 'video') return <video className="mx-auto max-h-[65dvh] w-full rounded-3xl bg-black" src={streamUrl} controls playsInline preload="metadata"/>;
    if (info.file_type === 'audio') return <div className="rounded-3xl bg-gradient-to-br from-primary-500/20 to-dark-950 p-6 text-center"><Play className="mx-auto mb-5 h-14 w-14 text-primary-200"/><audio className="w-full" src={streamUrl} controls preload="metadata"/></div>;
    if (info.file_type === 'image') return <img className="mx-auto max-h-[70dvh] max-w-full rounded-3xl object-contain" src={streamUrl} alt={info.file_name}/>;
    if (info.file_type === 'text') return <iframe title={info.file_name} className="h-[60dvh] w-full rounded-3xl border-0 bg-white" src={streamUrl}/>;
    return <div className="rounded-3xl bg-white/[.035] p-10 text-center"><FileText className="mx-auto h-16 w-16 text-primary-200"/><p className="mt-4 text-sm text-dark-300">این فایل پیش‌نمایش مستقیم نداره؛ می‌تونی دانلودش کنی.</p></div>;
}

function PublicShell({ children }: { children: React.ReactNode }) {
    return <main dir="rtl" className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-dark-950 px-5 text-white">{children}</main>;
}
