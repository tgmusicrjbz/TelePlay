import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, AtSign, ChevronLeft, AudioLines, Check, CheckCircle2, Database, Download, FileStack, FileText, FolderPlus, Gauge, Globe2, HardDrive, KeyRound, ListRestart, LockKeyhole, LogOut, MonitorSmartphone, Moon, Palette, Pencil, Plus, RefreshCw, Search, Shield, Smartphone, Sun, Tags, Trash2, UserRoundCog, Users, Warehouse, XCircle } from 'lucide-react';
import { AdminUser, Folder, TelegramFile, api, formatFileSize, formatPersianDate, getServerOrigin, useAccountPreferences, useAddAdminUser, useAdminErrors, useAdminHealth, useAdminStats, useAdminUsers, useCredentials, useCurrentUser, useFiles, useFolderTree, useGrantWorkspace, useLogoutAll, useLogoutOthers, useRemoveAdminUser, useResetStorageChannel, useResolveAdminError, useRevokeSession, useRevokeWorkspace, useSecurityEvents, useSessions, useSetStorageChannel, useSetVaultPassword, useStorageChannel, useStorageStats, useUnlockVault, useUpdateAccountPreferences, useUpdateAdminUser, useUpdateCredentials, useVaultStatus, useWorkspaceGrants, useWorkspaces } from '../lib/api';
import { activateAccount, forgetAccount, savedAccounts, saveAuthenticatedAccount, syncCurrentAccount } from '../lib/accounts';
import { applyAppearanceMode, applyCustomTheme, applyTheme, colorThemes, ActiveTheme, AppearanceMode, ColorTheme, getStoredAppearanceMode, getStoredTheme } from '../lib/theme';
import CustomSelect from './CustomSelect';
import TagSettingsPanel from './TagSettingsPanel';
import TransferCenter from './TransferCenter';
import TTSSettingsPanel from './TTSSettingsPanel';
import { useAppStore } from '../lib/store';

type SettingsView = 'home' | 'accounts' | 'security' | 'sessions' | 'access' | 'storage' | 'files' | 'appearance' | 'connection' | 'admin' | 'tags' | 'transfers' | 'tts';
type Permission = 'read' | 'write';
type SavedColor = { color: string; name: string };
type ServerAddress = { url: string; name: string };
const SettingsSectionContext = createContext<string | null>(null);

