import { useEffect, useState } from 'react';
import { ArrowRight, AtSign, ChevronDown, Download, HardDrive, LogOut, MonitorSmartphone, Palette, Plus, Shield, Smartphone, Trash2, UserRoundCog, Users, Warehouse } from 'lucide-react';
import { formatFileSize, formatPersianDate, useAdminUsers, useCurrentUser, useGrantWorkspace, useLogoutAll, useRevokeSession, useRevokeWorkspace, useSessions, useStorageStats, useUpdateAdminUser, useWorkspaceGrants, useWorkspaces } from '../lib/api';
import { activateAccount, forgetAccount, savedAccounts, syncCurrentAccount } from '../lib/accounts';
import { applyTheme, colorThemes, ColorTheme, getStoredTheme } from '../lib/theme';

type SettingsView = 'home' | 'accounts' | 'sessions' | 'access' | 'appearance' | 'admin';
type Permission = 'read' | 'write';

export default function SettingsPage() {
    const { data: storage } = useStorageStats();
    const { data: user } = useCurrentUser();
    const { data: sessions = [] } = useSessions();
    const { data: workspaces = [] } = useWorkspaces();
    const { data: grants = [] } = useWorkspaceGrants();
    const { data: adminUsers = [] } = useAdminUsers(Boolean(user?.is_admin));
    const logoutAll = useLogoutAll();
    const revokeSession = useRevokeSession();
    const grantWorkspace = useGrantWorkspace();
    const revokeWorkspace = useRevokeWorkspace();
    const updateAdmin = useUpdateAdminUser();
    const [view, setView] = useState<SettingsView>('home');
    const [theme, setTheme] = useState<ColorTheme>(getStoredTheme);
    const [confirmation, setConfirmation] = useState<'device' | 'all' | null>(null);
    const [shareTelegramId, setShareTelegramId] = useState('');
    const [sharePermission, setSharePermission] = useState<Permission>('read');
    const [accessMessage, setAccessMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    const accounts = savedAccounts();

    useEffect(() => applyTheme(theme), [theme]);
    useEffect(() => { if (user) syncCurrentAccount(user); }, [user]);

    const chooseTheme = (next: ColorTheme) => { setTheme(next); localStorage.setItem('komod-color-theme', next); applyTheme(next); };
    const logoutThisDevice = async (revoke = true) => {
        const currentSession = sessions.find(item => item.current);
        if (revoke && currentSession) {
            try { await revokeSession.mutateAsync(currentSession.id); } catch { /* credentials are cleared below */ }
        }
        if (user) forgetAccount(user.telegram_id);
        ['access_token', 'refresh_token', 'user', 'komod-active-workspace', 'komod-manual-account'].forEach(key => localStorage.removeItem(key));
        const next = savedAccounts()[0];
        if (next) activateAccount(next); else window.location.href = '/login';
    };
    const logoutEverywhere = async () => { try { await logoutAll.mutateAsync(); } finally { await logoutThisDevice(false); } };
    const displayName = user?.display_name || [user?.first_name, user?.last_name].filter(Boolean).join(' ') || 'کاربر کمد';
    const activeWorkspace = Number(localStorage.getItem('komod-active-workspace') || user?.id || 0);
    const switchWorkspace = (id: number) => {
        if (id === user?.id) localStorage.removeItem('komod-active-workspace');
        else localStorage.setItem('komod-active-workspace', String(id));
        window.location.href = '/';
    };
    const saveGrant = async (telegramId: number, permission: Permission) => {
        setAccessMessage(null);
        try {
            await grantWorkspace.mutateAsync({ telegram_id: telegramId, permission });
            setAccessMessage({ kind: 'ok', text: permission === 'write' ? 'دسترسی مشاهده و ذخیره فعال شد.' : 'دسترسی روی فقط مشاهده قرار گرفت.' });
        } catch (error: any) {
            setAccessMessage({ kind: 'error', text: error?.response?.data?.detail || 'تغییر دسترسی انجام نشد.' });
        }
    };
    const submitGrant = async () => {
        const telegramId = Number(shareTelegramId);
        if (!telegramId) { setAccessMessage({ kind: 'error', text: 'آیدی تلگرام را وارد کن.' }); return; }
        await saveGrant(telegramId, sharePermission);
        setShareTelegramId('');
    };

    return <div className="mx-auto w-full max-w-5xl p-4 pb-28 sm:p-6 md:pb-8 lg:p-8">
        <header className="mb-6 flex items-start gap-3">
            {view !== 'home' && <button className="btn-icon mt-1 shrink-0 text-primary-300" onClick={() => setView('home')} aria-label="برگشت به تنظیمات"><ArrowRight className="h-5 w-5"/></button>}
            <div><p className="text-xs font-semibold text-primary-300">⚙️ تنظیمات کمد</p><h1 className="mt-2 text-2xl font-bold sm:text-3xl">{viewTitle(view)}</h1><p className="mt-2 text-sm text-dark-400">{viewSubtitle(view)}</p></div>
        </header>

        {view === 'home' && <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
                <SummaryCard icon={<Smartphone/>} title={displayName} text="حساب فعال تلگرام" />
                <SummaryCard icon={<HardDrive/>} title={storage ? formatFileSize(storage.total_size) : '…'} text="حجم فایل‌های فضای فعال" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
                <SettingsButton icon={<Users/>} title="حساب‌ها" text="افزودن حساب و جابه‌جایی بین حساب‌ها" onClick={() => setView('accounts')} />
                <SettingsButton icon={<MonitorSmartphone/>} title="مدیریت نشست‌ها" text="دستگاه‌های واردشده و خروج از نشست‌ها" onClick={() => setView('sessions')} />
                <SettingsButton icon={<Shield/>} title="دسترسی و اشتراک‌گذاری" text="کمدهای مشترک و سطح دسترسی کاربران" onClick={() => setView('access')} />
                <SettingsButton icon={<Palette/>} title="ظاهر برنامه" text="رنگ کمد و نصب Komod روی دستگاه" onClick={() => setView('appearance')} />
                {user?.is_admin && <SettingsButton icon={<UserRoundCog/>} title="مدیریت کاربران" text="نام، وضعیت و مصرف کاربران کمد" onClick={() => setView('admin')} />}
            </div>
        </div>}

        {view === 'accounts' && <div className="space-y-4">
            <Card icon={<Smartphone/>} title="حساب فعال"><p className="mt-4 text-lg font-bold">{displayName}</p><p className="mt-1 flex items-center gap-1.5 text-sm text-dark-400" dir="ltr"><AtSign className="h-4 w-4"/>{user?.username || 'بدون نام کاربری'}</p><p className="mt-2 text-xs text-dark-500">آیدی تلگرام: <span dir="ltr">{user?.telegram_id || '…'}</span></p></Card>
            <Card icon={<Users/>} title="حساب‌های این دستگاه" subtitle="بین حساب‌های ذخیره‌شده جابه‌جا شو یا حساب تازه‌ای اضافه کن."><div className="mt-4 grid gap-2 sm:grid-cols-2">{accounts.map(account => <div key={account.telegramId} className={`flex items-center gap-3 rounded-xl border p-3 ${account.telegramId === user?.telegram_id ? 'border-primary-400/30 bg-primary-500/10' : 'border-white/[.07] bg-dark-800/50'}`}><div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[.06] font-bold">{(account.user.display_name || account.user.first_name || 'ک')[0]}</div><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{account.user.display_name || [account.user.first_name, account.user.last_name].filter(Boolean).join(' ') || account.telegramId}</strong><small className="text-dark-500">{account.telegramId === user?.telegram_id ? 'حساب فعال' : `@${account.user.username || account.telegramId}`}</small></div>{account.telegramId !== user?.telegram_id && <><button className="btn-secondary px-3 py-2 text-xs" onClick={() => activateAccount(account)}>ورود</button><button className="btn-icon text-red-300" title="حذف از این دستگاه" onClick={() => { forgetAccount(account.telegramId); window.location.reload(); }}><Trash2 className="h-4 w-4"/></button></>}</div>)}</div><a href="/login?add=1" className="btn-secondary mt-3 flex min-h-11 items-center justify-center gap-2"><Plus className="h-4 w-4"/> افزودن حساب دیگر</a></Card>
        </div>}

        {view === 'sessions' && <Card icon={<MonitorSmartphone/>} title="نشست‌های فعال" subtitle="دستگاه‌هایی که با حساب فعلی وارد کمد شده‌اند."><div className="mt-4 space-y-2">{sessions.length ? sessions.map(session => <div key={session.id} className="flex items-center gap-3 rounded-xl bg-dark-800/50 p-3"><MonitorSmartphone className="h-5 w-5 text-dark-400"/><div className="min-w-0 flex-1"><strong className="block text-sm">{session.device_name} {session.current && <span className="text-primary-300">· همین دستگاه</span>}</strong><small className="text-dark-500">آخرین فعالیت: {formatPersianDate(session.last_seen_at)}</small></div><button className="btn-icon text-red-300" title="خروج این دستگاه" onClick={() => void revokeSession.mutateAsync(session.id)}><LogOut className="h-4 w-4"/></button></div>) : <p className="text-sm text-dark-500">نشست فعالی ثبت نشده است.</p>}</div><div className="mt-4 flex flex-col gap-2 sm:flex-row"><button className="btn-secondary flex min-h-11 flex-1 items-center justify-center gap-2 text-red-300" onClick={() => setConfirmation('device')}><LogOut className="h-4 w-4"/> خروج از این دستگاه</button><button className="btn-secondary flex min-h-11 flex-1 items-center justify-center gap-2 text-orange-300" onClick={() => setConfirmation('all')}><Users className="h-4 w-4"/> خروج از همه دستگاه‌ها</button></div></Card>}

        {view === 'access' && <div className="space-y-4">
            <Card icon={<Warehouse/>} title="کمدهای در دسترس" subtitle="کمد خودت و فضاهایی که دیگران با تو به اشتراک گذاشته‌اند."><div className="mt-4 grid gap-2 sm:grid-cols-2">{workspaces.map(space => <button key={space.user_id} onClick={() => switchWorkspace(space.user_id)} className={`flex items-center gap-3 rounded-xl border p-3 text-right ${activeWorkspace === space.user_id ? 'border-primary-400/35 bg-primary-500/10' : 'border-white/[.07] bg-dark-800/50'}`}><Warehouse className="h-5 w-5 text-primary-300"/><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{space.name}</strong><small className="text-dark-500">{permissionLabel(space.permission)}</small></span>{activeWorkspace === space.user_id && <span className="text-primary-300">✓</span>}</button>)}</div></Card>
            <Card icon={<Shield/>} title="اشتراک‌گذاری کمد من" subtitle="کاربر موردنظر باید قبلاً یک بار وارد کمد شده باشد."><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_12rem_auto]"><input inputMode="numeric" dir="rtl" value={shareTelegramId} onChange={event => setShareTelegramId(event.target.value.replace(/\D/g,''))} placeholder="آیدی تلگرام" className="min-h-11 rounded-xl border border-white/10 bg-dark-800 px-3 py-2.5 text-right outline-none focus:border-primary-400"/><PermissionSelect value={sharePermission} onChange={setSharePermission}/><button disabled={grantWorkspace.isPending} onClick={() => void submitGrant()} className="btn-primary min-h-11">دادن دسترسی</button></div>{accessMessage && <p className={`mt-3 rounded-xl px-3 py-2 text-sm ${accessMessage.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>{accessMessage.text}</p>}{grants.length > 0 && <div className="mt-4 space-y-2">{grants.map(grant => <div key={grant.user_id} className="grid items-center gap-3 rounded-xl bg-dark-800/50 p-3 sm:grid-cols-[1fr_12rem_auto]"><div className="min-w-0"><strong className="block truncate text-sm">{grant.name}</strong><small className="text-dark-500" dir="ltr">{grant.username ? `@${grant.username}` : grant.telegram_id}</small></div><PermissionSelect value={grant.permission === 'write' ? 'write' : 'read'} onChange={permission => void saveGrant(grant.telegram_id, permission)}/><button title="لغو دسترسی" className="btn-icon text-red-300" onClick={() => void revokeWorkspace.mutateAsync(grant.user_id)}><Trash2 className="h-4 w-4"/></button></div>)}</div>}</Card>
        </div>}

        {view === 'appearance' && <div className="space-y-4"><Card icon={<Palette/>} title="رنگ کمد"><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">{(Object.entries(colorThemes) as [ColorTheme, typeof colorThemes[ColorTheme]][]).map(([key,item]) => <button key={key} onClick={() => chooseTheme(key)} className={`flex min-h-12 items-center justify-between gap-2 rounded-xl border px-3 ${theme===key?'border-white/40 bg-white/10':'border-white/[.07] bg-dark-800/60'}`}><span className="flex items-center gap-2"><span className="h-5 w-5 rounded-full" style={{backgroundColor:item.dot}}/>{item.label}</span>{theme===key&&'✓'}</button>)}</div></Card><Card icon={<Download/>} title="نصب Komod"><div className="mt-3 flex items-center gap-3"><p className="min-w-0 flex-1 text-sm text-dark-400">کمد را مثل یک برنامه روی این دستگاه نصب کن.</p><button className="btn-primary" onClick={() => window.dispatchEvent(new Event('komod-install-request'))}>نصب</button></div></Card></div>}

        {view === 'admin' && user?.is_admin && <Card icon={<UserRoundCog/>} title="مدیریت کاربران" subtitle="غیرفعال‌سازی، داده‌های کاربر را حذف نمی‌کند."><div className="mt-4 space-y-2">{adminUsers.map(item => <AdminRow key={item.id} item={item} onSave={(display_name) => updateAdmin.mutateAsync({id:item.id,display_name})} onToggle={() => updateAdmin.mutateAsync({id:item.id,is_active:!item.is_active})}/>)}</div></Card>}

        {confirmation && <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setConfirmation(null)}><div className="w-full max-w-sm rounded-2xl border border-white/10 bg-dark-900 p-5" onClick={event=>event.stopPropagation()}><h2 className="text-lg font-bold">{confirmation==='all'?'خروج از همه دستگاه‌ها؟':'از این دستگاه خارج می‌شی؟'}</h2><p className="mt-2 text-sm text-dark-300">فایل‌ها و اطلاعات کمد حذف نمی‌شوند.</p><div className="mt-5 flex gap-2"><button className="flex-1 rounded-xl bg-red-500 px-4 py-2.5" onClick={() => confirmation==='all'?void logoutEverywhere():void logoutThisDevice()}>خروج</button><button className="btn-secondary flex-1" onClick={()=>setConfirmation(null)}>بی‌خیال</button></div></div></div>}
    </div>;
}

function viewTitle(view: SettingsView) { return ({ home:'تنظیمات', accounts:'حساب‌ها', sessions:'مدیریت نشست‌ها', access:'دسترسی و اشتراک‌گذاری', appearance:'ظاهر برنامه', admin:'مدیریت کاربران' })[view]; }
function viewSubtitle(view: SettingsView) { return ({ home:'بخش موردنظرت را انتخاب کن.', accounts:'حساب‌های ذخیره‌شده روی این دستگاه.', sessions:'ورودهای فعال حساب فعلی را مدیریت کن.', access:'مشخص کن چه کسی کمدت را ببیند یا داخلش فایل ذخیره کند.', appearance:'رنگ و نحوه نصب کمد را تنظیم کن.', admin:'کاربران کمد را مدیریت کن.' })[view]; }
function permissionLabel(permission: 'owner' | Permission) { return permission === 'owner' ? 'کمد خودم' : permission === 'write' ? 'مشاهده و ذخیره' : 'فقط مشاهده'; }
function PermissionSelect({ value, onChange }:{ value:Permission; onChange:(value:Permission)=>void }) { return <label className="relative block min-w-0"><select value={value} onChange={event => onChange(event.target.value as Permission)} className="min-h-11 w-full appearance-none rounded-xl border border-white/10 bg-dark-800 py-2.5 pr-3 pl-9 text-sm outline-none transition focus:border-primary-400"><option value="read">فقط مشاهده</option><option value="write">مشاهده و ذخیره</option></select><ChevronDown className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary-300"/></label>; }
function SettingsButton({icon,title,text,onClick}:{icon:React.ReactElement;title:string;text:string;onClick:()=>void}) { return <button onClick={onClick} className="group flex min-h-28 items-center gap-4 rounded-2xl border border-white/[.07] bg-dark-900/70 p-5 text-right transition hover:border-primary-400/25 hover:bg-primary-500/[.06]"><span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-300 [&>svg]:h-6 [&>svg]:w-6">{icon}</span><span className="min-w-0 flex-1"><strong className="block">{title}</strong><small className="mt-1 block leading-6 text-dark-400">{text}</small></span><ArrowRight className="h-5 w-5 rotate-180 text-dark-600 transition group-hover:text-primary-300"/></button>; }
function SummaryCard({icon,title,text}:{icon:React.ReactElement;title:string;text:string}) { return <div className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-dark-900/70 p-4"><span className="text-primary-300 [&>svg]:h-5 [&>svg]:w-5">{icon}</span><span><strong className="block text-sm">{title}</strong><small className="text-dark-500">{text}</small></span></div>; }
function Card({icon,title,subtitle,children}:{icon:React.ReactElement;title:string;subtitle?:string;children:React.ReactNode}) { return <section className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-5"><div className="flex items-center gap-3"><span className="text-primary-300 [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div><h2 className="font-bold">{title}</h2>{subtitle&&<p className="mt-1 text-xs text-dark-400">{subtitle}</p>}</div></div>{children}</section>; }
function AdminRow({item,onSave,onToggle}:{item:any;onSave:(name:string)=>Promise<any>;onToggle:()=>Promise<any>}) { const [name,setName]=useState(item.display_name||[item.first_name,item.last_name].filter(Boolean).join(' ')); return <div className="grid gap-2 rounded-xl border border-white/[.06] bg-dark-800/50 p-3 sm:grid-cols-[1fr_auto_auto]"><div className="min-w-0"><input value={name} onChange={event=>setName(event.target.value)} onBlur={()=>void onSave(name)} className="w-full bg-transparent text-sm font-bold outline-none"/><p className="mt-1 text-xs text-dark-500">{formatFileSize(item.total_size)} · {item.file_count.toLocaleString('fa-IR')} فایل · {item.session_count.toLocaleString('fa-IR')} نشست</p></div><span className={`self-center rounded-full px-2.5 py-1 text-xs ${item.is_active?'bg-emerald-500/10 text-emerald-300':'bg-red-500/10 text-red-300'}`}>{item.is_active?'فعال':'غیرفعال'}</span><button className="btn-secondary text-xs" onClick={()=>void onToggle()}>{item.is_active?'غیرفعال‌کردن':'فعال‌کردن'}</button></div>; }
