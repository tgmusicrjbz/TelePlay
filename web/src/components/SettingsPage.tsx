import { useEffect, useState } from 'react';
import { AtSign, Download, HardDrive, LogOut, MonitorSmartphone, Palette, Plus, Shield, Smartphone, Trash2, UserRoundCog, Users, Warehouse } from 'lucide-react';
import { formatFileSize, formatPersianDate, useAdminUsers, useCurrentUser, useGrantWorkspace, useLogoutAll, useRevokeSession, useRevokeWorkspace, useSessions, useStorageStats, useUpdateAdminUser, useWorkspaceGrants, useWorkspaces } from '../lib/api';
import { activateAccount, forgetAccount, savedAccounts, syncCurrentAccount } from '../lib/accounts';
import { applyTheme, colorThemes, ColorTheme, getStoredTheme } from '../lib/theme';

export default function SettingsPage() {
    const { data: storage } = useStorageStats();
    const { data: user } = useCurrentUser();
    const { data: sessions = [] } = useSessions();
    const { data: workspaces = [] } = useWorkspaces();
    const { data: grants = [] } = useWorkspaceGrants();
    const { data: adminUsers = [] } = useAdminUsers(Boolean(user?.is_admin));
    const logoutAll = useLogoutAll(); const revokeSession = useRevokeSession(); const grantWorkspace = useGrantWorkspace(); const revokeWorkspace = useRevokeWorkspace(); const updateAdmin = useUpdateAdminUser();
    const [theme, setTheme] = useState<ColorTheme>(getStoredTheme);
    const [confirmation, setConfirmation] = useState<'device' | 'all' | null>(null);
    const [shareTelegramId, setShareTelegramId] = useState(''); const [sharePermission, setSharePermission] = useState<'read' | 'write'>('read');
    const accounts = savedAccounts();

    useEffect(() => applyTheme(theme), [theme]);
    useEffect(() => { if (user) syncCurrentAccount(user); }, [user]);

    const chooseTheme = (next: ColorTheme) => { setTheme(next); localStorage.setItem('komod-color-theme', next); applyTheme(next); };
    const logoutThisDevice = async (revoke = true) => {
        const currentSession = sessions.find(item => item.current);
        if (revoke && currentSession) {
            try { await revokeSession.mutateAsync(currentSession.id); } catch { /* clear local credentials anyway */ }
        }
        if (user) forgetAccount(user.telegram_id);
        ['access_token', 'refresh_token', 'user', 'komod-active-workspace'].forEach(key => localStorage.removeItem(key));
        const next = savedAccounts()[0];
        if (next) activateAccount(next); else window.location.href = '/login';
    };
    const logoutEverywhere = async () => { try { await logoutAll.mutateAsync(); } finally { await logoutThisDevice(false); } };
    const displayName = user?.display_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'کاربر کمد';
    const activeWorkspace = Number(localStorage.getItem('komod-active-workspace') || user?.id || 0);
    const switchWorkspace = (id: number) => { if (id === user?.id) localStorage.removeItem('komod-active-workspace'); else localStorage.setItem('komod-active-workspace', String(id)); window.location.href = '/'; };
    const submitGrant = async () => { const telegram_id = Number(shareTelegramId); if (!telegram_id) return; await grantWorkspace.mutateAsync({ telegram_id, permission: sharePermission }); setShareTelegramId(''); };

    return <div className="mx-auto w-full max-w-5xl p-4 pb-28 sm:p-6 md:pb-8 lg:p-8">
        <div className="mb-6"><p className="text-xs font-semibold text-primary-300">⚙️ شخصی‌سازی و حساب</p><h1 className="mt-2 text-2xl font-bold sm:text-3xl">تنظیمات کمد</h1><p className="mt-2 text-sm text-dark-400">حساب‌ها، فضاهای مشترک، نشست‌ها و ظاهر کمد را مدیریت کن.</p></div>
        <div className="mb-5 grid grid-cols-2 gap-2 rounded-2xl border border-white/[.07] bg-dark-900/70 p-2 sm:grid-cols-4">
            <span className="col-span-2 px-2 py-1 text-xs font-semibold text-dark-500 sm:col-span-1 sm:self-center">بخش‌های تنظیمات</span>
            <a href="#accounts" className="rounded-xl bg-white/[.06] px-3 py-2 text-center text-sm">👤 حساب‌ها و نشست‌ها</a>
            <a href="#spaces" className="rounded-xl bg-white/[.06] px-3 py-2 text-center text-sm">🗄️ کمدها و دسترسی</a>
            <a href="#appearance" className="rounded-xl bg-white/[.06] px-3 py-2 text-center text-sm">🎨 ظاهر برنامه</a>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
            <div id="accounts" className="md:col-span-2 flex items-center gap-2 border-b border-white/[.07] pb-2 text-sm font-bold text-primary-200">👤 حساب‌ها و نشست‌ها</div>
            <Card icon={<HardDrive/>} title="حافظه کمد"><p className="mt-4 text-3xl font-black text-primary-300">{storage ? formatFileSize(storage.total_size) : '…'}</p><p className="mt-2 text-sm text-dark-500">حجم فایل‌های فضای فعال</p></Card>
            <Card icon={<Smartphone/>} title="حساب تلگرام"><p className="mt-4 text-lg font-bold">{displayName}</p><p className="mt-1 flex items-center gap-1.5 text-sm text-dark-400" dir="ltr"><AtSign className="h-4 w-4"/>{user?.username || 'بدون نام کاربری'}</p><p className="mt-2 text-xs text-dark-500">شناسه: <span dir="ltr">{user?.telegram_id || '…'}</span></p></Card>

            <Card wide icon={<Users/>} title="حساب‌های این دستگاه" subtitle="چند حساب را نگه دار و بدون وارد کردن دوباره کد بینشان جابه‌جا شو."><div className="mt-4 grid gap-2 sm:grid-cols-2">{accounts.map(account => <div key={account.telegramId} className={`flex items-center gap-3 rounded-xl border p-3 ${account.telegramId === user?.telegram_id ? 'border-primary-400/30 bg-primary-500/10' : 'border-white/[.07] bg-dark-800/50'}`}><div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[.06] font-bold">{(account.user.display_name || account.user.first_name || 'ک')[0]}</div><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{account.user.display_name || [account.user.first_name, account.user.last_name].filter(Boolean).join(' ') || account.telegramId}</strong><small className="text-dark-500">{account.telegramId === user?.telegram_id ? 'حساب فعال' : `@${account.user.username || account.telegramId}`}</small></div>{account.telegramId !== user?.telegram_id && <button className="btn-secondary px-3 py-2 text-xs" onClick={() => activateAccount(account)}>ورود</button>}</div>)}</div><a href="/login?add=1" className="btn-secondary mt-3 flex min-h-11 items-center justify-center gap-2"><Plus className="h-4 w-4"/> افزودن حساب دیگر</a></Card>

            <div id="spaces" className="md:col-span-2 mt-2 flex items-center gap-2 border-b border-white/[.07] pb-2 text-sm font-bold text-primary-200">🗄️ کمدها و دسترسی</div>
            <Card wide icon={<Warehouse/>} title="فضاهای در دسترس" subtitle="فضای خودت یا کمدی که صاحبش با تو به اشتراک گذاشته است."><div className="mt-4 grid gap-2 sm:grid-cols-2">{workspaces.map(space => <button key={space.user_id} onClick={() => switchWorkspace(space.user_id)} className={`flex items-center gap-3 rounded-xl border p-3 text-right ${activeWorkspace === space.user_id ? 'border-primary-400/35 bg-primary-500/10' : 'border-white/[.07] bg-dark-800/50'}`}><Warehouse className="h-5 w-5 text-primary-300"/><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{space.name}</strong><small className="text-dark-500">{space.permission === 'owner' ? 'کمد خودم' : space.permission === 'write' ? 'اجازه مشاهده و ذخیره' : 'فقط مشاهده'}</small></span>{activeWorkspace === space.user_id && <span className="text-primary-300">✓</span>}</button>)}</div></Card>

            <Card wide icon={<Shield/>} title="اشتراک‌گذاری کمد من" subtitle="کاربر موردنظر باید قبلاً یک بار وارد کمد شده باشد."><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"><input inputMode="numeric" dir="ltr" value={shareTelegramId} onChange={event => setShareTelegramId(event.target.value.replace(/\D/g,''))} placeholder="آیدی تلگرام" className="rounded-xl border border-white/10 bg-dark-800 px-3 py-2.5 outline-none focus:border-primary-400"/><div className="flex rounded-xl border border-white/10 bg-dark-800 p-1"><button type="button" onClick={() => setSharePermission('read')} className={`rounded-lg px-3 py-2 text-xs transition ${sharePermission==='read'?'bg-primary-500/20 text-primary-200':'text-dark-400'}`}>فقط مشاهده</button><button type="button" onClick={() => setSharePermission('write')} className={`rounded-lg px-3 py-2 text-xs transition ${sharePermission==='write'?'bg-primary-500/20 text-primary-200':'text-dark-400'}`}>مشاهده و ذخیره</button></div><button disabled={grantWorkspace.isPending} onClick={() => void submitGrant()} className="btn-primary sm:col-span-2">دادن دسترسی</button></div>{grants.length > 0 && <div className="mt-4 space-y-2">{grants.map(grant => <div key={grant.user_id} className="flex items-center gap-3 rounded-xl bg-dark-800/50 p-3"><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{grant.name}</strong><small className="text-dark-500">{grant.permission === 'write' ? 'مشاهده و ذخیره' : 'فقط مشاهده'}</small></div><button title="لغو دسترسی" className="btn-icon text-red-300" onClick={() => void revokeWorkspace.mutateAsync(grant.user_id)}><Trash2 className="h-4 w-4"/></button></div>)}</div>}</Card>

            <Card wide icon={<MonitorSmartphone/>} title="نشست‌های فعال" subtitle="دستگاه‌هایی که با این حساب وارد کمد شده‌اند."><div className="mt-4 space-y-2">{sessions.length ? sessions.map(session => <div key={session.id} className="flex items-center gap-3 rounded-xl bg-dark-800/50 p-3"><MonitorSmartphone className="h-5 w-5 text-dark-400"/><div className="min-w-0 flex-1"><strong className="block text-sm">{session.device_name} {session.current && <span className="text-primary-300">· همین دستگاه</span>}</strong><small className="text-dark-500">آخرین فعالیت: {formatPersianDate(session.last_seen_at)}</small></div><button className="btn-icon text-red-300" title="خروج این دستگاه" onClick={() => void revokeSession.mutateAsync(session.id)}><LogOut className="h-4 w-4"/></button></div>) : <p className="text-sm text-dark-500">این ورود قدیمی است؛ از ورود بعدی نشست دستگاه ثبت می‌شود.</p>}</div><div className="mt-4 flex flex-col gap-2 sm:flex-row"><button className="btn-secondary flex min-h-11 flex-1 items-center justify-center gap-2 text-red-300" onClick={() => setConfirmation('device')}><LogOut className="h-4 w-4"/> خروج از این دستگاه</button><button className="btn-secondary flex min-h-11 flex-1 items-center justify-center gap-2 text-orange-300" onClick={() => setConfirmation('all')}><Users className="h-4 w-4"/> خروج از همه دستگاه‌ها</button></div></Card>

            <div id="appearance" className="md:col-span-2 mt-2 flex items-center gap-2 border-b border-white/[.07] pb-2 text-sm font-bold text-primary-200">🎨 ظاهر برنامه</div>
            <Card wide icon={<Palette/>} title="رنگ کمد"><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{(Object.entries(colorThemes) as [ColorTheme, typeof colorThemes[ColorTheme]][]).map(([key,item]) => <button key={key} onClick={() => chooseTheme(key)} className={`flex min-h-12 items-center justify-between gap-2 rounded-xl border px-3 ${theme===key?'border-white/40 bg-white/10':'border-white/[.07] bg-dark-800/60'}`}><span className="flex items-center gap-2"><span className="h-5 w-5 rounded-full" style={{backgroundColor:item.dot}}/>{item.label}</span>{theme===key&&'✓'}</button>)}</div></Card>
            <Card wide icon={<Download/>} title="نصب Komod"><div className="mt-3 flex items-center gap-3"><p className="min-w-0 flex-1 text-sm text-dark-400">کمد را مثل یک برنامه روی این دستگاه نصب کن.</p><button className="btn-primary" onClick={() => window.dispatchEvent(new Event('komod-install-request'))}>نصب</button></div></Card>

            {user?.is_admin && <Card wide icon={<UserRoundCog/>} title="مدیریت کاربران" subtitle="غیرفعال‌سازی، داده‌های کاربر را حذف نمی‌کند."><div className="mt-4 space-y-2">{adminUsers.map(item => <AdminRow key={item.id} item={item} onSave={(display_name) => updateAdmin.mutateAsync({id:item.id,display_name})} onToggle={() => updateAdmin.mutateAsync({id:item.id,is_active:!item.is_active})}/>)}</div></Card>}
        </div>
        {confirmation && <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setConfirmation(null)}><div className="w-full max-w-sm rounded-2xl border border-white/10 bg-dark-900 p-5" onClick={event=>event.stopPropagation()}><h2 className="text-lg font-bold">{confirmation==='all'?'خروج از همه دستگاه‌ها؟':'از این دستگاه خارج می‌شی؟'}</h2><p className="mt-2 text-sm text-dark-300">فایل‌ها و اطلاعات کمد حذف نمی‌شوند.</p><div className="mt-5 flex gap-2"><button className="flex-1 rounded-xl bg-red-500 px-4 py-2.5" onClick={() => confirmation==='all'?void logoutEverywhere():void logoutThisDevice()}>خروج</button><button className="btn-secondary flex-1" onClick={()=>setConfirmation(null)}>بی‌خیال</button></div></div></div>}
    </div>;
}

function Card({icon,title,subtitle,wide=false,children}:{icon:React.ReactElement;title:string;subtitle?:string;wide?:boolean;children:React.ReactNode}) { return <section className={`rounded-2xl border border-white/[.07] bg-dark-900/70 p-5 ${wide?'md:col-span-2':''}`}><div className="flex items-center gap-3"><span className="text-primary-300 [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div><h2 className="font-bold">{title}</h2>{subtitle&&<p className="mt-1 text-xs text-dark-400">{subtitle}</p>}</div></div>{children}</section>; }

function AdminRow({item,onSave,onToggle}:{item:any;onSave:(name:string)=>Promise<any>;onToggle:()=>Promise<any>}) { const [name,setName]=useState(item.display_name||[item.first_name,item.last_name].filter(Boolean).join(' ')); return <div className="grid gap-2 rounded-xl border border-white/[.06] bg-dark-800/50 p-3 sm:grid-cols-[1fr_auto_auto]"><div className="min-w-0"><input value={name} onChange={event=>setName(event.target.value)} onBlur={()=>void onSave(name)} className="w-full bg-transparent text-sm font-bold outline-none"/><p className="mt-1 text-xs text-dark-500">{formatFileSize(item.total_size)} · {item.file_count.toLocaleString('fa-IR')} فایل · {item.session_count.toLocaleString('fa-IR')} نشست</p></div><span className={`self-center rounded-full px-2.5 py-1 text-xs ${item.is_active?'bg-emerald-500/10 text-emerald-300':'bg-red-500/10 text-red-300'}`}>{item.is_active?'فعال':'غیرفعال'}</span><button className="btn-secondary text-xs" onClick={()=>void onToggle()}>{item.is_active?'غیرفعال‌کردن':'فعال‌کردن'}</button></div>; }