export default function SettingsPage() {
    const setActiveSection = useAppStore(state => state.setActiveSection);
    const { data: storage } = useStorageStats();
    const { data: user } = useCurrentUser();
    const { data: sessions = [] } = useSessions();
    const { data: securityEvents = [] } = useSecurityEvents();
    const { data: workspaces = [] } = useWorkspaces();
    const { data: folderTree = [] } = useFolderTree();
    const { data: grants = [] } = useWorkspaceGrants();
    const { data: adminUsers = [], isLoading: adminUsersLoading, isError: adminUsersError, refetch: refetchAdminUsers } = useAdminUsers(Boolean(user?.is_admin));
    const { data: adminStats, isLoading: adminStatsLoading, refetch: refetchAdminStats } = useAdminStats(Boolean(user?.is_admin));
    const { data: adminHealth, isLoading: adminHealthLoading, isError: adminHealthError, isFetching: adminHealthFetching, refetch: refetchAdminHealth } = useAdminHealth(Boolean(user?.is_admin));
    const { data: accountPreferences } = useAccountPreferences();
    const { data: storageChannel } = useStorageChannel();
    const { data: credentials } = useCredentials();
    const { data: vaultStatus } = useVaultStatus();
    const logoutAll = useLogoutAll();
    const logoutOthers = useLogoutOthers();
    const revokeSession = useRevokeSession();
    const grantWorkspace = useGrantWorkspace();
    const revokeWorkspace = useRevokeWorkspace();
    const updateAdmin = useUpdateAdminUser();
    const addAdminUser = useAddAdminUser();
    const removeAdminUser = useRemoveAdminUser();
    const setStorageChannel = useSetStorageChannel();
    const resetStorageChannel = useResetStorageChannel();
    const updateCredentials = useUpdateCredentials();
    const updateAccountPreferences = useUpdateAccountPreferences();
    const setVaultPassword = useSetVaultPassword();
    const unlockVault = useUnlockVault();
    const [view, setView] = useState<SettingsView>(() => {
        const target = localStorage.getItem('komod-settings-target') as SettingsView | null;
        localStorage.removeItem('komod-settings-target');
        return target === 'tts' ? 'tts' : 'home';
    });
    const [theme, setTheme] = useState<ActiveTheme>(getStoredTheme);
    const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(getStoredAppearanceMode);
    const [forceOffline, setForceOffline] = useState(() => localStorage.getItem('komod-force-offline') === '1');
    const [youtubeFolder, setYoutubeFolder] = useState(() => localStorage.getItem('komod-youtube-folder') || 'none');
    const [instagramFolder, setInstagramFolder] = useState(() => localStorage.getItem('komod-instagram-folder') || 'none');
    const [serverUrl, setServerUrl] = useState('');
    const [serverName, setServerName] = useState('مسیر جایگزین');
    const [serverAddresses, setServerAddresses] = useState<ServerAddress[]>(() => { try { return JSON.parse(localStorage.getItem('komod-server-addresses') || '[]'); } catch { return []; } });
    const [pingResult, setPingResult] = useState<{ url:string; ms?:number; ok:boolean } | null>(null);
    const [confirmation, setConfirmation] = useState<'device' | 'others' | 'all' | null>(null);
    const [importingBackup, setImportingBackup] = useState(false);
    const [shareTelegramId, setShareTelegramId] = useState('');
    const [sharePermission, setSharePermission] = useState<Permission>('read');
    const [limitedShare, setLimitedShare] = useState(false);
    const [shareFolderIds, setShareFolderIds] = useState<number[]>([]);
    const [shareFileIds, setShareFileIds] = useState<number[]>([]);
    const [shareFileSearch, setShareFileSearch] = useState('');
    const [editingGrantId, setEditingGrantId] = useState<number|null>(null);
    const [selectingAllShareFiles, setSelectingAllShareFiles] = useState(false);
    const { data: shareFileResults } = useFiles(undefined, undefined, shareFileSearch.trim() || '__no_file_selected__', 1);
    const [accessMessage, setAccessMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
    const [adminQuery, setAdminQuery] = useState('');
    const [newAdminTelegramId, setNewAdminTelegramId] = useState('');
    const [newAdminName, setNewAdminName] = useState('');
    const [storageChannelInput, setStorageChannelInput] = useState('');
    const [storageChannelMessage, setStorageChannelMessage] = useState<{kind:'ok'|'error';text:string}|null>(null);
    const [credentialUsername,setCredentialUsername]=useState('');
    const [currentPassword,setCurrentPassword]=useState('');
    const [newPassword,setNewPassword]=useState('');
    const [repeatPassword,setRepeatPassword]=useState('');
    const [credentialMessage,setCredentialMessage]=useState<{kind:'ok'|'error';text:string}|null>(null);
    const [vaultPassword,setVaultPasswordValue]=useState('');
    const [vaultMessage,setVaultMessage]=useState<{kind:'ok'|'error';text:string}|null>(null);
    const [activeSubsection,setActiveSubsection]=useState<string|null>(null);
    const accounts = savedAccounts();
    const incomingFolderOptions = useMemo(() => {
        const result = [{value:'default',label:'🗃️ کشوی پیش‌فرض'}];
        const walk = (items:Folder[], depth=0) => items.forEach(folder => { result.push({value:String(folder.id),label:`${'— '.repeat(depth)}🗂️ ${folder.name}`}); if(folder.children) walk(folder.children,depth+1); });
        walk(folderTree); return result;
    }, [folderTree]);
    const shareFolders = useMemo(() => {
        const result:Array<{id:number;name:string;depth:number}>=[];
        const walk=(items:Folder[],depth=0)=>items.forEach(folder=>{result.push({id:folder.id,name:folder.name,depth});if(folder.children)walk(folder.children,depth+1)});
        walk(folderTree); return result;
    },[folderTree]);
    const filteredAdminUsers = useMemo(() => {
        const query = adminQuery.trim().toLocaleLowerCase('fa');
        if (!query) return adminUsers;
        return adminUsers.filter(item => [item.display_name, item.first_name, item.last_name, item.username, String(item.telegram_id)].filter(Boolean).some(value => String(value).toLocaleLowerCase('fa').includes(query)));
    }, [adminQuery, adminUsers]);
    const saveStorageChannel = async () => { const channelId=Number(storageChannelInput.trim()); if(!Number.isSafeInteger(channelId)){setStorageChannelMessage({kind:'error',text:'آیدی عددی معتبر کانال را وارد کن.'});return;} try{const result=await setStorageChannel.mutateAsync(channelId);setStorageChannelMessage({kind:'ok',text:`کانال «${result.title||'انتخاب‌شده'}» برای فایل‌های تازه فعال شد.`});setStorageChannelInput('');}catch(error:any){setStorageChannelMessage({kind:'error',text:error?.response?.data?.detail||'اتصال کانال انجام نشد.'});} };

    useEffect(() => applyTheme(theme), [theme]);
    useEffect(() => { if (user) syncCurrentAccount(user); }, [user]);
    useEffect(() => { if (credentials?.username) setCredentialUsername(credentials.username); }, [credentials?.username]);
    useEffect(() => { if (confirmation === 'others') void logoutOtherDevices(); }, [confirmation]);
    useEffect(() => {
        const openTTS = () => { localStorage.removeItem('komod-settings-target'); setView('tts'); };
        window.addEventListener('komod-open-tts', openTTS);
        return () => window.removeEventListener('komod-open-tts', openTTS);
    }, []);
    useEffect(() => {
        const frame = window.requestAnimationFrame(() => {
            document.querySelector<HTMLElement>('[data-main-scroll="true"]')?.scrollTo({ top: 0, behavior: 'auto' });
            window.scrollTo({ top: 0, behavior: 'auto' });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [view]);

    const chooseTheme = (next: ActiveTheme) => { setTheme(next); localStorage.setItem('komod-color-theme', next); applyTheme(next); };
    const chooseAppearanceMode = (next: AppearanceMode) => { setAppearanceMode(next); localStorage.setItem('komod-appearance-mode', next); applyAppearanceMode(next); };
    const changeConnectionMode = (offline: boolean) => {
        setForceOffline(offline);
        if (offline) localStorage.setItem('komod-force-offline', '1'); else localStorage.removeItem('komod-force-offline');
        window.dispatchEvent(new Event('komod-connectivity-mode'));
    };
    const saveCredentials = async () => {
        setCredentialMessage(null);
        if (newPassword && newPassword !== repeatPassword) { setCredentialMessage({kind:'error',text:'تکرار رمز با رمز جدید یکسان نیست.'}); return; }
        try {
            const auth = await updateCredentials.mutateAsync({username:credentialUsername.trim(),current_password:currentPassword||undefined,new_password:newPassword||undefined});
            saveAuthenticatedAccount(auth);
            setCurrentPassword(''); setNewPassword(''); setRepeatPassword('');
            setCredentialMessage({kind:'ok',text:'اطلاعات ورود امن ذخیره شد.'});
        } catch(error:any) { setCredentialMessage({kind:'error',text:error?.response?.data?.detail||'ذخیره اطلاعات ورود انجام نشد.'}); }
    };
    const saveServerAddress = () => {
        const raw = serverUrl.trim().replace(/\/+$/, '');
        try { const parsed = new URL(raw); if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost','127.0.0.1'].includes(parsed.hostname))) throw new Error(); }
        catch { setPingResult({url:raw,ok:false}); return; }
        const next = [{url:raw,name:serverName.trim()||'مسیر جایگزین'}, ...serverAddresses.filter(item=>item.url!==raw)].slice(0,8);
        setServerAddresses(next); localStorage.setItem('komod-server-addresses',JSON.stringify(next)); setServerUrl('');
    };
    const selectServerAddress = (url:string) => { localStorage.setItem('komod-server-origin',url); window.location.reload(); };
    const useDefaultServer = () => { localStorage.removeItem('komod-server-origin'); window.location.reload(); };
    const pingServer = async (url:string) => { const started=performance.now(); try { const controller=new AbortController(); const timer=window.setTimeout(()=>controller.abort(),7000); const response=await fetch(`${url.replace(/\/+$/,'')}/health`,{signal:controller.signal,cache:'no-store'}); window.clearTimeout(timer); setPingResult({url,ok:response.ok,ms:Math.round(performance.now()-started)}); } catch { setPingResult({url,ok:false}); } };
    const logoutThisDevice = async (revoke = true) => {
        const currentSession = sessions.find(item => item.current);
        if (revoke && currentSession) {
            try { await revokeSession.mutateAsync(currentSession.id); } catch { /* credentials are cleared below */ }
        }
        if (user) forgetAccount(user.telegram_id);
        ['access_token', 'refresh_token', 'user', 'komod-active-workspace', 'komod-active-workspace-permission', 'komod-manual-account'].forEach(key => localStorage.removeItem(key));
        const next = savedAccounts()[0];
        if (next) activateAccount(next); else window.location.href = '/login';
    };
    const logoutEverywhere = async () => { try { await logoutAll.mutateAsync(); } finally { await logoutThisDevice(false); } };
    const logoutOtherDevices = async () => { await logoutOthers.mutateAsync(); setConfirmation(null); };
    const addAuthorizedUser = async () => {
        const telegramId = Number(newAdminTelegramId.trim());
        if (!Number.isSafeInteger(telegramId) || telegramId <= 0) return;
        await addAdminUser.mutateAsync({ telegram_id: telegramId, display_name: newAdminName.trim() || undefined });
        setNewAdminTelegramId(''); setNewAdminName('');
    };
    const displayName = [user?.first_name, user?.last_name].filter(Boolean).join(' ') || (user?.username ? `@${user.username}` : '') || 'کاربر کمد';
    const activeWorkspace = Number(localStorage.getItem('komod-active-workspace') || user?.id || 0);
    const switchWorkspace = (id: number) => {
        const selected = workspaces.find(space => space.user_id === id);
        if (id === user?.id) {
            localStorage.removeItem('komod-active-workspace');
            localStorage.removeItem('komod-active-workspace-permission');
        } else {
            localStorage.setItem('komod-active-workspace', String(id));
            localStorage.setItem('komod-active-workspace-permission', selected?.permission || 'read');
        }
        window.location.href = '/';
    };
    const saveGrant = async (telegramId: number, permission: Permission) => {
        setAccessMessage(null);
        try {
            const existing=grants.find(item=>item.telegram_id===telegramId);
            await grantWorkspace.mutateAsync({ telegram_id: telegramId, permission, folder_ids:existing?.folder_ids||[], file_ids:existing?.file_ids||[] });
            setAccessMessage({ kind: 'ok', text: permission === 'write' ? 'دسترسی مشاهده و ذخیره فعال شد.' : 'دسترسی روی فقط مشاهده قرار گرفت.' });
        } catch (error: any) {
            setAccessMessage({ kind: 'error', text: error?.response?.data?.detail || 'تغییر دسترسی انجام نشد.' });
        }
    };
    const editGrantScope = (grant: typeof grants[number]) => {
        setEditingGrantId(grant.user_id);
        setShareTelegramId(String(grant.telegram_id));
        setSharePermission(grant.permission === 'write' ? 'write' : 'read');
        setShareFolderIds(grant.folder_ids || []);
        setShareFileIds(grant.file_ids || []);
        setLimitedShare(Boolean(grant.folder_ids?.length || grant.file_ids?.length));
        setAccessMessage(null);
    };
    const addAllMatchingShareFiles = async () => {
        const query=shareFileSearch.trim();
        if(!query)return;
        setSelectingAllShareFiles(true);
        try {
            const ids=new Set(shareFileIds);
            let page=1;
            for(;;){
                const {data}=await api.get<{files:TelegramFile[];total:number;per_page:number}>('/files',{params:{search:query,page,per_page:100}});
                data.files.forEach(file=>ids.add(file.id));
                if(page*data.per_page>=data.total)break;
                page+=1;
            }
            setShareFileIds(Array.from(ids));
        } catch { setAccessMessage({kind:'error',text:'افزودن همهٔ نتایج انجام نشد.'}); }
        finally { setSelectingAllShareFiles(false); }
    };
    const submitGrant = async () => {
        const identifier = shareTelegramId.trim();
        if (!identifier) { setAccessMessage({ kind: 'error', text: 'آیدی عددی یا نام کاربری تلگرام را وارد کن.' }); return; }
        setAccessMessage(null);
        try {
            const scope={folder_ids:limitedShare?shareFolderIds:[],file_ids:limitedShare?shareFileIds:[]};
            if(limitedShare&&!scope.folder_ids.length&&!scope.file_ids.length){setAccessMessage({kind:'error',text:'حداقل یک کشو یا فایل را انتخاب کن.'});return;}
            await grantWorkspace.mutateAsync(/^\d+$/.test(identifier) ? { telegram_id: Number(identifier), permission: sharePermission, ...scope } : { identifier, permission: sharePermission, ...scope });
            setAccessMessage({ kind: 'ok', text: sharePermission === 'write' ? 'دسترسی مشاهده و ذخیره فعال شد.' : 'دسترسی روی فقط مشاهده قرار گرفت.' });
            setShareTelegramId('');
            setShareFolderIds([]);setShareFileIds([]);
            setEditingGrantId(null);
        } catch (error: any) { setAccessMessage({ kind: 'error', text: error?.response?.data?.detail || 'تغییر دسترسی انجام نشد.' }); }
    };
    const restoreBackup = async (file?: File) => {
        if (!file) return;
        if (file.size > 5 * 1024 * 1024) { useAppStore.getState().addToast('فایل پشتیبان بیش از حد بزرگ است.', 'error'); return; }
        setImportingBackup(true);
        try {
            const payload = JSON.parse(await file.text());
            if (!window.confirm('تنظیمات و متادیتای این نسخه با حساب فعلی ادغام شود؟ فایل‌های اصلی پاک نمی‌شوند.')) return;
            const {data} = await api.post<{folders_created:number;files_restored:number;playlists_restored:number}>('/accounts/import',payload);
            useAppStore.getState().addToast(`${data.files_restored.toLocaleString('fa-IR')} فایل و ${data.playlists_restored.toLocaleString('fa-IR')} پلی‌لیست بازیابی شد.`);
            window.setTimeout(()=>window.location.reload(),700);
        } catch (error:any) {
            useAppStore.getState().addToast(error?.response?.data?.detail || 'بازیابی نسخه پشتیبان انجام نشد.', 'error');
        } finally { setImportingBackup(false); }
    };
    const sectionLinks = settingsSectionLinks(view);
    const selectedSubsection = sectionLinks.some(item=>item.id===activeSubsection) ? activeSubsection : sectionLinks[0]?.id || null;
    const { data: adminErrors = [] } = useAdminErrors(Boolean(user?.is_admin) && view === 'admin' && selectedSubsection === 'admin-health');
    const resolveAdminError = useResolveAdminError();
    const goBack = () => {
        if (view === 'tts' && sessionStorage.getItem('komod-settings-return-section') === 'files') {
            sessionStorage.removeItem('komod-settings-return-section');
            setActiveSection('files');
            return;
        }
        setView('home');
    };
    useEffect(() => {
        if (view === 'home') return;
        const backButton = (window as Window & {Telegram?:{WebApp?:{BackButton?:{show:()=>void;hide:()=>void;onClick:(handler:()=>void)=>void;offClick:(handler:()=>void)=>void}}}}).Telegram?.WebApp?.BackButton;
        if (!backButton) return;
        backButton.show();
        backButton.onClick(goBack);
        return () => { backButton.offClick(goBack); backButton.hide(); };
    }, [view]);
    useEffect(() => {
        if (view !== 'tts' || sessionStorage.getItem('komod-settings-return-section') !== 'files') return;
        const returnToFiles = () => {
            sessionStorage.removeItem('komod-settings-return-section');
            setActiveSection('files');
        };
        window.addEventListener('popstate', returnToFiles);
        return () => window.removeEventListener('popstate', returnToFiles);
    }, [view, setActiveSection]);

    return <SettingsSectionContext.Provider value={selectedSubsection}><div className="mx-auto w-full max-w-5xl p-4 pb-28 sm:p-6 md:pb-8 lg:p-8">
        <header className="mb-6 flex items-start gap-3">
            {view !== 'home' && <button className="btn-icon mt-1 shrink-0 text-primary-300" onClick={goBack} aria-label={view==='tts'&&sessionStorage.getItem('komod-settings-return-section')==='files'?'برگشت به کمد من':'برگشت به تنظیمات'}><ArrowRight className="h-5 w-5"/></button>}
            <div><p className="text-xs font-semibold text-primary-300">⚙️ تنظیمات کمد</p><h1 className="mt-2 text-2xl font-bold sm:text-3xl">{viewTitle(view)}</h1><p className="mt-2 text-sm text-dark-400">{viewSubtitle(view)}</p></div>
        </header>

        {sectionLinks.length>1&&<SectionJumpNav items={sectionLinks} active={selectedSubsection} onChange={setActiveSubsection} mobileGrid={view==='admin'}/>}

        {view === 'home' && <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <SummaryCard icon={<Smartphone/>} title={displayName} text="حساب فعال تلگرام" />
                <SummaryCard icon={<HardDrive/>} title={storage ? formatFileSize(storage.total_size) : '…'} text="حجم فایل‌های فضای فعال" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <SettingsButton icon={<Users/>} title="حساب‌ها" text="افزودن حساب و جابه‌جایی بین حساب‌ها" onClick={() => setView('accounts')} />
                <SettingsButton icon={<KeyRound/>} title="ورود و امنیت" text="نام کاربری، رمز عبور و بازیابی امن" onClick={() => setView('security')} />
                <SettingsButton icon={<MonitorSmartphone/>} title="مدیریت نشست‌ها" text="دستگاه‌های واردشده و خروج از نشست‌ها" onClick={() => setView('sessions')} />
                <SettingsButton icon={<Shield/>} title="دسترسی و اشتراک‌گذاری" text="کمدهای مشترک و سطح دسترسی کاربران" onClick={() => setView('access')} />
                <SettingsButton icon={<Database/>} title="فضای ذخیره‌سازی" text="اتصال کانال خصوصی خودت برای فایل‌های تازه" onClick={() => setView('storage')} />
                <SettingsButton icon={<FolderPlus/>} title="فایل‌ها و مقصدها" text="محل فایل‌های تازه، لینک‌ها و نصب برنامه" onClick={() => setView('files')} />
                <SettingsButton icon={<Palette/>} title="ظاهر برنامه" text="رنگ کمد و نصب Komod روی دستگاه" onClick={() => setView('appearance')} />
                <SettingsButton icon={<Tags/>} title="مدیریت تگ‌ها" text="ساخت، رنگ‌بندی و شیوه نمایش تگ‌ها" onClick={() => setView('tags')} />
                <SettingsButton icon={<ListRestart/>} title="مرکز انتقال‌ها" text="صف دانلود، آپلود، لینک‌ها و ذخیره آفلاین" onClick={() => setView('transfers')} />
                <SettingsButton icon={<AudioLines/>} title="متن و صدا" text="تبدیل متن به صدا و استخراج متن از فایل صوتی یا ویدیویی" onClick={() => setView('tts')} />
                {user?.is_admin && <SettingsButton icon={<Globe2/>} title="اتصال برنامه" text="آدرس اصلی یا مسیر HTTPS جایگزین" onClick={() => setView('connection')} />}
                {user?.is_admin && <SettingsButton icon={<UserRoundCog/>} title="مدیریت کاربران" text="نام، وضعیت و مصرف کاربران کمد" onClick={() => setView('admin')} />}
            </div>
            <button type="button" onClick={() => window.dispatchEvent(new Event('komod-install-request'))} className="mx-auto flex min-h-9 items-center gap-2 rounded-xl px-3 text-xs text-dark-400 transition hover:bg-white/[.05] hover:text-primary-200"><Download className="h-4 w-4"/>نصب کمد روی این دستگاه</button>
        </div>}

        {view === 'accounts' && <div className="space-y-4">
            <Card id="accounts-current" icon={<Smartphone/>} title="حساب فعال"><p className="mt-4 text-lg font-bold">{displayName}</p><p className="mt-1 flex items-center gap-1.5 text-sm text-dark-400" dir="ltr"><AtSign className="h-4 w-4"/>{user?.username || 'بدون نام کاربری'}</p><p className="mt-2 text-xs text-dark-500">آیدی تلگرام: <span dir="ltr">{user?.telegram_id || '…'}</span></p><div className="mt-4 grid gap-2 sm:grid-cols-2"><button className="btn-secondary flex min-h-10 items-center justify-center gap-2 px-4 text-xs" onClick={async()=>{try{const response=await api.get('/accounts/export',{responseType:'blob'});const url=URL.createObjectURL(response.data);const anchor=document.createElement('a');anchor.href=url;anchor.download=`komod-backup-${user?.telegram_id||'account'}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{useAppStore.getState().addToast('گرفتن نسخه پشتیبان انجام نشد.','error');}}}><Download className="h-4 w-4"/>گرفتن نسخه پشتیبان</button><label className={`btn-secondary flex min-h-10 cursor-pointer items-center justify-center gap-2 px-4 text-xs ${importingBackup?'pointer-events-none opacity-50':''}`}><RefreshCw className={`h-4 w-4 ${importingBackup?'animate-spin':''}`}/>{importingBackup?'در حال بازیابی…':'بازیابی نسخه'}<input type="file" accept="application/json,.json" className="hidden" onChange={event=>{void restoreBackup(event.target.files?.[0]);event.currentTarget.value='';}}/></label></div><p className="mt-2 text-[10px] leading-5 text-dark-500">ساختار کشوها، پلی‌لیست‌ها و تنظیمات ذخیره می‌شود؛ رمزها و کلیدهای خصوصی داخل فایل نیستند.</p></Card>
            <Card id="accounts-device" icon={<Users/>} title="حساب‌های این دستگاه" subtitle="بین حساب‌های ذخیره‌شده جابه‌جا شو یا حساب تازه‌ای اضافه کن."><div className="mt-4 grid gap-2 sm:grid-cols-2">{accounts.map(account => {const telegramName=[account.user.first_name,account.user.last_name].filter(Boolean).join(' ')||account.user.username||String(account.telegramId);return <div key={account.telegramId} className={`flex items-center gap-3 rounded-xl border p-3 ${account.telegramId === user?.telegram_id ? 'border-primary-400/30 bg-primary-500/10' : 'border-white/[.07] bg-dark-800/50'}`}><div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[.06] font-bold">{telegramName[0]}</div><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{telegramName}</strong><small className="text-dark-500">{account.telegramId === user?.telegram_id ? 'حساب فعال' : `@${account.user.username || account.telegramId}`}</small></div>{account.telegramId !== user?.telegram_id && <><button className="btn-secondary px-3 py-2 text-xs" onClick={() => activateAccount(account)}>ورود</button><button className="btn-icon text-red-300" title="حذف از این دستگاه" onClick={() => { forgetAccount(account.telegramId); window.location.reload(); }}><Trash2 className="h-4 w-4"/></button></>}</div>})}</div><a href="/login?add=1" className="btn-secondary mt-3 flex min-h-11 items-center justify-center gap-2"><Plus className="h-4 w-4"/> افزودن حساب دیگر</a></Card>
        </div>}

        {view === 'tags' && <TagSettingsPanel activeSection={selectedSubsection}/>}
        {view === 'transfers' && <TransferCenter/>}

        {view === 'security' && <div className="space-y-4"><Card id="security-login" icon={<KeyRound/>} title={credentials?.enabled?'تغییر اطلاعات ورود':'فعال‌کردن ورود مستقل'} subtitle="ورود مستقیم با نام کاربری و رمز."><div className="mt-4 space-y-3"><label className="block text-xs text-dark-400">نام کاربری<input dir="rtl" autoComplete="username" value={credentialUsername} onChange={event=>setCredentialUsername(event.target.value.toLowerCase())} className="input mt-1.5 w-full text-right" placeholder="komod_user"/></label>{credentials?.enabled&&<label className="block text-xs text-dark-400">رمز فعلی<input dir="rtl" type="password" autoComplete="current-password" value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)} className="input mt-1.5 w-full text-right" placeholder="برای تأیید تغییرات"/></label>}<div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs text-dark-400">رمز جدید<input dir="rtl" type="password" autoComplete="new-password" value={newPassword} onChange={event=>setNewPassword(event.target.value)} className="input mt-1.5 w-full text-right" placeholder="حداقل ۱۰ نویسه"/></label><label className="block text-xs text-dark-400">تکرار رمز جدید<input dir="rtl" type="password" autoComplete="new-password" value={repeatPassword} onChange={event=>setRepeatPassword(event.target.value)} className="input mt-1.5 w-full text-right" placeholder="تکرار رمز"/></label></div><button disabled={updateCredentials.isPending||credentialUsername.trim().length<4||(!credentials?.enabled&&newPassword.length<10)||(credentials?.enabled&&!currentPassword)} onClick={()=>void saveCredentials()} className="btn-primary min-h-11 w-full disabled:opacity-50">{updateCredentials.isPending?'در حال ذخیره…':'ذخیره اطلاعات ورود'}</button>{credentialMessage&&<p className={`rounded-xl px-3 py-2 text-sm ${credentialMessage.kind==='ok'?'bg-emerald-500/10 text-emerald-300':'bg-red-500/10 text-red-300'}`}>{credentialMessage.text}</p>}</div></Card><Card id="security-vault" icon={<LockKeyhole/>} title="گاوصندوق فایل‌ها" subtitle="فایل‌ها و کشوهای مخفی بدون رمز در فهرست و API نمایش داده نمی‌شوند."><div className="mt-4 space-y-3"><input dir="rtl" type="password" value={vaultPassword} onChange={event=>setVaultPasswordValue(event.target.value)} className="input w-full text-right" placeholder={vaultStatus?.configured?'رمز گاوصندوق':'یک رمز حداقل ۶ نویسه‌ای'}/><div className="grid grid-cols-2 gap-2"><button disabled={vaultPassword.length<6||unlockVault.isPending} className="btn-secondary min-h-11 disabled:opacity-40" onClick={async()=>{try{await unlockVault.mutateAsync(vaultPassword);setVaultMessage({kind:'ok',text:'گاوصندوق برای این نشست باز شد.'});setVaultPasswordValue('');window.dispatchEvent(new Event('komod-vault-changed'));}catch(error:any){setVaultMessage({kind:'error',text:error?.response?.data?.detail||'رمز درست نیست.'});}}}>باز کردن</button><button disabled={vaultPassword.length<6||setVaultPassword.isPending} className="btn-primary min-h-11 disabled:opacity-40" onClick={async()=>{try{await setVaultPassword.mutateAsync(vaultPassword);setVaultMessage({kind:'ok',text:vaultStatus?.configured?'رمز گاوصندوق عوض شد.':'گاوصندوق فعال شد.'});setVaultPasswordValue('');window.dispatchEvent(new Event('komod-vault-changed'));}catch(error:any){setVaultMessage({kind:'error',text:error?.response?.data?.detail||'ذخیره رمز انجام نشد.'});}}}>{vaultStatus?.configured?'تغییر رمز':'ساخت گاوصندوق'}</button></div>{vaultMessage&&<p className={`rounded-xl px-3 py-2 text-sm ${vaultMessage.kind==='ok'?'bg-emerald-500/10 text-emerald-300':'bg-red-500/10 text-red-300'}`}>{vaultMessage.text}</p>}</div></Card><Card id="security-vault" icon={<Shield/>} title="محافظت از حساب"><ul className="mt-3 list-disc space-y-2 pr-5 text-sm leading-7 text-dark-400"><li>پس از پنج تلاش ناموفق، ورود ۱۵ دقیقه قفل می‌شود.</li><li>ورودهای هر دستگاه در بخش نشست‌ها قابل مشاهده و لغو هستند.</li><li>اگر رمز را فراموش کردی، ورود با تلگرام همچنان مسیر بازیابی امن است.</li></ul></Card></div>}

        {view === 'sessions' && <div className="space-y-4"><Card icon={<MonitorSmartphone/>} title="نشست‌های فعال" subtitle="دستگاه‌هایی که با حساب فعلی وارد کمد شده‌اند."><div className="mt-4 space-y-2">{sessions.length ? sessions.map(session => <div key={session.id} className="flex items-center gap-3 rounded-xl bg-dark-800/50 p-3"><MonitorSmartphone className="h-5 w-5 text-dark-400"/><div className="min-w-0 flex-1"><strong className="block text-sm">{session.device_name} {session.current && <span className="text-primary-300">· همین دستگاه</span>}</strong><small className="text-dark-500">آخرین فعالیت: {formatPersianDate(session.last_seen_at)}</small></div>{!session.current&&<button className="btn-icon text-red-300" title="خروج این دستگاه" onClick={() => void revokeSession.mutateAsync(session.id)}><LogOut className="h-4 w-4"/></button>}</div>) : <p className="text-sm text-dark-500">نشست فعالی ثبت نشده است.</p>}</div><div className="mt-4 grid gap-2 sm:grid-cols-3"><button className="btn-secondary flex min-h-11 items-center justify-center gap-2 text-red-300" onClick={() => setConfirmation('device')}><LogOut className="h-4 w-4"/> خروج از این دستگاه</button><button className="btn-secondary flex min-h-11 items-center justify-center gap-2 text-orange-300" onClick={() => setConfirmation('others')}><MonitorSmartphone className="h-4 w-4"/> خروج بقیه نشست‌ها</button><button className="btn-secondary flex min-h-11 items-center justify-center gap-2 text-orange-300" onClick={() => setConfirmation('all')}><Users className="h-4 w-4"/> خروج از همه</button></div></Card><Card icon={<Activity/>} title="رویدادهای امنیتی" subtitle="ورودها، تغییرات حساب و استفاده از پیوندهای عمومی."><div className="mt-4 space-y-2">{securityEvents.length?securityEvents.map(event=><div key={event.id} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${event.suspicious?'bg-red-500/[.08]':'bg-dark-800/45'}`}><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${event.success?'bg-emerald-400':'bg-red-400'}`}/><div className="min-w-0 flex-1"><strong className="block truncate text-xs">{securityEventLabel(event.event_type)}</strong><small className="text-[10px] text-dark-500">{formatPersianDate(event.created_at)}{event.ip_address?` · ${event.ip_address}`:''}</small></div>{event.suspicious&&<span className="rounded-lg bg-red-500/10 px-2 py-1 text-[9px] text-red-300">مشکوک</span>}</div>):<p className="text-sm text-dark-500">هنوز رویدادی ثبت نشده است.</p>}</div></Card></div>}

        {view === 'storage' && storage && <StorageOverview storage={storage}/>}

        {view === 'storage' && <div className="space-y-4"><Card id="storage-channel" icon={<Database/>} title="کانال خصوصی من" subtitle="فایل‌های تازه حساب تو می‌توانند در کانال مجزای خودت ذخیره شوند."><div className={`mt-4 rounded-2xl border p-4 ${storageChannel?.configured?'border-emerald-400/20 bg-emerald-500/[.06]':'border-white/[.07] bg-dark-800/45'}`}><div className="flex items-center gap-3"><span className={`flex h-10 w-10 items-center justify-center rounded-xl ${storageChannel?.configured?'bg-emerald-500/15 text-emerald-300':'bg-white/[.05] text-dark-400'}`}>{storageChannel?.configured?<Check className="h-5 w-5"/>:<Database className="h-5 w-5"/>}</span><div className="min-w-0 flex-1"><strong className="block text-sm">{storageChannel?.configured?storageChannel.title||'کانال متصل':'کانال اختصاصی تنظیم نشده'}</strong><small className="text-dark-500">{storageChannel?.configured?'فایل‌های قبلی در محل قبلی خودشان باقی می‌مانند.':'فعلاً فضای پیش‌فرض کمد استفاده می‌شود.'}</small></div>{storageChannel?.configured&&<button className="btn-secondary px-3 py-2 text-xs text-red-300" onClick={async()=>{await resetStorageChannel.mutateAsync();setStorageChannelMessage({kind:'ok',text:'کانال اختصاصی برای فایل‌های تازه غیرفعال شد.'});}}>قطع اتصال</button>}</div></div><ol className="mt-4 list-decimal space-y-2 pr-5 text-sm leading-7 text-dark-300"><li>یک کانال خصوصی در تلگرام بساز.</li><li>ربات کمد را با اجازه ارسال و حذف پیام، مدیر کانال کن.</li><li>آیدی عددی کانال را که با <span dir="ltr" className="font-player text-primary-200">-100</span> شروع می‌شود وارد کن.</li></ol><div className="mt-4 flex flex-col gap-2 sm:flex-row"><input dir="ltr" value={storageChannelInput} onChange={event=>setStorageChannelInput(event.target.value)} className="input min-h-11 flex-1 text-left" placeholder="-1001234567890"/><button disabled={setStorageChannel.isPending||!storageChannelInput.trim()} onClick={()=>void saveStorageChannel()} className="btn-primary min-h-11 px-5 disabled:opacity-50">بررسی و اتصال</button></div>{storageChannelMessage&&<p className={`mt-3 rounded-xl px-3 py-2 text-sm ${storageChannelMessage.kind==='ok'?'bg-emerald-500/10 text-emerald-300':'bg-red-500/10 text-red-300'}`}>{storageChannelMessage.text}</p>}</Card></div>}

        {view === 'storage' && <Card id="storage-delete" icon={<Trash2/>} title="حذف فایل‌ها" subtitle="مشخص کن حذف از کمد با نسخه اصلی فایل چه رفتاری داشته باشد."><div className="mt-4 grid grid-cols-2 overflow-hidden rounded-xl border border-white/[.08] bg-dark-950/50 p-1"><button disabled={updateAccountPreferences.isPending} onClick={()=>void updateAccountPreferences.mutateAsync({delete_storage_files:false})} className={`min-h-11 rounded-lg px-2 text-xs transition sm:text-sm ${accountPreferences?.delete_storage_files===false?'bg-primary-500 text-white':'text-dark-400'}`}>فقط پنهان از کمد</button><button disabled={updateAccountPreferences.isPending} onClick={()=>void updateAccountPreferences.mutateAsync({delete_storage_files:true})} className={`min-h-11 rounded-lg px-2 text-xs transition sm:text-sm ${accountPreferences?.delete_storage_files!==false?'bg-red-500/80 text-white':'text-dark-400'}`}>حذف کامل فایل</button></div><p className="mt-3 text-xs leading-6 text-dark-500">در حالت «فقط پنهان»، رکورد فایل از کمد برداشته می‌شود اما نسخه اصلی آن دست‌نخورده می‌ماند.</p></Card>}

        {view === 'access' && <div className="space-y-4">
            <Card id="access-workspaces" icon={<Warehouse/>} title="کمدهای در دسترس" subtitle="کمد خودت و فضاهایی که دیگران با تو به اشتراک گذاشته‌اند."><div className="mt-4 grid gap-2 sm:grid-cols-2">{workspaces.map(space => <button key={space.user_id} onClick={() => switchWorkspace(space.user_id)} className={`flex items-center gap-3 rounded-xl border p-3 text-right ${activeWorkspace === space.user_id ? 'border-primary-400/35 bg-primary-500/10' : 'border-white/[.07] bg-dark-800/50'}`}><Warehouse className="h-5 w-5 text-primary-300"/><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{space.name}</strong><small className="text-dark-500">{permissionLabel(space.permission)}</small></span>{activeWorkspace === space.user_id && <span className="text-primary-300">✓</span>}</button>)}</div></Card>
            <Card id="access-sharing" icon={<Shield/>} title={editingGrantId?'ویرایش محدودهٔ دسترسی':'محدودهٔ دسترسی تازه'} subtitle="کشوها و فایل‌هایی را که این فرد می‌تواند ببیند مشخص کن."><div className="mt-4 grid grid-cols-2 overflow-hidden rounded-xl border border-white/[.08] bg-dark-950/50 p-1"><button onClick={()=>setLimitedShare(false)} className={`min-h-10 rounded-lg text-sm ${!limitedShare?'bg-primary-500 text-white':'text-dark-400'}`}>کل کمد</button><button onClick={()=>setLimitedShare(true)} className={`min-h-10 rounded-lg text-sm ${limitedShare?'bg-primary-500 text-white':'text-dark-400'}`}>فایل و کشوی مشخص</button></div>{limitedShare&&<div className="mt-4 space-y-4"><div><div className="mb-2 flex items-center justify-between gap-2"><p className="text-xs text-dark-400">کشوهای مجاز</p><button className="text-xs text-primary-200" onClick={()=>setShareFolderIds(shareFolderIds.length===shareFolders.length?[]:shareFolders.map(folder=>folder.id))}>{shareFolderIds.length===shareFolders.length?'لغو انتخاب همه':'انتخاب همه'}</button></div><div className="max-h-44 space-y-1 overflow-y-auto rounded-xl border border-white/[.07] p-2">{shareFolders.map(folder=><label key={folder.id} className="flex min-h-10 items-center gap-2 rounded-lg px-2 hover:bg-white/[.04]" style={{paddingRight:`${.5+folder.depth*1.1}rem`}}><input type="checkbox" checked={shareFolderIds.includes(folder.id)} onChange={()=>setShareFolderIds(ids=>ids.includes(folder.id)?ids.filter(id=>id!==folder.id):[...ids,folder.id])} className="h-4 w-4 accent-primary-500"/><span className="truncate text-sm">🗂️ {folder.name}</span></label>)}</div></div><div><input value={shareFileSearch} onChange={event=>setShareFileSearch(event.target.value)} className="input w-full" placeholder="جست‌وجوی فایل برای اشتراک…"/>{shareFileSearch.trim()&&<div className="mt-2 max-h-44 space-y-1 overflow-y-auto rounded-xl border border-white/[.07] p-2"><button disabled={selectingAllShareFiles} className="mb-1 w-full rounded-lg px-2 py-2 text-xs text-primary-200 hover:bg-primary-500/10 disabled:opacity-50" onClick={()=>void addAllMatchingShareFiles()}>{selectingAllShareFiles?'در حال افزودن…':'افزودن همهٔ نتایج'}</button>{(shareFileResults?.files||[]).map(file=><label key={file.id} className="flex min-h-10 items-center gap-2 rounded-lg px-2 hover:bg-white/[.04]"><input type="checkbox" checked={shareFileIds.includes(file.id)} onChange={()=>setShareFileIds(ids=>ids.includes(file.id)?ids.filter(id=>id!==file.id):[...ids,file.id])} className="h-4 w-4 accent-primary-500"/><span className="truncate text-sm">📄 {file.file_name}</span></label>)}</div>}</div><p className="text-xs text-primary-200">{(shareFolderIds.length+shareFileIds.length).toLocaleString('fa-IR')} مورد انتخاب شده</p></div>}</Card>
            <Card id="access-sharing" icon={<Shield/>} title={editingGrantId?'ویرایش دسترسی':'اشتراک‌گذاری کمد من'} subtitle="کاربر موردنظر باید قبلاً یک بار وارد کمد شده باشد."><div className="mt-4 grid gap-3 sm:grid-cols-[1fr_12rem_auto]"><input dir="ltr" value={shareTelegramId} readOnly={editingGrantId!==null} onChange={event => setShareTelegramId(event.target.value)} placeholder="یوزرنیم یا آیدی عددی" className="min-h-11 rounded-xl border border-white/10 bg-dark-800 px-3 py-2.5 text-right outline-none focus:border-primary-400 read-only:opacity-60"/><PermissionSelect value={sharePermission} onChange={setSharePermission}/><button disabled={grantWorkspace.isPending} onClick={() => void submitGrant()} className="btn-primary min-h-11">{editingGrantId?'ذخیره تغییرات':'دادن دسترسی'}</button></div>{editingGrantId&&<button className="mt-2 text-xs text-dark-400 hover:text-white" onClick={()=>{setEditingGrantId(null);setShareTelegramId('');setShareFolderIds([]);setShareFileIds([]);setLimitedShare(false)}}>لغو ویرایش</button>}{accessMessage && <p className={`mt-3 rounded-xl px-3 py-2 text-sm ${accessMessage.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>{accessMessage.text}</p>}{grants.length > 0 && <div className="mt-4 space-y-2">{grants.map(grant => <div key={grant.user_id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-white/[.06] bg-dark-800/50 p-2.5 [&>div:not(:first-child)]:min-w-40 [&>div:not(:first-child)]:flex-1"><div className="min-w-0 w-full sm:w-auto sm:flex-1"><strong className="block truncate text-sm">{grant.name}</strong><small className="text-dark-500" dir="ltr">{grant.username ? `@${grant.username}` : grant.telegram_id}</small><p className="mt-1 text-[10px] text-dark-500">{grant.folder_ids.length||grant.file_ids.length?`${grant.folder_ids.length.toLocaleString('fa-IR')} کشو · ${grant.file_ids.length.toLocaleString('fa-IR')} فایل`:'دسترسی به کل کمد'}</p></div><PermissionSelect value={grant.permission === 'write' ? 'write' : 'read'} onChange={permission => void saveGrant(grant.telegram_id, permission)}/><button title="دیدن و ویرایش جزئیات" className="btn-icon text-primary-200" onClick={()=>editGrantScope(grant)}><Pencil className="h-4 w-4"/></button><button title="لغو دسترسی" className="btn-icon text-red-300" onClick={() => void revokeWorkspace.mutateAsync(grant.user_id)}><Trash2 className="h-4 w-4"/></button></div>)}</div>}</Card>
        </div>}

        {view === 'tts' && <TTSSettingsPanel/>}

        {view === 'appearance' && <Card id="appearance-mode" icon={<Sun/>} title="حالت نمایش"><div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-white/[.08] bg-dark-950/50 p-1.5"><button onClick={()=>chooseAppearanceMode('dark')} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm transition ${appearanceMode==='dark'?'bg-primary-500 text-white shadow-lg':'text-dark-400 hover:bg-white/[.05]'}`}><Moon className="h-4 w-4"/> حالت تاریک</button><button onClick={()=>chooseAppearanceMode('light')} className={`flex min-h-12 items-center justify-center gap-2 rounded-xl text-sm transition ${appearanceMode==='light'?'bg-primary-500 text-white shadow-lg':'text-dark-400 hover:bg-white/[.05]'}`}><Sun className="h-4 w-4"/> حالت روشن</button></div></Card>}

        {view === 'appearance' && <div className="space-y-4"><Card id="appearance-color" icon={<Palette/>} title="رنگ کمد" subtitle="یکی از رنگ‌های آماده را انتخاب کن یا رنگ خودت را با نام دلخواه بساز."><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{(Object.entries(colorThemes) as [ColorTheme, typeof colorThemes[ColorTheme]][]).map(([key,item]) => <button key={key} onClick={() => chooseTheme(key)} className={`flex min-h-12 items-center justify-between gap-2 rounded-2xl border px-3 transition ${theme===key?'border-primary-300/50 bg-primary-500/15 text-white shadow-lg shadow-primary-950/20':'border-white/[.07] bg-dark-800/60 text-dark-200 hover:border-white/15'}`}><span className="flex items-center gap-2"><span className="h-6 w-6 rounded-xl ring-2 ring-white/10" style={{backgroundColor:item.dot}}/>{item.label}</span>{theme===key&&<Check className="h-4 w-4 text-primary-200"/>}</button>)}</div></Card></div>}



        {view === 'files' && <div className="space-y-4"><Card id="files-root" icon={<Warehouse/>} title="فایل‌های بدون کشوی قبلی"><p className="mt-2 text-sm text-dark-400">مشخص کن محتوای کشوی پیش‌فرض در صفحه اصلی دیده شود یا داخل «فایل‌های من» بماند.</p><CustomSelect className="mt-3" value={localStorage.getItem('komod-root-files-mode') || 'folder'} onChange={value => { localStorage.setItem('komod-root-files-mode', value); window.dispatchEvent(new Event('komod-root-mode-changed')); }} options={[{value:'folder',label:'🗃️ نمایش داخل کشوی «فایل‌های من»'},{value:'files',label:'📦 نمایش مستقیم در صفحه اصلی'}]}/></Card></div>}

        {view === 'files' && <Card id="files-incoming" icon={<FolderPlus/>} title="محل فایل‌های تازه" subtitle="مقصد پیش‌فرض فایل‌ها و لینک‌هایی که از صفحهٔ اصلی اضافه می‌کنی."><CustomSelect className="mt-3" value={localStorage.getItem('komod-incoming-folder') || 'default'} onChange={value => { localStorage.setItem('komod-incoming-folder', String(value)); window.dispatchEvent(new Event('komod-incoming-folder-changed')); }} options={incomingFolderOptions}/></Card>}

        {view === 'files' && <Card id="files-links" icon={<Download/>} title="مقصد لینک‌ها" subtitle="برای یوتیوب و اینستاگرام کشوی پیش‌فرض جداگانه تعیین کن."><div className="mt-4 grid gap-3 sm:grid-cols-2"><CustomSelect label="لینک‌های یوتیوب" value={youtubeFolder} onChange={value=>{setYoutubeFolder(String(value));localStorage.setItem('komod-youtube-folder',String(value));}} options={[{value:'none',label:'هر بار انتخاب می‌کنم'},...incomingFolderOptions]}/><CustomSelect label="لینک‌های اینستاگرام" value={instagramFolder} onChange={value=>{setInstagramFolder(String(value));localStorage.setItem('komod-instagram-folder',String(value));}} options={[{value:'none',label:'هر بار انتخاب می‌کنم'},...incomingFolderOptions]}/></div></Card>}

        {view === 'connection' && user?.is_admin && <div className="space-y-4">
            <Card icon={<MonitorSmartphone/>} title="حالت اتصال" subtitle="در حالت آفلاین فقط محتوای ذخیره‌شده روی همین دستگاه نمایش داده می‌شود."><div className="mt-4 grid grid-cols-2 overflow-hidden rounded-xl border border-white/[.08] bg-dark-950/50 p-1"><button onClick={()=>changeConnectionMode(false)} className={`min-h-10 rounded-lg text-sm transition ${!forceOffline?'bg-primary-500 text-white':'text-dark-400'}`}>آنلاین</button><button onClick={()=>changeConnectionMode(true)} className={`min-h-10 rounded-lg text-sm transition ${forceOffline?'bg-primary-500 text-white':'text-dark-400'}`}>آفلاین</button></div></Card>
            <Card icon={<Globe2/>} title="مسیر اتصال" subtitle="اگر آدرس اصلی در شبکه‌ات باز نمی‌شود، آدرس HTTPS یک دامنه جایگزین یا reverse proxy را اینجا ذخیره کن.">
                <div className="mt-4 grid gap-2 sm:grid-cols-[10rem_1fr_auto]"><input value={serverName} onChange={event=>setServerName(event.target.value)} className="input" placeholder="نام مسیر"/><input dir="ltr" value={serverUrl} onChange={event=>setServerUrl(event.target.value)} className="input text-left" placeholder="https://komod.example.com"/><button onClick={saveServerAddress} className="btn-primary min-h-11 px-4">ذخیره</button></div>
                {pingResult&&!pingResult.ok&&<p className="mt-2 text-xs text-red-300">آدرس معتبر یا قابل دسترس نیست. آدرس کامل HTTPS را وارد کن.</p>}
                <p className="mt-3 rounded-xl bg-amber-500/[.08] px-3 py-2 text-xs leading-6 text-amber-100">پروکسی SOCKS یا MTProto داخل مرورگر قابل استفاده نیست. این بخش برای یک آدرس HTTPS جایگزین است که به همین سرور کمد وصل می‌شود.</p>
            </Card>
            <Card icon={<Gauge/>} title="آدرس‌های ذخیره‌شده" subtitle={`اتصال فعلی: ${getServerOrigin()}`}>
                <div className="mt-4 space-y-2"><div className="flex items-center gap-2 rounded-xl border border-white/[.07] bg-dark-800/50 p-3"><div className="min-w-0 flex-1"><strong className="block text-sm">آدرس همین برنامه</strong><small dir="ltr" className="block truncate text-dark-500">{window.location.origin}</small></div><button className="btn-secondary px-3 py-2 text-xs" onClick={useDefaultServer}>انتخاب</button></div>{serverAddresses.map(item=><div key={item.url} className="flex items-center gap-2 rounded-xl border border-white/[.07] bg-dark-800/50 p-3"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${getServerOrigin()===item.url?'bg-emerald-400':'bg-dark-600'}`}/><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{item.name}</strong><small dir="ltr" className="block truncate text-dark-500">{item.url}</small></div>{pingResult?.url===item.url&&<span className={`text-[10px] ${pingResult.ok?'text-emerald-300':'text-red-300'}`}>{pingResult.ok?`${pingResult.ms} ms`:'قطع'}</span>}<button className="btn-icon" title="سنجش اتصال" onClick={()=>void pingServer(item.url)}><Gauge className="h-4 w-4"/></button><button className="btn-secondary px-3 py-2 text-xs" onClick={()=>selectServerAddress(item.url)}>انتخاب</button><button className="btn-icon text-red-300" title="حذف" onClick={()=>{const next=serverAddresses.filter(address=>address.url!==item.url);setServerAddresses(next);localStorage.setItem('komod-server-addresses',JSON.stringify(next));}}><Trash2 className="h-4 w-4"/></button></div>)}</div>
            </Card>
        </div>}

        {view === 'admin' && user?.is_admin && <div className="space-y-4">
            {selectedSubsection==='admin-add'&&<Card id="admin-add" icon={<Plus/>} title="افزودن کاربر مجاز" subtitle="حذف دسترسی، فایل‌ها و اطلاعات قبلی کاربر را پاک نمی‌کند."><div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input dir="rtl" inputMode="numeric" value={newAdminTelegramId} onChange={event=>setNewAdminTelegramId(event.target.value.replace(/\D/g,''))} className="input text-right" placeholder="آیدی عددی تلگرام"/><input value={newAdminName} onChange={event=>setNewAdminName(event.target.value)} className="input" placeholder="نام دلخواه (اختیاری)"/><button disabled={addAdminUser.isPending||!newAdminTelegramId} onClick={()=>void addAuthorizedUser()} className="btn-primary min-h-11 px-5 disabled:opacity-40">افزودن</button></div></Card>}
            {adminUsersError && <div className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/[.07] p-4"><p className="min-w-0 flex-1 text-sm text-red-200">فهرست کاربران بارگذاری نشد. اتصال را بررسی کن و دوباره تلاش کن.</p><button className="btn-secondary shrink-0 px-3 py-2 text-xs" onClick={()=>void Promise.all([refetchAdminUsers(),refetchAdminStats()])}>تلاش دوباره</button></div>}
            {selectedSubsection==='admin-summary'&&<section id="admin-summary" className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-300"><Gauge className="h-5 w-5"/></span><div><h2 className="font-bold">گزارش کلی</h2><p className="mt-1 text-xs text-dark-400">نمای سریع کاربران، فایل‌ها و مصرف ابزارهای هوش مصنوعی</p></div></div><div className="mt-4 grid gap-3 md:grid-cols-2"><div className="rounded-2xl bg-gradient-to-br from-primary-500/15 to-dark-800/60 p-4"><p className="text-xs text-dark-400">فضای کاربران</p><strong className="mt-2 block text-2xl text-primary-100">{adminStatsLoading?'…':formatFileSize(adminStats?.total_size||0)}</strong><div className="mt-4 grid grid-cols-2 gap-2"><AdminStat label="کاربر فعال" value={adminStatsLoading?'…':(adminStats?.active_users||0).toLocaleString('fa-IR')} icon={<Users/>}/><AdminStat label="کل فایل‌ها" value={adminStatsLoading?'…':(adminStats?.total_files||0).toLocaleString('fa-IR')} icon={<FileStack/>}/></div></div><div className="rounded-2xl border border-white/[.06] bg-dark-800/45 p-4"><p className="text-xs text-dark-400">مصرف متن و صدا</p><div className="mt-3 grid grid-cols-2 gap-2"><AdminStat label="TTS امروز" value={adminStatsLoading?'…':(adminStats?.tts_jobs_today||0).toLocaleString('fa-IR')} icon={<AudioLines/>}/><AdminStat label="STT امروز" value={adminStatsLoading?'…':(adminStats?.stt_jobs_today||0).toLocaleString('fa-IR')} icon={<FileText/>}/><AdminStat label="کل TTS" value={adminStatsLoading?'…':(adminStats?.tts_total_jobs||0).toLocaleString('fa-IR')} icon={<Gauge/>}/><AdminStat label="کل STT" value={adminStatsLoading?'…':(adminStats?.stt_total_jobs||0).toLocaleString('fa-IR')} icon={<FileStack/>}/></div></div></div></section>}
            {selectedSubsection==='admin-health'&&<section id="admin-health" className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5">
                <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-300"><Activity className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="font-bold">سلامت سرویس‌ها</h2><p className="mt-1 text-xs text-dark-400">وضعیت زندهٔ بخش‌های اصلی و صف‌های پردازش</p></div><button className="btn-icon" disabled={adminHealthFetching} onClick={()=>void refetchAdminHealth()} aria-label="تازه‌سازی وضعیت"><RefreshCw className={`h-4 w-4 ${adminHealthFetching?'animate-spin':''}`}/></button></div>
                {adminHealthError&&<div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[.07] p-3 text-sm text-red-200">گرفتن وضعیت سرویس‌ها انجام نشد.</div>}
                {adminHealthLoading?<div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="h-28 animate-pulse rounded-2xl bg-dark-800/60"/><div className="h-28 animate-pulse rounded-2xl bg-dark-800/60"/></div>:adminHealth&&<>
                    <div className={`mt-4 flex items-center gap-3 rounded-2xl border p-4 ${adminHealth.overall==='healthy'?'border-emerald-500/20 bg-emerald-500/[.07]':adminHealth.overall==='warning'?'border-amber-500/20 bg-amber-500/[.07]':'border-red-500/20 bg-red-500/[.07]'}`}>{adminHealth.overall==='healthy'?<CheckCircle2 className="h-5 w-5 text-emerald-300"/>:adminHealth.overall==='warning'?<AlertTriangle className="h-5 w-5 text-amber-300"/>:<XCircle className="h-5 w-5 text-red-300"/>}<div><strong className="text-sm">{adminHealth.overall==='healthy'?'همه‌چیز روبه‌راه است':adminHealth.overall==='warning'?'یک بخش نیاز به بررسی دارد':'یک سرویس در دسترس نیست'}</strong><p className="mt-1 text-xs text-dark-400">بررسی‌شده در {new Date(adminHealth.checked_at).toLocaleTimeString('fa-IR',{hour:'2-digit',minute:'2-digit'})}</p></div></div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">{adminHealth.services.map(service=><ServiceHealthCard key={service.key} service={service}/>)}</div>
                    <div className="mt-4 rounded-2xl border border-white/[.06] bg-dark-800/40 p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-bold">کارهای گیرکرده</h3><p className="mt-1 text-xs text-dark-500">پردازش‌های بدون تغییر در ۱۵ دقیقه گذشته</p></div><span className="rounded-full bg-dark-700 px-2.5 py-1 text-xs">{adminHealth.stuck_jobs.length.toLocaleString('fa-IR')}</span></div>{adminHealth.stuck_jobs.length?<div className="mt-3 space-y-2">{adminHealth.stuck_jobs.map(job=><div key={job.id} className="flex items-center gap-3 rounded-xl bg-dark-950/45 p-3"><AlertTriangle className="h-4 w-4 shrink-0 text-amber-300"/><div className="min-w-0 flex-1"><strong className="block truncate text-xs">{job.title||'پردازش بدون عنوان'}</strong><small className="text-dark-500">{job.kind.toUpperCase()} · {job.state} · {job.progress.toLocaleString('fa-IR')}٪</small></div></div>)}</div>:<p className="mt-3 text-sm text-emerald-300">پردازش گیرکرده‌ای پیدا نشد.</p>}</div>
                    <div className="mt-4 rounded-2xl border border-white/[.06] bg-dark-800/40 p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-bold">خطاهای قابل پیگیری</h3><p className="mt-1 text-xs text-dark-500">شناسه را برای پیدا کردن همان خطا در لاگ‌ها نگه دار.</p></div><span className="rounded-full bg-dark-700 px-2.5 py-1 text-xs">{adminErrors.filter(item=>!item.resolved).length.toLocaleString('fa-IR')}</span></div>{adminErrors.length?<div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{adminErrors.map(item=><div key={item.error_id} className={`flex items-center gap-3 rounded-xl p-3 ${item.resolved?'bg-dark-950/25 opacity-60':'bg-red-500/[.06]'}`}><code dir="ltr" className="shrink-0 rounded-lg bg-black/20 px-2 py-1 text-[10px] text-red-200">{item.error_id}</code><div className="min-w-0 flex-1"><strong dir="ltr" className="block truncate text-xs">{item.method} {item.path}</strong><small className="block truncate text-dark-500">{item.message}</small></div>{!item.resolved&&<button className="btn-icon h-8 w-8" title="بررسی شد" onClick={()=>resolveAdminError.mutate(item.error_id)}><Check className="h-4 w-4"/></button>}</div>)}</div>:<p className="mt-3 text-sm text-emerald-300">خطای ثبت‌شده‌ای وجود ندارد.</p>}</div>
                </>}
            </section>}
            {selectedSubsection==='admin-users'&&<Card id="admin-users" icon={<UserRoundCog/>} title="کاربران کمد">
                <label className="relative mt-4 block min-w-0"><Search className="pointer-events-none absolute right-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-dark-500"/><input value={adminQuery} onChange={event => setAdminQuery(event.target.value)} className="input w-full !pr-10" placeholder="جست‌وجو"/></label>
                <div className="admin-users-grid mt-4 grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">{filteredAdminUsers.map(item => <AdminRow key={item.id} item={item} onSave={(display_name) => updateAdmin.mutateAsync({id:item.id,display_name})} onQuota={(tts_daily_limit,tts_max_chars,stt_daily_limit,stt_max_seconds)=>updateAdmin.mutateAsync({id:item.id,tts_daily_limit,tts_max_chars,stt_daily_limit,stt_max_seconds})} onToggle={() => item.is_active ? removeAdminUser.mutateAsync(item.id) : updateAdmin.mutateAsync({id:item.id,is_active:true})}/>)}</div>
                {adminUsersLoading && <div className="mt-4 grid gap-3 xl:grid-cols-2">{[0,1,2,3].map(item=><div key={item} className="h-48 animate-pulse rounded-2xl bg-dark-800/60"/>)}</div>}
                {!adminUsersLoading && !adminUsersError && !filteredAdminUsers.length && <p className="py-10 text-center text-sm text-dark-500">کاربری با این مشخصات پیدا نشد.</p>}
            </Card>}
        </div>}

        {confirmation && <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setConfirmation(null)}><div className="w-full max-w-sm rounded-2xl border border-white/10 bg-dark-900 p-5" onClick={event=>event.stopPropagation()}><h2 className="text-lg font-bold">{confirmation==='all'?'خروج از همه دستگاه‌ها؟':'از این دستگاه خارج می‌شی؟'}</h2><p className="mt-2 text-sm text-dark-300">فایل‌ها و اطلاعات کمد حذف نمی‌شوند.</p><div className="mt-5 flex gap-2"><button className="flex-1 rounded-xl bg-red-500 px-4 py-2.5" onClick={() => confirmation==='all'?void logoutEverywhere():void logoutThisDevice()}>خروج</button><button className="btn-secondary flex-1" onClick={()=>setConfirmation(null)}>بی‌خیال</button></div></div></div>}
    </div></SettingsSectionContext.Provider>;
}

function viewTitle(view: SettingsView) { return ({ home:'تنظیمات', accounts:'حساب‌ها', security:'ورود و امنیت', sessions:'مدیریت نشست‌ها', access:'دسترسی و اشتراک‌گذاری', storage:'فضای ذخیره‌سازی', files:'فایل‌ها و مقصدها', appearance:'ظاهر برنامه', connection:'اتصال برنامه', admin:'مدیریت کاربران', tags:'مدیریت تگ‌ها', transfers:'مرکز انتقال‌ها', tts:'متن و صدا' })[view]; }
function viewSubtitle(view: SettingsView) { return ({ home:'بخش موردنظرت را انتخاب کن.', accounts:'حساب‌های ذخیره‌شده روی این دستگاه.', security:'رمز و روش ورودت را تنظیم کن.', sessions:'ورودهای فعال حساب فعلی را مدیریت کن.', access:'مشخص کن چه کسی کمدت را ببیند یا داخلش فایل ذخیره کند.', storage:'فضای فایل‌ها و شیوه حذف را مدیریت کن.', files:'مقصد فایل‌های تازه و لینک‌ها را انتخاب کن.', appearance:'رنگ و حالت نمایش کمد را تنظیم کن.', connection:'آدرس اصلی و مسیرهای جایگزین HTTPS را مدیریت کن.', admin:'کاربران کمد را مدیریت کن.', tags:'تگ‌های دلخواه و نمایش آن‌ها را تنظیم کن.', transfers:'همه انتقال‌های فعال و اخیر را یکجا مدیریت کن.', tts:'ساخت صدا و استخراج متن.' })[view]; }
function securityEventLabel(type: string) { return ({ login_success:'ورود موفق به حساب', login_failed:'تلاش ناموفق برای ورود', credentials_updated:'تغییر اطلاعات ورود', sessions_revoked_all:'خروج از همه نشست‌ها', sessions_revoked_others:'خروج از نشست‌های دیگر', session_revoked:'لغو یک نشست', public_link_created:'ساخت پیوند عمومی', public_link_revoked:'لغو پیوند عمومی', public_link_unlocked:'باز شدن پیوند رمزدار', public_link_password_failed:'رمز اشتباه برای پیوند عمومی', public_view:'مشاهده پیوند عمومی', account_backup_restored:'بازیابی نسخه پشتیبان حساب', workspace_grant_updated:'تغییر دسترسی اشتراک‌گذاری', workspace_grant_revoked:'لغو دسترسی اشتراک‌گذاری', vault_password_updated:'تغییر رمز گاوصندوق', vault_unlocked:'باز شدن گاوصندوق', vault_unlock_failed:'رمز اشتباه گاوصندوق' } as Record<string,string>)[type] || 'رویداد امنیتی'; }
function permissionLabel(permission: 'owner' | Permission) { return permission === 'owner' ? 'کمد خودم' : permission === 'write' ? 'مشاهده و ذخیره' : 'فقط مشاهده'; }
function PermissionSelect({ value, onChange }:{ value:Permission; onChange:(value:Permission)=>void }) { return <CustomSelect value={value} onChange={onChange} options={[{value:'read',label:'👁️ فقط مشاهده'},{value:'write',label:'📥 مشاهده و ذخیره'}]}/>; }
function SettingsButton({icon,title,text,onClick}:{icon:React.ReactElement;title:string;text:string;onClick:()=>void}) { return <button onClick={onClick} className="group flex min-h-24 items-center gap-3 rounded-2xl border border-white/[.07] bg-dark-900/70 p-4 text-right transition hover:border-primary-400/25 hover:bg-primary-500/[.06]"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-300 [&>svg]:h-5 [&>svg]:w-5">{icon}</span><span className="min-w-0 flex-1"><strong className="block text-sm">{title}</strong><small className="mt-1 block leading-5 text-dark-400">{text}</small></span><ArrowRight className="h-4 w-4 rotate-180 text-dark-600 transition group-hover:text-primary-300"/></button>; }
function SummaryCard({icon,title,text}:{icon:React.ReactElement;title:string;text:string}) { return <div className="flex items-center gap-3 rounded-2xl border border-white/[.07] bg-dark-900/70 p-4"><span className="text-primary-300 [&>svg]:h-5 [&>svg]:w-5">{icon}</span><span><strong className="block text-sm">{title}</strong><small className="text-dark-500">{text}</small></span></div>; }
function Card({id,icon,title,subtitle,children}:{id?:string;icon:React.ReactElement;title:string;subtitle?:string;children:React.ReactNode}) { const active=useContext(SettingsSectionContext); if(id&&active&&id!==active)return null; return <section id={id} className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-5"><div className="flex items-center gap-3"><span className="text-primary-300 [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div><h2 className="font-bold">{title}</h2>{subtitle&&<p className="mt-1 text-xs text-dark-400">{subtitle}</p>}</div></div>{title==='رنگ کمد'&&<ThemeColorControl/>}{children}</section>; }

function settingsSectionLinks(view:SettingsView):Array<{id:string;label:string}>{
    const sections:Partial<Record<SettingsView,Array<{id:string;label:string}>>>={
        security:[{id:'security-login',label:'ورود'},{id:'security-vault',label:'گاوصندوق'}],
        access:[{id:'access-workspaces',label:'کمدهای در دسترس'},{id:'access-sharing',label:'اشتراک‌گذاری'}],
        files:[{id:'files-root',label:'نمایش فایل‌ها'},{id:'files-incoming',label:'فایل‌های تازه'},{id:'files-links',label:'مقصد لینک‌ها'}],
        storage:[{id:'storage-overview',label:'نمای کلی'},{id:'storage-channel',label:'فضای شخصی'},{id:'storage-delete',label:'حذف فایل'}],
        appearance:[{id:'appearance-color',label:'رنگ کمد'},{id:'appearance-mode',label:'روشن یا تاریک'}],
        tags:[{id:'tags-library',label:'تگ‌های من'},{id:'tags-display',label:'نمایش تگ‌ها'}],
        admin:[{id:'admin-add',label:'افزودن کاربر'},{id:'admin-users',label:'فهرست کاربران'},{id:'admin-summary',label:'گزارش کلی'},{id:'admin-health',label:'سلامت سرویس‌ها'}],
    };
    return sections[view]||[];
}
function ServiceHealthCard({service}:{service:{label:string;status:'healthy'|'warning'|'error'|'disabled';message:string;queued:number;active:number;latency_ms?:number|null}}){
    const palette=service.status==='healthy'?'bg-emerald-400':service.status==='warning'?'bg-amber-400':service.status==='error'?'bg-red-400':'bg-dark-600';
    return <div className="rounded-2xl border border-white/[.06] bg-dark-800/45 p-4"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${palette}`}/><strong className="text-sm">{service.label}</strong></div><p className="mt-2 min-h-10 text-xs leading-5 text-dark-400">{service.message}</p>{(service.queued>0||service.active>0)&&<div className="mt-2 flex gap-2 text-[11px]"><span className="rounded-lg bg-dark-950/55 px-2 py-1">فعال: {service.active.toLocaleString('fa-IR')}</span><span className="rounded-lg bg-dark-950/55 px-2 py-1">در صف: {service.queued.toLocaleString('fa-IR')}</span></div>}</div>;
}
function SectionJumpNav({items,active,onChange,mobileGrid=false}:{items:Array<{id:string;label:string}>;active:string|null;onChange:(id:string)=>void;mobileGrid?:boolean}){
    return <nav className={`mb-5 gap-1 rounded-2xl border border-white/[.08] bg-dark-950/75 p-1.5 shadow-lg ${mobileGrid?'grid grid-cols-2 sm:auto-cols-fr sm:grid-flow-col sm:grid-cols-none':'flex overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden'}`} aria-label="بخش‌های همین صفحه">{items.map(item=><button key={item.id} type="button" aria-current={active===item.id?'page':undefined} onClick={()=>onChange(item.id)} className={`min-h-10 rounded-xl px-3 text-xs font-semibold transition ${mobileGrid?'min-w-0 sm:flex-1':'min-w-max flex-1'} ${active===item.id?'bg-primary-500 text-white shadow-lg shadow-primary-950/25':'text-dark-400 hover:bg-white/[.05] hover:text-white'}`}>{item.label}</button>)}</nav>;
}
function ThemeColorControl(){
    const [value,setValue]=useState(()=>localStorage.getItem('komod-custom-color')||'#A855F7');
    const [name,setName]=useState('');
    const [open,setOpen]=useState(false);
    const [saved,setSaved]=useState<SavedColor[]>(()=>{try{return (JSON.parse(localStorage.getItem('komod-saved-colors')||'[]') as Array<string|SavedColor>).map((item,index)=>typeof item==='string'?{color:item,name:`رنگ ${index+1}`}:item)}catch{return[]}});
    const [hsl,setHsl]=useState(()=>hexToHsl(localStorage.getItem('komod-custom-color')||'#A855F7'));
    const normalized=()=>{const color=value.trim().startsWith('#')?value.trim():`#${value.trim()}`;return /^#[0-9a-f]{6}$/i.test(color)?color.toUpperCase():null};
    const applyColor=(color:string)=>{setValue(color);setHsl(hexToHsl(color));localStorage.setItem('komod-custom-color',color);localStorage.setItem('komod-color-theme','custom');applyCustomTheme(color)};
    const apply=()=>{const color=normalized();if(!color)return;applyColor(color)};
    const changeHsl=(part:0|1|2,next:number)=>{const updated:[number,number,number]=[...hsl] as [number,number,number];updated[part]=next;setHsl(updated);applyColor(hslToHex(...updated))};
    const save=()=>{const color=normalized();if(!color)return;apply();const next=[{color,name:name.trim()||`رنگ ${saved.length+1}`},...saved.filter(item=>item.color.toLowerCase()!==color.toLowerCase())].slice(0,12);setSaved(next);localStorage.setItem('komod-saved-colors',JSON.stringify(next));setName('')};
    const remove=(color:string)=>{const next=saved.filter(item=>item.color!==color);setSaved(next);localStorage.setItem('komod-saved-colors',JSON.stringify(next))};
    return <div className="mt-4 space-y-3">
        {saved.length>0&&<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{saved.map(item=><div key={`${item.color}-${item.name}`} className="flex min-w-0 items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.04] p-2"><button className="h-8 w-8 shrink-0 rounded-lg border border-white/15" style={{backgroundColor:item.color}} onClick={()=>applyColor(item.color)} aria-label={`انتخاب ${item.name}`}/><span className="min-w-0 flex-1 truncate text-xs">{item.name}</span><button className="btn-icon h-7 w-7 text-red-300" onClick={()=>remove(item.color)} aria-label="حذف رنگ"><Trash2 className="h-3.5 w-3.5"/></button></div>)}</div>}
        <button type="button" onClick={()=>setOpen(current=>!current)} className={`flex min-h-11 w-full items-center justify-between rounded-xl border px-3 text-sm transition ${open?'border-primary-400/30 bg-primary-500/10 text-primary-100':'border-white/[.08] bg-dark-800/60 text-dark-300'}`}><span className="flex items-center gap-2"><Palette className="h-4 w-4"/>رنگ سفارشی</span><ChevronLeft className={`h-4 w-4 transition ${open?'-rotate-90':''}`}/></button>
        {open&&<div className="rounded-2xl border border-primary-400/20 bg-primary-500/[.05] p-3"><div className="grid gap-3 md:grid-cols-[7rem_1fr]"><div className="flex min-h-28 items-center justify-center rounded-2xl border border-white/10 shadow-inner" style={{backgroundColor:/^#[0-9a-f]{6}$/i.test(value)?value:'#A855F7'}}><Palette className="h-8 w-8 text-white drop-shadow-lg"/></div><div className="space-y-2"><ColorRange label="فام" value={hsl[0]} max={360} onChange={next=>changeHsl(0,next)} gradient="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"/><ColorRange label="اشباع" value={hsl[1]} max={100} onChange={next=>changeHsl(1,next)} gradient={`linear-gradient(90deg,hsl(${hsl[0]} 0% ${hsl[2]}%),hsl(${hsl[0]} 100% ${hsl[2]}%))`}/><ColorRange label="روشنایی" value={hsl[2]} max={100} onChange={next=>changeHsl(2,next)} gradient={`linear-gradient(90deg,#000,hsl(${hsl[0]} ${hsl[1]}% 50%),#fff)`}/></div></div><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input dir="ltr" value={value} onChange={event=>setValue(event.target.value.toUpperCase())} onBlur={apply} onKeyDown={event=>{if(event.key==='Enter')apply()}} className="input min-w-0 text-left font-mono uppercase" maxLength={7} placeholder="کد هگز؛ مثل #A855F7" aria-label="کد هگز رنگ"/><input value={name} onChange={event=>setName(event.target.value)} className="input min-w-0" placeholder="نام رنگ؛ مثلاً بنفش شب"/><button onClick={save} className="btn-primary min-h-11 px-4">ذخیره رنگ</button></div></div>}
    </div>
}
function ColorRange({label,value,max,onChange,gradient}:{label:string;value:number;max:number;onChange:(value:number)=>void;gradient:string}){return <label className="grid grid-cols-[4rem_1fr_2.5rem] items-center gap-2 text-xs text-dark-300"><span>{label}</span><input dir="ltr" type="range" min="0" max={max} value={value} onChange={event=>onChange(Number(event.target.value))} className="h-2 w-full cursor-pointer appearance-none rounded-full accent-primary-500 [direction:ltr]" style={{background:gradient}}/><span dir="ltr" className="text-left font-mono text-[10px]">{Math.round(value)}</span></label>}
function hexToHsl(hex:string):[number,number,number]{const match=/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);if(!match)return[270,91,65];const r=parseInt(match[1],16)/255,g=parseInt(match[2],16)/255,b=parseInt(match[3],16)/255;const max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;let h=0;if(delta){if(max===r)h=60*(((g-b)/delta)%6);else if(max===g)h=60*((b-r)/delta+2);else h=60*((r-g)/delta+4)}if(h<0)h+=360;const l=(max+min)/2;const s=delta?delta/(1-Math.abs(2*l-1)):0;return[Math.round(h),Math.round(s*100),Math.round(l*100)]}
function hslToHex(h:number,s:number,l:number){s/=100;l/=100;const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;let r=0,g=0,b=0;if(h<60)[r,g,b]=[c,x,0];else if(h<120)[r,g,b]=[x,c,0];else if(h<180)[r,g,b]=[0,c,x];else if(h<240)[r,g,b]=[0,x,c];else if(h<300)[r,g,b]=[x,0,c];else[r,g,b]=[c,0,x];return'#'+[r,g,b].map(value=>Math.round((value+m)*255).toString(16).padStart(2,'0')).join('').toUpperCase()}
function StorageOverview({storage}:{storage:{total_size:number;total_files:number;by_type:Array<{type:string;count:number;size:number}>}}){
    const [open,setOpen]=useState(false);
    const labels:Record<string,{label:string;icon:string}>={audio:{label:'صدا',icon:'🎵'},video:{label:'ویدیو',icon:'🎬'},image:{label:'عکس',icon:'🖼️'},text:{label:'متن',icon:'📝'},document:{label:'فایل',icon:'📄'}};
    const rows=[...storage.by_type].sort((a,b)=>b.size-a.size);
    return <Card id="storage-overview" icon={<HardDrive/>} title="فضای کمد" subtitle={`${storage.total_files.toLocaleString('fa-IR')} فایل`}><button type="button" onClick={()=>setOpen(value=>!value)} className="mt-4 flex w-full items-center gap-3 rounded-2xl bg-gradient-to-l from-primary-500/15 to-white/[.025] p-3 text-right"><span className="min-w-0 flex-1"><small className="block text-dark-400">حجم مصرف‌شده</small><strong className="mt-1 block text-xl text-primary-200">{formatFileSize(storage.total_size)}</strong></span><span className="text-xs text-primary-200">{open?'بستن جزئیات':'دیدن جزئیات'}</span><ChevronLeft className={`h-4 w-4 text-primary-200 transition ${open?'-rotate-90':'rotate-0'}`}/></button>{open&&<div className="mt-3 space-y-2">{rows.map(row=>{const meta=labels[row.type]||{label:'سایر',icon:'📦'};const percent=storage.total_size?Math.round(row.size/storage.total_size*100):0;return <div key={row.type} className="rounded-2xl border border-white/[.06] bg-dark-800/45 p-3"><div className="flex items-center gap-2 text-sm"><span>{meta.icon}</span><strong className="min-w-0 flex-1">{meta.label}</strong><span className="text-xs text-dark-400">{row.count.toLocaleString('fa-IR')} مورد · {formatFileSize(row.size)}</span><span dir="ltr" className="w-10 text-left text-xs font-semibold text-primary-200">{percent}%</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[.06]"><div className="h-full rounded-full bg-primary-500" style={{width:`${percent}%`}}/></div></div>})}</div>}</Card>;
}
function AdminStat({label,value,icon}:{label:string;value:string;icon:React.ReactElement}) { return <div className="min-w-0 rounded-2xl border border-white/[.07] bg-dark-900/70 p-3 text-center"><span className="mx-auto flex h-8 w-8 items-center justify-center rounded-xl bg-primary-500/10 text-primary-300 [&>svg]:h-4 [&>svg]:w-4">{icon}</span><strong className="mt-2 block truncate text-sm text-primary-100">{value}</strong><small className="mt-1 block truncate text-[10px] text-dark-500 sm:text-xs">{label}</small></div>; }
function AdminRow({item,onSave,onQuota,onToggle}:{item:AdminUser;onSave:(name:string)=>Promise<unknown>;onQuota:(daily:number,maxChars:number,sttDaily:number,sttMaxSeconds:number)=>Promise<unknown>;onToggle:()=>Promise<unknown>}) {
    const telegramName = [item.first_name,item.last_name].filter(Boolean).join(' ') || item.username || `کاربر ${item.telegram_id}`;
    const initial = telegramName;
    const savedAlias = item.display_name || '';
    const [name,setName]=useState(item.display_name || ''); const [saving,setSaving]=useState(false);
    const [daily,setDaily]=useState(item.tts_daily_limit||0); const [maxChars,setMaxChars]=useState(item.tts_max_chars||200000); const [sttDaily,setSttDaily]=useState(item.stt_daily_limit||0); const [sttMaxSeconds,setSttMaxSeconds]=useState(item.stt_max_seconds||0); const [quotaSaving,setQuotaSaving]=useState(false); const [detailsOpen,setDetailsOpen]=useState(false);
    const save = async () => { if (!name.trim() || name.trim() === (item.display_name || '')) return; setSaving(true); try { await onSave(name.trim()); } finally { setSaving(false); } };
    return <article className="rounded-2xl border border-white/[.07] bg-dark-800/45 p-4"><div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-500/12 text-lg font-black text-primary-200">{initial[0]}</span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong dir="auto" className="truncate text-sm">{initial}</strong><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${item.is_active?'bg-emerald-500/10 text-emerald-300':'bg-red-500/10 text-red-300'}`}>{item.is_active?'فعال':'غیرفعال'}</span></div><p dir="ltr" className="mt-1 truncate text-xs text-dark-500">{item.username ? `@${item.username}` : `ID: ${item.telegram_id}`}</p></div></div><button type="button" onClick={()=>setDetailsOpen(value=>!value)} className="btn-secondary mt-3 min-h-10 w-full text-xs">{detailsOpen?'بستن جزئیات':'جزئیات و محدودیت‌ها'}</button>{detailsOpen&&<><div className="mt-3 grid grid-cols-2 gap-1.5 text-center sm:grid-cols-4"><span className="rounded-xl bg-white/[.035] p-2"><strong className="block text-xs">{item.file_count.toLocaleString('fa-IR')}</strong><small className="text-[10px] text-dark-500">فایل</small></span><span className="rounded-xl bg-white/[.035] p-2"><strong className="block text-xs">{item.tts_used_today.toLocaleString('fa-IR')} / {item.tts_daily_limit?item.tts_daily_limit.toLocaleString('fa-IR'):'∞'}</strong><small className="text-[10px] text-dark-500">TTS امروز</small></span><span className="rounded-xl bg-white/[.035] p-2"><strong className="block truncate text-xs">{item.tts_total_jobs.toLocaleString('fa-IR')}</strong><small className="text-[10px] text-dark-500">کل TTS</small></span><span className="rounded-xl bg-white/[.035] p-2"><strong className="block truncate text-xs">{item.stt_used_today.toLocaleString('fa-IR')} / {item.stt_daily_limit?item.stt_daily_limit.toLocaleString('fa-IR'):'∞'}</strong><small className="text-[10px] text-dark-500">STT امروز</small></span></div><div className="mt-3 grid grid-cols-2 gap-2"><label className="flex flex-col text-[10px] text-dark-500"><span className="min-h-8">سقف روزانه TTS</span><input type="number" min="0" max="10000" value={daily} onChange={event=>setDaily(Number(event.target.value))} className="input mt-1 w-full"/></label><label className="flex flex-col text-[10px] text-dark-500"><span className="min-h-8">حداکثر نویسه هر متن</span><input type="number" min="100" max="200000" value={maxChars} onChange={event=>setMaxChars(Number(event.target.value))} className="input mt-1 w-full"/></label><label className="flex flex-col text-[10px] text-dark-500"><span className="min-h-8">سقف روزانه STT</span><input type="number" min="0" max="10000" value={sttDaily} onChange={event=>setSttDaily(Number(event.target.value))} className="input mt-1 w-full"/></label><label className="flex flex-col text-[10px] text-dark-500"><span className="min-h-8">حداکثر مدت STT به ثانیه</span><input type="number" min="0" max="604800" value={sttMaxSeconds} onChange={event=>setSttMaxSeconds(Number(event.target.value))} className="input mt-1 w-full"/></label></div><button disabled={quotaSaving} onClick={async()=>{setQuotaSaving(true);try{await onQuota(daily,maxChars,sttDaily,sttMaxSeconds)}finally{setQuotaSaving(false)}}} className="btn-secondary mt-2 min-h-9 w-full text-xs disabled:opacity-40">{quotaSaving?'در حال ذخیره…':'ذخیره محدودیت‌های متن و صدا'}</button><div className="mt-3 flex gap-2"><input value={name} onChange={event=>setName(event.target.value)} className="input min-w-0 flex-1" aria-label="نام نمایشی کاربر"/><button disabled={saving || !name.trim() || name.trim()===savedAlias} className="btn-secondary px-3 text-xs disabled:opacity-40" onClick={()=>void save()}>{saving?'…':'ذخیره نام'}</button></div><button className={`mt-2 min-h-10 w-full rounded-xl text-xs font-semibold ${item.is_active?'bg-red-500/10 text-red-300 hover:bg-red-500/15':'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'}`} onClick={()=>void onToggle()}>{item.is_active?'غیرفعال کردن کاربر':'فعال کردن کاربر'}</button></>}</article>;
}
