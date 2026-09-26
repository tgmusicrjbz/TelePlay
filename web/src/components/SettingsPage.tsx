import { useEffect, useState } from 'react';
import { AtSign, HardDrive, LogOut, Palette, Shield, Smartphone, Users } from 'lucide-react';
import { formatFileSize, useCurrentUser, useLogoutAll, useStorageStats } from '../lib/api';
import { applyTheme, colorThemes, ColorTheme, getStoredTheme } from '../lib/theme';

export default function SettingsPage() {
    const { data: storage } = useStorageStats();
    const { data: user } = useCurrentUser();
    const logoutAll = useLogoutAll();
    const [theme, setTheme] = useState<ColorTheme>(getStoredTheme);
    const [confirmation, setConfirmation] = useState<'device' | 'all' | null>(null);

    useEffect(() => applyTheme(theme), [theme]);

    const chooseTheme = (next: ColorTheme) => {
        setTheme(next);
        localStorage.setItem('komod-color-theme', next);
        applyTheme(next);
    };
    const logoutThisDevice = () => {
        ['access_token', 'refresh_token', 'user'].forEach(key => localStorage.removeItem(key));
        window.location.href = '/login';
    };
    const logoutEverywhere = async () => {
        try { await logoutAll.mutateAsync(); } finally { logoutThisDevice(); }
    };
    const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'کاربر کمد';

    return <div className="mx-auto w-full max-w-4xl p-4 pb-28 sm:p-6 md:pb-8 lg:p-8">
        <div className="mb-6"><p className="text-xs font-semibold text-primary-300">⚙️ شخصی‌سازی و حساب</p><h1 className="mt-2 text-2xl font-bold sm:text-3xl">تنظیمات کمد</h1><p className="mt-2 text-sm text-dark-400">ظاهر کمد، وضعیت حافظه و نشست‌های حسابت اینجاست.</p></div>
        <div className="grid gap-4 md:grid-cols-2">
            <section className="rounded-2xl border border-white/[0.07] bg-dark-900/70 p-5"><div className="flex items-center gap-3"><HardDrive className="h-5 w-5 text-dark-400" /><h2 className="font-bold text-dark-200">حافظه کمد</h2></div><p className="mt-5 text-3xl font-black text-primary-300">{storage ? formatFileSize(storage.total_size) : '…'}</p><p className="mt-2 text-sm text-dark-500">حجم فایل‌های ذخیره‌شده در تلگرام</p></section>
            <section className="rounded-2xl border border-white/[0.07] bg-dark-900/70 p-5"><div className="flex items-center gap-3"><Smartphone className="h-5 w-5 text-primary-300" /><h2 className="font-bold">حساب تلگرام</h2></div><p className="mt-5 text-lg font-bold">{displayName}</p><p className="mt-1 flex items-center gap-1.5 text-sm text-dark-400" dir="ltr"><AtSign className="h-4 w-4" />{user?.username || 'بدون نام کاربری'}</p><p className="mt-2 text-xs text-dark-500">شناسه: <span dir="ltr">{user?.telegram_id || '…'}</span></p></section>
            <section className="rounded-2xl border border-white/[0.07] bg-dark-900/70 p-5 md:col-span-2"><div className="flex items-center gap-3"><Palette className="h-5 w-5 text-primary-300" /><div><h2 className="font-bold">رنگ کمد</h2><p className="mt-1 text-xs text-dark-400">رنگی را انتخاب کن که بیشتر به کمدت می‌آید.</p></div></div><div className="mt-5 flex flex-wrap gap-3">{(Object.entries(colorThemes) as [ColorTheme, typeof colorThemes[ColorTheme]][]).map(([key, item]) => <button key={key} onClick={() => chooseTheme(key)} className={`flex min-h-11 items-center gap-2 rounded-xl border px-4 py-2 text-sm transition-all ${theme === key ? 'border-white/40 bg-white/10 text-white' : 'border-white/[0.07] bg-dark-800/60 text-dark-300 hover:border-white/20'}`}><span className="h-5 w-5 rounded-full" style={{ backgroundColor: item.dot }} />{item.label}{theme === key && <span>✓</span>}</button>)}</div></section>
            <section className="rounded-2xl border border-white/[0.07] bg-dark-900/70 p-5 md:col-span-2"><div className="flex items-center gap-3"><Shield className="h-5 w-5 text-primary-300" /><h2 className="font-bold">نشست‌های فعال</h2></div><div className="mt-5 flex flex-col gap-2 sm:flex-row"><button className="btn-secondary flex min-h-11 flex-1 items-center justify-center gap-2 text-red-300" onClick={() => setConfirmation('device')}><LogOut className="h-4 w-4" /> خروج از این دستگاه</button><button className="btn-secondary flex min-h-11 flex-1 items-center justify-center gap-2 text-orange-300" onClick={() => setConfirmation('all')}><Users className="h-4 w-4" /> خروج از همه دستگاه‌ها</button></div></section>
        </div>
        {confirmation && <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setConfirmation(null)}><div className="w-full max-w-sm rounded-2xl border border-white/10 bg-dark-900 p-5" onClick={event => event.stopPropagation()}><h2 className="text-lg font-bold">{confirmation === 'all' ? 'خروج از همه دستگاه‌ها؟' : 'از این دستگاه خارج می‌شی؟'}</h2><p className="mt-2 text-sm leading-6 text-dark-300">{confirmation === 'all' ? 'همه نشست‌های فعال کمد بسته می‌شوند.' : 'برای ورود دوباره باید از ربات کد ورود بگیری.'}</p><div className="mt-5 flex gap-2"><button className="flex-1 rounded-xl bg-red-500 px-4 py-2.5 font-medium" disabled={logoutAll.isPending} onClick={() => confirmation === 'all' ? void logoutEverywhere() : logoutThisDevice()}>{logoutAll.isPending ? 'کمی صبر کن…' : 'خروج'}</button><button className="btn-secondary flex-1" onClick={() => setConfirmation(null)}>بی‌خیال</button></div></div></div>}
    </div>;
}
