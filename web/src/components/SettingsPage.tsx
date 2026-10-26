import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, ArrowRight, AtSign, ChevronDown, ChevronLeft, AudioLines, Check, CheckCircle2, Copy, Database, Download, ExternalLink, FileStack, FileText, FolderPlus, Gauge, Globe2, Grid2X2, HardDrive, KeyRound, LayoutGrid, List, ListRestart, LockKeyhole, LogOut, MessageSquareText, MonitorSmartphone, Moon, MoreVertical, Palette, Pencil, Plus, RefreshCw, Search, Shield, Smartphone, Sun, Tags, Trash2, UserRoundCog, Users, Warehouse, XCircle } from 'lucide-react';
import { AdminUser, Folder, PublicShareItem, TelegramFile, TwoFactorSetup, api, formatFileSize, formatIranTime, formatPersianDate, getServerOrigin, useAccountPreferences, useAddAdminUser, useAdminErrors, useAdminHealth, useAdminStats, useAdminUsers, useClearAdminErrors, useClearSecurityEvents, useCredentials, useCurrentUser, useDisableTwoFactor, useEnableTwoFactor, useFiles, useFolderTree, useGrantWorkspace, useLogoutAll, useLogoutOthers, usePublicShares, useRemoveAdminUser, useRemoveStorageChannel, useResetStorageChannel, useResolveAdminError, useRevokePublicShares, useRevokeSession, useRevokeWorkspace, useSecurityEvents, useSessions, useSetStorageChannel, useSetVaultPassword, useSetupTwoFactor, useStorageChannel, useStorageStats, useUnlockVault, useUpdateAccountPreferences, useUpdateAdminUser, useUpdateCredentials, useVaultStatus, useWorkspaceGrants, useWorkspaces } from '../lib/api';
import { activateAccount, forgetAccount, savedAccounts, saveAuthenticatedAccount, syncCurrentAccount } from '../lib/accounts';
import { applyAppearanceMode, applyCustomTheme, applyTheme, colorThemes, ActiveTheme, AppearanceMode, ColorTheme, getStoredAppearanceMode, getStoredTheme } from '../lib/theme';
import CustomSelect from './CustomSelect';
import TagSettingsPanel from './TagSettingsPanel';
import TransferCenter from './TransferCenter';
import TTSSettingsPanel from './TTSSettingsPanel';
import MarkdownSettingsPanel from './MarkdownSettingsPanel';
import LinkCaptionSettings from './LinkCaptionSettings';
import CardDisplaySettings from './CardDisplaySettings';
import DeliverySettingsPanel from './DeliverySettingsPanel';
import BotMessagesSettings from './BotMessagesSettings';
import AdminGroupsSettings from './AdminGroupsSettings';
import { useAppStore } from '../lib/store';
import { folderTreeLabel } from '../lib/folderTreeLabel';

type SettingsView = 'home' | 'accounts' | 'security' | 'sessions' | 'access' | 'storage' | 'files' | 'appearance' | 'markdown' | 'connection' | 'admin' | 'admin-users' | 'admin-groups' | 'admin-messages' | 'tags' | 'transfers' | 'tts';
type SettingsHomeLayout = 'cards' | 'list' | 'compact';
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
    const clearSecurityEvents = useClearSecurityEvents();
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
    const removeStorageChannel = useRemoveStorageChannel();
    const resetStorageChannel = useResetStorageChannel();
    const updateCredentials = useUpdateCredentials();
    const setupTwoFactor = useSetupTwoFactor();
    const enableTwoFactor = useEnableTwoFactor();
    const disableTwoFactor = useDisableTwoFactor();
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
    const [sharePickerOpen, setSharePickerOpen] = useState(false);
    const [sharePickerTab, setSharePickerTab] = useState<'folders' | 'files'>('folders');
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
    const [twoFactorSetup,setTwoFactorSetup]=useState<TwoFactorSetup|null>(null);
    const [twoFactorCode,setTwoFactorCode]=useState('');
    const [twoFactorMessage,setTwoFactorMessage]=useState<{kind:'ok'|'error';text:string}|null>(null);
    const [vaultPassword,setVaultPasswordValue]=useState('');
    const [vaultMessage,setVaultMessage]=useState<{kind:'ok'|'error';text:string}|null>(null);
    const [activeSubsection,setActiveSubsection]=useState<string|null>(null);
    const [homeLayout,setHomeLayout]=useState<SettingsHomeLayout>(()=>{
        const stored=localStorage.getItem('komod-settings-home-layout');
        return stored==='list'||stored==='compact'?'list'===stored?'list':'compact':'cards';
    });
    const accounts = savedAccounts();
    const incomingFolderOptions = useMemo(() => {
        const result = [{value:'default',label:'🗃️ کشوی پیش‌فرض'}];
        const walk = (items:Folder[], depth=0) => items.forEach(folder => { result.push({value:String(folder.id),label:folderTreeLabel(folder.name,depth)}); if(folder.children) walk(folder.children,depth+1); });
        walk(folderTree); return result;
    }, [folderTree]);
    const shareFolders = useMemo(() => {
        const result:Array<{id:number;name:string;depth:number}>=[];
        const walk=(items:Folder[],depth=0)=>items.forEach(folder=>{result.push({id:folder.id,name:folder.name,depth});if(folder.children)walk(folder.children,depth+1)});
        walk(folderTree); return result;
    },[folderTree]);
    const filteredAdminUsers = useMemo(() => {
        const query = adminQuery.trim().toLocaleLowerCase('fa');
        const matching = query ? adminUsers.filter(item => [item.display_name, item.first_name, item.last_name, item.username, item.login_username, String(item.telegram_id)].filter(Boolean).some(value => String(value).toLocaleLowerCase('fa').includes(query))) : adminUsers;
        return [...matching].sort((a,b)=>Number(b.telegram_id<0&&!b.is_active)-Number(a.telegram_id<0&&!a.is_active));
    }, [adminQuery, adminUsers]);
    const saveStorageChannel = async () => { const channelId=Number(storageChannelInput.trim()); if(!Number.isSafeInteger(channelId)){setStorageChannelMessage({kind:'error',text:'آیدی عددی معتبر کانال را وارد کن.'});return;} try{const result=await setStorageChannel.mutateAsync(channelId);setStorageChannelMessage({kind:'ok',text:`کانال «${result.title||'انتخاب‌شده'}» برای فایل‌های تازه فعال شد.`});setStorageChannelInput('');}catch(error:any){setStorageChannelMessage({kind:'error',text:error?.response?.data?.detail||'اتصال کانال انجام نشد.'});} };

    useEffect(() => applyTheme(theme), [theme]);
    useEffect(() => { if (user) syncCurrentAccount(user); }, [user]);
    useEffect(() => { if (credentials?.username) setCredentialUsername(credentials.username); }, [credentials?.username]);
    useEffect(() => { if (confirmation === 'others') void logoutOtherDevices(); }, [confirmation]);
    useEffect(() => {
        const openTTS = () => { localStorage.removeItem('komod-settings-target'); setView('tts'); };
        const openHome = () => setView('home');
        window.addEventListener('komod-open-tts', openTTS);
        window.addEventListener('komod-open-settings-home', openHome);
        return () => { window.removeEventListener('komod-open-tts', openTTS); window.removeEventListener('komod-open-settings-home', openHome); };
    }, []);
    useEffect(()=>{window.dispatchEvent(new CustomEvent('komod-settings-view',{detail:{view}}))},[view]);
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
    const beginTwoFactor=async()=>{setTwoFactorMessage(null);try{setTwoFactorSetup(await setupTwoFactor.mutateAsync());setTwoFactorCode('')}catch(error:any){setTwoFactorMessage({kind:'error',text:error?.response?.data?.detail||'راه‌اندازی تأیید دومرحله‌ای انجام نشد.'})}};
    const confirmTwoFactor=async()=>{if(!twoFactorSetup)return;setTwoFactorMessage(null);try{await enableTwoFactor.mutateAsync({setup_token:twoFactorSetup.setup_token,code:twoFactorCode,current_password:currentPassword||undefined});setTwoFactorSetup(null);setTwoFactorCode('');setTwoFactorMessage({kind:'ok',text:'تأیید دومرحله‌ای فعال شد.'})}catch(error:any){setTwoFactorMessage({kind:'error',text:error?.response?.data?.detail||'کد تأیید نشد.'})}};
    const turnOffTwoFactor=async()=>{setTwoFactorMessage(null);try{await disableTwoFactor.mutateAsync({code:twoFactorCode||undefined,current_password:currentPassword||undefined});setTwoFactorCode('');setTwoFactorMessage({kind:'ok',text:'تأیید دومرحله‌ای غیرفعال شد.'})}catch(error:any){setTwoFactorMessage({kind:'error',text:error?.response?.data?.detail||'غیرفعال‌سازی انجام نشد.'})}};
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
    const editGrantScope = (grant: typeof grants[number]) => {
        setEditingGrantId(grant.user_id);
        setShareTelegramId(String(grant.telegram_id));
        setSharePermission(grant.permission === 'write' ? 'write' : 'read');
        setShareFolderIds(grant.folder_ids || []);
        setShareFileIds(grant.file_ids || []);
        setLimitedShare(Boolean(grant.folder_ids?.length || grant.file_ids?.length));
        setSharePickerTab((grant.folder_ids?.length || !grant.file_ids?.length) ? 'folders' : 'files');
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
            setLimitedShare(false);
            setSharePickerOpen(false);
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
    const sectionLinks = settingsSectionLinks(view,Boolean(user?.is_admin||user?.can_use_monitors));
    const selectedSubsection = sectionLinks.some(item=>item.id===activeSubsection) ? activeSubsection : sectionLinks[0]?.id || null;
    const visibleAdminUsers = useMemo(() => filteredAdminUsers.filter(item => {
        if (selectedSubsection === 'admin-users-pending') return item.telegram_id < 0 && !item.is_active;
        if (selectedSubsection === 'admin-users-disabled') return !item.is_active && item.telegram_id >= 0;
        return item.is_active;
    }), [filteredAdminUsers, selectedSubsection]);
    const { data: adminErrors = [] } = useAdminErrors(Boolean(user?.is_admin) && view === 'admin' && selectedSubsection === 'admin-health');
    const resolveAdminError = useResolveAdminError();
    const clearAdminErrors = useClearAdminErrors();
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
            <div className="min-w-0 flex-1"><p className="text-xs font-semibold text-primary-300">⚙️ تنظیمات کمد</p><h1 className="mt-2 text-2xl font-bold sm:text-3xl">{viewTitle(view)}</h1>{viewSubtitle(view)&&<p className="mt-2 text-sm text-dark-400">{viewSubtitle(view)}</p>}</div>
            <div className="flex shrink-0 items-center gap-2">
                {view==='home'&&<div className="flex items-center gap-1"><button type="button" onClick={()=>setAllSettingsGroups(true)} className="btn-icon h-9 w-9" title="بازکردن همه بخش‌ها" aria-label="بازکردن همه بخش‌ها"><ChevronDown className="h-4 w-4 rotate-180"/></button><button type="button" onClick={()=>setAllSettingsGroups(false)} className="btn-icon h-9 w-9" title="بستن همه بخش‌ها" aria-label="بستن همه بخش‌ها"><ChevronDown className="h-4 w-4"/></button><SettingsLayoutPicker value={homeLayout} onChange={next=>{setHomeLayout(next);localStorage.setItem('komod-settings-home-layout',next)}}/></div>}
                <button type="button" className="btn-icon h-10 w-10 text-primary-200" title={appearanceMode==='dark'?'حالت روشن':'حالت تاریک'} aria-label={appearanceMode==='dark'?'فعال‌کردن حالت روشن':'فعال‌کردن حالت تاریک'} onClick={()=>chooseAppearanceMode(appearanceMode==='dark'?'light':'dark')}>{appearanceMode==='dark'?<Sun className="h-4.5 w-4.5"/>:<Moon className="h-4.5 w-4.5"/>}</button>
            </div>
        </header>

        {sectionLinks.length>1&&<SectionJumpNav items={sectionLinks} active={selectedSubsection} onChange={setActiveSubsection} mobileGrid={view.startsWith('admin')}/>}

        {view === 'home' && <div className="space-y-5">
            <section className="overflow-hidden rounded-3xl border border-white/[.07] bg-gradient-to-bl from-primary-500/[.12] via-dark-900/80 to-dark-950/85 p-4 sm:p-5">
                <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                    <SummaryCard icon={<Smartphone/>} title={displayName} text="حساب فعال" />
                    <SummaryCard icon={<HardDrive/>} title={storage ? formatFileSize(storage.total_size) : '…'} text="فضای استفاده‌شده" />
                </div>
            </section>

            <SettingsGroup title="حساب و امنیت" text="ورود، دستگاه‌ها و دسترسی دیگران" icon={<Shield/>} layout={homeLayout}>
                <SettingsButton layout={homeLayout} icon={<Users/>} title="حساب‌ها" text="افزودن حساب، جابه‌جایی و پشتیبان" onClick={() => setView('accounts')} />
                <SettingsButton layout={homeLayout} icon={<KeyRound/>} title="ورود و امنیت" text="رمز عبور، بازیابی و گاوصندوق" onClick={() => setView('security')} />
                <SettingsButton layout={homeLayout} icon={<MonitorSmartphone/>} title="مدیریت نشست‌ها" text="دستگاه‌های واردشده و رویدادهای امنیتی" onClick={() => setView('sessions')} />
                <SettingsButton layout={homeLayout} icon={<Shield/>} title="دسترسی و اشتراک‌گذاری" text="کمدهای مشترک و سطح دسترسی افراد" onClick={() => setView('access')} />
            </SettingsGroup>

            <SettingsGroup title="فایل‌ها و فضا" text="محل نگهداری، نمایش و انتقال فایل‌ها" icon={<FolderPlus/>} layout={homeLayout}>
                <SettingsButton layout={homeLayout} icon={<Database/>} title="فضای ذخیره‌سازی" text="فضای شخصی، آمار مصرف و حذف فایل" onClick={() => setView('storage')} />
                <SettingsButton layout={homeLayout} icon={<FolderPlus/>} title="فایل‌ها و مقصدها" text="نمایش کارت‌ها، مقصد فایل‌های تازه و لینک‌ها" onClick={() => setView('files')} />
                <SettingsButton layout={homeLayout} icon={<Tags/>} title="مدیریت تگ‌ها" text="ساخت، دسته‌بندی، رنگ و شیوه نمایش" onClick={() => setView('tags')} />
                <SettingsButton layout={homeLayout} icon={<ListRestart/>} title="مرکز انتقال‌ها" text="دانلود، آپلود، لینک‌ها و ذخیره آفلاین" onClick={() => setView('transfers')} />
            </SettingsGroup>

            <SettingsGroup title="ظاهر و مطالعه" text="شخصی‌سازی شکل برنامه و متن‌ها" icon={<Palette/>} layout={homeLayout}>
                <SettingsButton layout={homeLayout} icon={<Palette/>} title="ظاهر برنامه" text="رنگ کمد و حالت روشن یا تاریک" onClick={() => setView('appearance')} />
                <SettingsButton layout={homeLayout} icon={<FileText/>} title="مطالعه و Markdown" text="فونت، اندازه، ابزار مطالعه و تم متن" onClick={() => setView('markdown')} />
            </SettingsGroup>

            <SettingsGroup title="ابزارها" text="کارهای هوشمند و قابلیت‌های دستگاه" icon={<AudioLines/>} layout={homeLayout}>
                <SettingsButton layout={homeLayout} icon={<AudioLines/>} title="متن و صدا" text="ساخت صدا و استخراج متن از صوت یا ویدیو" onClick={() => setView('tts')} />
                <SettingsButton layout={homeLayout} icon={<Download/>} title="نصب کمد" text="افزودن برنامه به صفحه اصلی این دستگاه" onClick={() => window.dispatchEvent(new Event('komod-install-request'))} />
            </SettingsGroup>

            {user?.is_admin && <SettingsGroup title="مدیریت" text="تنظیمات فنی، کاربران، گروه‌ها و ربات" icon={<UserRoundCog/>} layout={homeLayout}>
                <SettingsButton layout={homeLayout} icon={<Globe2/>} title="اتصال برنامه" text="آدرس اصلی یا مسیر HTTPS جایگزین" onClick={() => setView('connection')} />
                <SettingsButton layout={homeLayout} icon={<UserRoundCog/>} title="کاربران" text="درخواست‌ها، کاربران فعال، غیرفعال و افزودن کاربر" onClick={() => setView('admin-users')} />
                <SettingsButton layout={homeLayout} icon={<Users/>} title="گروه‌ها" text="تأیید گروه‌ها، محدودیت‌ها و میزان مصرف" onClick={() => setView('admin-groups')} />
                <SettingsButton layout={homeLayout} icon={<MessageSquareText/>} title="پیام‌های ربات" text="ویرایش پاسخ دستورها، لینک‌ها و پردازش‌ها" onClick={() => setView('admin-messages')} />
                <SettingsButton layout={homeLayout} icon={<Gauge/>} title="گزارش و سلامت" text="آمار کلی، وضعیت سرویس‌ها و خطاها" onClick={() => setView('admin')} />
            </SettingsGroup>}
        </div>}

        {view === 'accounts' && <div className="space-y-4">
            <Card id="accounts-overview-current" icon={<Smartphone/>} title="حساب فعال"><p className="mt-4 text-lg font-bold">{displayName}</p><p className="mt-1 flex items-center gap-1.5 text-sm text-dark-400" dir="ltr"><AtSign className="h-4 w-4"/>{user?.username || 'بدون نام کاربری'}</p><p className="mt-2 text-xs text-dark-500">آیدی تلگرام: <span dir="ltr">{user?.telegram_id || '…'}</span></p></Card>
            <Card id="accounts-overview-device" icon={<Users/>} title="حساب‌های این دستگاه" subtitle="بین حساب‌های ذخیره‌شده جابه‌جا شو یا حساب تازه‌ای اضافه کن."><div className="mt-4 grid gap-2 sm:grid-cols-2">{accounts.map(account => {const telegramName=[account.user.first_name,account.user.last_name].filter(Boolean).join(' ')||account.user.username||String(account.telegramId);return <div key={account.telegramId} className={`flex items-center gap-3 rounded-xl border p-3 ${account.telegramId === user?.telegram_id ? 'border-primary-400/30 bg-primary-500/10' : 'border-white/[.07] bg-dark-800/50'}`}><div className="flex h-10 w-10 items-center justify-center rounded-full bg-white/[.06] font-bold">{telegramName[0]}</div><div className="min-w-0 flex-1"><strong className="block truncate text-sm">{telegramName}</strong><small className="text-dark-500">{account.telegramId === user?.telegram_id ? 'حساب فعال' : `@${account.user.username || account.telegramId}`}</small></div>{account.telegramId !== user?.telegram_id && <><button className="rounded-xl bg-primary-500/15 px-3 py-2 text-xs font-semibold text-primary-100 transition hover:bg-primary-500/25" onClick={() => activateAccount(account)}>ورود</button><button className="btn-icon text-red-300" title="حذف از این دستگاه" onClick={() => { forgetAccount(account.telegramId); window.location.reload(); }}><Trash2 className="h-4 w-4"/></button></>}</div>})}</div><a href="/login?add=1" className="mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary-400/20 bg-primary-500/[.09] text-sm font-semibold text-primary-100 transition hover:bg-primary-500/15"><Plus className="h-4 w-4"/> افزودن حساب دیگر</a></Card>
            <Card id="accounts-backup" icon={<Database/>} title="پشتیبان حساب" subtitle="کشوها، پلی‌لیست‌ها، تگ‌ها و اطلاعات فایل‌ها را جابه‌جا کن."><div className="mt-4 grid gap-2 sm:grid-cols-2"><button className="flex min-h-11 items-center justify-center gap-2 rounded-xl border border-primary-400/20 bg-primary-500/[.09] px-4 text-xs font-semibold text-primary-100 transition hover:bg-primary-500/15" onClick={async()=>{try{const response=await api.get('/accounts/export',{responseType:'blob'});const url=URL.createObjectURL(response.data);const anchor=document.createElement('a');anchor.href=url;anchor.download=`komod-backup-${user?.telegram_id||'account'}.json`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{useAppStore.getState().addToast('گرفتن نسخه پشتیبان انجام نشد.','error');}}}><Download className="h-4 w-4"/>گرفتن نسخه پشتیبان</button><label className={`flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-primary-400/20 bg-primary-500/[.09] px-4 text-xs font-semibold text-primary-100 transition hover:bg-primary-500/15 ${importingBackup?'pointer-events-none opacity-50':''}`}><RefreshCw className={`h-4 w-4 ${importingBackup?'animate-spin':''}`}/>{importingBackup?'در حال بازیابی…':'بازیابی نسخه'}<input type="file" accept="application/json,.json" className="hidden" onChange={event=>{void restoreBackup(event.target.files?.[0]);event.currentTarget.value='';}}/></label></div><p className="mt-3 text-xs leading-6 text-dark-500">رمزها و کلیدهای خصوصی داخل فایل پشتیبان قرار نمی‌گیرند.</p></Card>
        </div>}

        {view === 'tags' && <TagSettingsPanel activeSection={selectedSubsection}/>}
        {view === 'transfers' && <TransferCenter/>}

        {view === 'security' && <div className="space-y-4"><Card id="security-login" icon={<KeyRound/>} title={credentials?.enabled?'تغییر اطلاعات ورود':'فعال‌کردن ورود مستقل'} subtitle="ورود مستقیم با نام کاربری و رمز."><div className="mt-4 space-y-3"><label className="block text-xs text-dark-400">نام کاربری<input dir="rtl" autoComplete="username" value={credentialUsername} onChange={event=>setCredentialUsername(event.target.value.toLowerCase())} className="input mt-1.5 w-full text-right" placeholder="komod_user"/></label>{credentials?.enabled&&<label className="block text-xs text-dark-400">رمز فعلی<input dir="rtl" type="password" autoComplete="current-password" value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)} className="input mt-1.5 w-full text-right" placeholder="برای تأیید تغییرات"/></label>}<div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs text-dark-400">رمز جدید<input dir="rtl" type="password" autoComplete="new-password" value={newPassword} onChange={event=>setNewPassword(event.target.value)} className="input mt-1.5 w-full text-right" placeholder="حداقل ۸ نویسه"/></label><label className="block text-xs text-dark-400">تکرار رمز جدید<input dir="rtl" type="password" autoComplete="new-password" value={repeatPassword} onChange={event=>setRepeatPassword(event.target.value)} className="input mt-1.5 w-full text-right" placeholder="تکرار رمز"/></label></div><button disabled={updateCredentials.isPending||credentialUsername.trim().length<4||(!credentials?.enabled&&newPassword.length<8)||(credentials?.enabled&&!currentPassword)} onClick={()=>void saveCredentials()} className="btn-primary min-h-11 w-full disabled:opacity-50">{updateCredentials.isPending?'در حال ذخیره…':'ذخیره اطلاعات ورود'}</button>{credentialMessage&&<p className={`rounded-xl px-3 py-2 text-sm ${credentialMessage.kind==='ok'?'bg-emerald-500/10 text-emerald-300':'bg-red-500/10 text-red-300'}`}>{credentialMessage.text}</p>}</div></Card><Card id="security-vault" icon={<LockKeyhole/>} title="گاوصندوق فایل‌ها" subtitle="فایل‌ها و کشوهای مخفی بدون رمز در فهرست و API نمایش داده نمی‌شوند."><div className="mt-4 space-y-3"><input dir="rtl" type="password" value={vaultPassword} onChange={event=>setVaultPasswordValue(event.target.value)} className="input w-full text-right" placeholder={vaultStatus?.configured?'رمز گاوصندوق':'یک رمز حداقل ۶ نویسه‌ای'}/><div className="grid grid-cols-2 gap-2"><button disabled={vaultPassword.length<6||unlockVault.isPending} className="btn-secondary min-h-11 disabled:opacity-40" onClick={async()=>{try{await unlockVault.mutateAsync(vaultPassword);setVaultMessage({kind:'ok',text:'گاوصندوق برای این نشست باز شد.'});setVaultPasswordValue('');window.dispatchEvent(new Event('komod-vault-changed'));}catch(error:any){setVaultMessage({kind:'error',text:error?.response?.data?.detail||'رمز درست نیست.'});}}}>باز کردن</button><button disabled={vaultPassword.length<6||setVaultPassword.isPending} className="btn-primary min-h-11 disabled:opacity-40" onClick={async()=>{try{await setVaultPassword.mutateAsync(vaultPassword);setVaultMessage({kind:'ok',text:vaultStatus?.configured?'رمز گاوصندوق عوض شد.':'گاوصندوق فعال شد.'});setVaultPasswordValue('');window.dispatchEvent(new Event('komod-vault-changed'));}catch(error:any){setVaultMessage({kind:'error',text:error?.response?.data?.detail||'ذخیره رمز انجام نشد.'});}}}>{vaultStatus?.configured?'تغییر رمز':'ساخت گاوصندوق'}</button></div>{vaultMessage&&<p className={`rounded-xl px-3 py-2 text-sm ${vaultMessage.kind==='ok'?'bg-emerald-500/10 text-emerald-300':'bg-red-500/10 text-red-300'}`}>{vaultMessage.text}</p>}</div></Card><Card id="security-vault" icon={<Shield/>} title="محافظت از حساب"><ul className="mt-3 list-disc space-y-2 pr-5 text-sm leading-7 text-dark-400"><li>پس از پنج تلاش ناموفق، ورود ۱۵ دقیقه قفل می‌شود.</li><li>ورودهای هر دستگاه در بخش نشست‌ها قابل مشاهده و لغو هستند.</li><li>اگر رمز را فراموش کردی، ورود با تلگرام همچنان مسیر بازیابی امن است.</li></ul></Card></div>}

        {view==='security'&&selectedSubsection==='security-login'&&<div className="space-y-4">
            {credentials?.recovery_available&&credentials.enabled&&<Card icon={<KeyRound/>} title="بازیابی رمز" subtitle="هویتت همین الان با تلگرام تأیید شده است."><div className="mt-4 space-y-3"><p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs leading-6 text-emerald-200">تا ۱۰ دقیقه می‌توانی بدون رمز قبلی، رمز تازه را ذخیره کنی.</p><button disabled={newPassword.length<8||newPassword!==repeatPassword||credentialUsername.trim().length<4||updateCredentials.isPending} onClick={()=>void saveCredentials()} className="btn-primary min-h-11 w-full disabled:opacity-40">ثبت رمز جدید</button></div></Card>}
        </div>}
        {view==='security'&&selectedSubsection==='security-2fa'&&<Card id="security-2fa" icon={<LockKeyhole/>} title="تأیید دومرحله‌ای" subtitle="برای ورود با رمز، کد برنامهٔ Authenticator هم لازم می‌شود."><div className="mt-4 space-y-3">{credentials?.enabled&&<label className="block text-xs text-dark-400">رمز فعلی<input dir="rtl" type="password" autoComplete="current-password" value={currentPassword} onChange={event=>setCurrentPassword(event.target.value)} className="input mt-1.5 w-full text-right" placeholder="برای تأیید تغییرات"/></label>}{!credentials?.two_factor_enabled&&!twoFactorSetup&&<button disabled={setupTwoFactor.isPending||!credentials?.enabled} onClick={()=>void beginTwoFactor()} className="btn-primary min-h-11 w-full disabled:opacity-40">{setupTwoFactor.isPending?'در حال آماده‌سازی…':'راه‌اندازی تأیید دومرحله‌ای'}</button>}{!credentials?.enabled&&<p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs leading-6 text-amber-200">ابتدا از بخش «ورود و امنیت» نام کاربری و رمز بساز.</p>}{twoFactorSetup&&<div className="space-y-3"><p className="text-xs leading-6 text-dark-300">این کلید را در Google Authenticator یا برنامه مشابه وارد کن:</p><button type="button" dir="ltr" onClick={()=>void navigator.clipboard.writeText(twoFactorSetup.secret)} className="w-full break-all rounded-xl border border-white/[.08] bg-dark-950/50 px-3 py-3 font-mono text-xs tracking-wider text-primary-200">{twoFactorSetup.secret}</button><a href={twoFactorSetup.provisioning_uri} className="btn-secondary flex min-h-10 items-center justify-center text-xs">بازکردن در برنامهٔ تأیید</a><input dir="ltr" inputMode="numeric" maxLength={6} value={twoFactorCode} onChange={event=>setTwoFactorCode(event.target.value.replace(/\D/g,'').slice(0,6))} className="input w-full text-center font-mono tracking-[.35em]" placeholder="کد ۶ رقمی"/><button disabled={twoFactorCode.length!==6||enableTwoFactor.isPending} onClick={()=>void confirmTwoFactor()} className="btn-primary min-h-11 w-full disabled:opacity-40">فعال‌سازی</button></div>}{credentials?.two_factor_enabled&&<div className="space-y-3">{!credentials.recovery_available&&<input dir="ltr" inputMode="numeric" maxLength={6} value={twoFactorCode} onChange={event=>setTwoFactorCode(event.target.value.replace(/\D/g,'').slice(0,6))} className="input w-full text-center font-mono tracking-[.35em]" placeholder="کد فعلی برای غیرفعال‌سازی"/>}<button disabled={(!credentials.recovery_available&&twoFactorCode.length!==6)||disableTwoFactor.isPending} onClick={()=>void turnOffTwoFactor()} className="btn-secondary min-h-11 w-full text-red-300 disabled:opacity-40">غیرفعال‌کردن</button><div className="flex items-start gap-3 rounded-2xl border border-emerald-400/20 bg-emerald-500/[.08] p-3.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-300"><CheckCircle2 className="h-5 w-5"/></span><div><strong className="block text-sm text-emerald-100">تأیید دومرحله‌ای روشن است</strong><p className="mt-1 text-xs leading-5 text-emerald-200/75">ورود با رمز، به کد یک‌بارمصرف برنامهٔ تأیید هم نیاز دارد.</p></div></div></div>}{twoFactorMessage&&<p className={`rounded-xl px-3 py-2 text-sm ${twoFactorMessage.kind==='ok'?'bg-emerald-500/10 text-emerald-300':'bg-red-500/10 text-red-300'}`}>{twoFactorMessage.text}</p>}</div></Card>}
        {view === 'sessions' && selectedSubsection !== 'sessions-shares' && <div className="space-y-4"><Card id="sessions-active" icon={<MonitorSmartphone/>} title="نشست‌های فعال" subtitle="دستگاه‌هایی که با حساب فعلی وارد کمد شده‌اند."><div className="mt-4 space-y-2">{sessions.length ? sessions.map(session => <div key={session.id} className="flex items-center gap-3 rounded-xl bg-dark-800/50 p-3"><MonitorSmartphone className="h-5 w-5 text-dark-400"/><div className="min-w-0 flex-1"><strong className="block text-sm">{session.device_name} {session.current && <span className="text-primary-300">· همین دستگاه</span>}</strong><small className="text-dark-500">آخرین فعالیت: {formatPersianDate(session.last_seen_at)}</small></div>{!session.current&&<button className="btn-icon text-red-300" title="خروج این دستگاه" onClick={() => void revokeSession.mutateAsync(session.id)}><LogOut className="h-4 w-4"/></button>}</div>) : <p className="text-sm text-dark-500">نشست فعالی ثبت نشده است.</p>}</div><div className="mt-4 grid gap-2 sm:grid-cols-3"><button className="btn-secondary flex min-h-11 items-center justify-center gap-2 text-red-300" onClick={() => setConfirmation('device')}><LogOut className="h-4 w-4"/> خروج از این دستگاه</button><button className="btn-secondary flex min-h-11 items-center justify-center gap-2 text-orange-300" onClick={() => setConfirmation('others')}><MonitorSmartphone className="h-4 w-4"/> خروج بقیه نشست‌ها</button><button className="btn-secondary flex min-h-11 items-center justify-center gap-2 text-orange-300" onClick={() => setConfirmation('all')}><Users className="h-4 w-4"/> خروج از همه</button></div></Card><Card id="sessions-events" icon={<Activity/>} title="رویدادهای امنیتی" subtitle="ورودها، تغییرات حساب و استفاده از پیوندهای عمومی."><div className="mt-4 flex justify-end">{securityEvents.length>0&&<button disabled={clearSecurityEvents.isPending} onClick={()=>void clearSecurityEvents.mutateAsync()} className="flex min-h-9 items-center gap-1.5 rounded-xl bg-red-500/10 px-3 text-xs text-red-300 disabled:opacity-40"><Trash2 className="h-3.5 w-3.5"/>{clearSecurityEvents.isPending?'در حال پاک‌کردن…':'پاک‌کردن تاریخچه'}</button>}</div><div className="mt-3 space-y-2">{securityEvents.length?securityEvents.map(event=><div key={event.id} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${event.suspicious?'bg-red-500/[.08]':'bg-dark-800/45'}`}><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${event.success?'bg-emerald-400':'bg-red-400'}`}/><div className="min-w-0 flex-1"><strong className="block truncate text-xs">{securityEventLabel(event.event_type)}</strong><small className="text-[10px] text-dark-500">{formatPersianDate(event.created_at)}{event.ip_address?` · ${event.ip_address}`:''}</small></div>{event.suspicious&&<span className="rounded-lg bg-red-500/10 px-2 py-1 text-[9px] text-red-300">مشکوک</span>}</div>):<p className="text-sm text-dark-500">هنوز رویدادی ثبت نشده است.</p>}</div></Card></div>}

        {view === 'sessions' && selectedSubsection === 'sessions-shares' && <PublicSharesPanel/>}

        {view === 'storage' && storage && <StorageOverview storage={storage}/>}

        {view === 'storage' && <div className="space-y-4"><Card id="storage-channel" icon={<Database/>} title="کانال‌های ذخیره‌سازی" subtitle="چند کانال خصوصی وصل کن و کانال فعال فایل‌های تازه را انتخاب کن.">
            <div className="mt-4 space-y-2">{storageChannel?.channels?.length ? storageChannel.channels.map(channel => <div key={channel.channel_id} className={`flex items-center gap-3 rounded-2xl border p-3 ${channel.active?'border-primary-400/30 bg-primary-500/10':'border-white/[.07] bg-dark-800/45'}`}><span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${channel.active?'bg-primary-500/20 text-primary-200':'bg-white/[.05] text-dark-400'}`}>{channel.active?<Check className="h-5 w-5"/>:<Database className="h-5 w-5"/>}</span><button className="min-w-0 flex-1 text-right" disabled={channel.active||setStorageChannel.isPending} onClick={()=>void setStorageChannel.mutateAsync(channel.channel_id)}><strong className="block truncate text-sm">{channel.title||'کانال تنظیم‌شده'}</strong><small dir="ltr" className="block truncate text-left font-player text-dark-500">{channel.channel_id}</small></button>{channel.active&&<span className="rounded-lg bg-primary-500/15 px-2 py-1 text-[10px] text-primary-200">فعال</span>}<button className="btn-icon h-9 w-9 text-red-300" title="حذف کانال" disabled={removeStorageChannel.isPending} onClick={()=>void removeStorageChannel.mutateAsync(channel.channel_id)}><Trash2 className="h-4 w-4"/></button></div>) : <div className="rounded-2xl border border-white/[.07] bg-dark-800/45 p-4 text-center text-sm text-dark-500">هنوز کانال اختصاصی وصل نشده است.</div>}</div>
            <ol className="mt-4 list-decimal space-y-1.5 pr-5 text-xs leading-6 text-dark-400"><li>کانال خصوصی را بساز و ربات را با اجازه ارسال و حذف پیام مدیر کن.</li><li>آیدی عددی کانال را که با <span dir="ltr" className="font-player text-primary-200">-100</span> شروع می‌شود وارد کن.</li><li>با لمس هر کانال، همان کانال مقصد فایل‌های تازه می‌شود.</li></ol>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row"><input dir="ltr" value={storageChannelInput} onChange={event=>setStorageChannelInput(event.target.value)} className="input min-h-11 flex-1 text-left" placeholder="-1001234567890"/><button disabled={setStorageChannel.isPending||!storageChannelInput.trim()} onClick={()=>void saveStorageChannel()} className="btn-primary min-h-11 px-5 disabled:opacity-50">افزودن و فعال‌کردن</button></div>
            {storageChannel?.configured&&<button disabled={resetStorageChannel.isPending} className="btn-secondary mt-3 inline-flex min-h-9 items-center gap-2 border-red-400/20 bg-red-500/[.08] px-3 text-xs text-red-200 hover:bg-red-500/[.14] disabled:opacity-50" onClick={async()=>{try{await resetStorageChannel.mutateAsync();setStorageChannelMessage({kind:'ok',text:'همه کانال‌های اختصاصی قطع شدند.'});}catch(error:any){setStorageChannelMessage({kind:'error',text:error?.response?.data?.detail||'قطع اتصال کانال‌ها انجام نشد.'});}}}>قطع اتصال همه کانال‌ها</button>}
            {storageChannelMessage&&<p className={`mt-3 rounded-xl px-3 py-2 text-sm ${storageChannelMessage.kind==='ok'?'bg-emerald-500/10 text-emerald-300':'bg-red-500/10 text-red-300'}`}>{storageChannelMessage.text}</p>}
        </Card></div>}

        {view === 'storage' && <Card id="storage-delete" icon={<Trash2/>} title="حذف فایل‌ها" subtitle="مشخص کن حذف از کمد با نسخه اصلی فایل چه رفتاری داشته باشد."><div className="mt-4 grid grid-cols-2 overflow-hidden rounded-xl border border-white/[.08] bg-dark-950/50 p-1"><button disabled={updateAccountPreferences.isPending} onClick={()=>void updateAccountPreferences.mutateAsync({delete_storage_files:false})} className={`min-h-11 rounded-lg px-2 text-xs transition sm:text-sm ${accountPreferences?.delete_storage_files===false?'bg-primary-500 text-white':'text-dark-400'}`}>فقط پنهان از کمد</button><button disabled={updateAccountPreferences.isPending} onClick={()=>void updateAccountPreferences.mutateAsync({delete_storage_files:true})} className={`min-h-11 rounded-lg px-2 text-xs transition sm:text-sm ${accountPreferences?.delete_storage_files!==false?'bg-red-500/80 text-white':'text-dark-400'}`}>حذف کامل فایل</button></div><p className="mt-3 text-xs leading-6 text-dark-500">در حالت «فقط پنهان»، رکورد فایل از کمد برداشته می‌شود اما نسخه اصلی آن دست‌نخورده می‌ماند.</p></Card>}

        {view === 'access' && <div className="space-y-4">
            <Card id="access-workspaces" icon={<Warehouse/>} title="کمدهای در دسترس" subtitle="کمد خودت و فضاهایی که دیگران با تو به اشتراک گذاشته‌اند."><div className="mt-4 grid gap-2 sm:grid-cols-2">{workspaces.map(space => <button key={space.user_id} onClick={() => switchWorkspace(space.user_id)} className={`flex items-center gap-3 rounded-xl border p-3 text-right ${activeWorkspace === space.user_id ? 'border-primary-400/35 bg-primary-500/10' : 'border-white/[.07] bg-dark-800/50'}`}><Warehouse className="h-5 w-5 text-primary-300"/><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{space.name}</strong><small className="text-dark-500">{permissionLabel(space.permission)}</small></span>{activeWorkspace === space.user_id && <span className="text-primary-300">✓</span>}</button>)}</div></Card>
            <Card id="access-sharing" icon={<Shield/>} title={editingGrantId?'ویرایش دسترسی':'اشتراک‌گذاری کمد'} subtitle="فرد، نوع دسترسی و بخش‌های قابل مشاهده را مشخص کن.">
                <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_13rem]"><input dir="rtl" value={shareTelegramId} readOnly={editingGrantId!==null} onChange={event => setShareTelegramId(event.target.value)} placeholder="یوزرنیم یا آیدی عددی" className="input min-h-11 w-full text-right read-only:opacity-60"/><PermissionSelect value={sharePermission} onChange={setSharePermission}/></div>
                <div className="mt-3 rounded-2xl border border-white/[.07] bg-dark-950/45 p-2.5"><div className="grid grid-cols-2 gap-1 rounded-xl bg-white/[.035] p-1"><button type="button" onClick={()=>setLimitedShare(false)} className={`min-h-10 rounded-lg px-2 text-xs font-semibold transition ${!limitedShare?'bg-primary-500 text-white shadow-lg shadow-primary-950/20':'text-dark-400 hover:text-white'}`}>همهٔ کمد</button><button type="button" onClick={()=>{setLimitedShare(true);setSharePickerOpen(true)}} className={`min-h-10 rounded-lg px-2 text-xs font-semibold transition ${limitedShare?'bg-primary-500 text-white shadow-lg shadow-primary-950/20':'text-dark-400 hover:text-white'}`}>انتخابی</button></div>{limitedShare&&<button type="button" onClick={()=>setSharePickerOpen(true)} className="mt-2 flex min-h-11 w-full items-center gap-3 rounded-xl border border-primary-400/15 bg-primary-500/[.07] px-3 text-right transition hover:bg-primary-500/[.12]"><FileStack className="h-4 w-4 shrink-0 text-primary-300"/><span className="min-w-0 flex-1 text-xs text-dark-200">انتخاب فایل‌ها و کشوها</span><span className="rounded-lg bg-primary-500/15 px-2 py-1 text-[10px] font-bold text-primary-200">{(shareFolderIds.length+shareFileIds.length).toLocaleString('fa-IR')}</span></button>}</div>
                <div className="mt-3 flex flex-wrap items-center gap-2"><button disabled={grantWorkspace.isPending} onClick={() => void submitGrant()} className="btn-primary min-h-11 flex-1 px-5 sm:flex-none">{grantWorkspace.isPending?'در حال ذخیره…':editingGrantId?'ذخیره تغییرات':'دادن دسترسی'}</button>{editingGrantId&&<button className="btn-secondary min-h-11 px-4 text-xs" onClick={()=>{setEditingGrantId(null);setShareTelegramId('');setShareFolderIds([]);setShareFileIds([]);setLimitedShare(false)}}>لغو ویرایش</button>}</div>
                {accessMessage && <p className={`mt-3 rounded-xl px-3 py-2 text-sm ${accessMessage.kind === 'ok' ? 'bg-emerald-500/10 text-emerald-300' : 'bg-red-500/10 text-red-300'}`}>{accessMessage.text}</p>}
                {grants.length > 0 && <div className="mt-5 border-t border-white/[.06] pt-4"><div className="mb-2 flex items-center justify-between"><h3 className="text-xs font-semibold text-dark-300">افراد دارای دسترسی</h3><span className="rounded-lg bg-dark-800 px-2 py-1 text-[10px] text-dark-400">{grants.length.toLocaleString('fa-IR')} نفر</span></div><div className="grid gap-2 sm:grid-cols-2">{grants.map(grant => <div key={grant.user_id} className="group flex min-w-0 items-center gap-2.5 rounded-2xl border border-white/[.06] bg-dark-800/45 p-2.5 transition hover:border-primary-400/20"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-sm font-bold text-primary-200">{(grant.name||'?').trim().charAt(0)}</span><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><strong className="truncate text-xs">{grant.name}</strong><span className="shrink-0 rounded-md bg-white/[.05] px-1.5 py-0.5 text-[9px] text-dark-400">{permissionLabel(grant.permission)}</span></div><p className="mt-1 truncate text-[10px] text-dark-500">{grant.folder_ids.length||grant.file_ids.length?`${grant.folder_ids.length.toLocaleString('fa-IR')} کشو · ${grant.file_ids.length.toLocaleString('fa-IR')} فایل`:'همهٔ کمد'}{grant.username?` · @${grant.username}`:''}</p></div><button title="ویرایش دسترسی" aria-label={`ویرایش دسترسی ${grant.name}`} className="btn-icon h-8 w-8 shrink-0 text-primary-200" onClick={()=>editGrantScope(grant)}><Pencil className="h-3.5 w-3.5"/></button><button title="لغو دسترسی" aria-label={`لغو دسترسی ${grant.name}`} className="btn-icon h-8 w-8 shrink-0 text-red-300" onClick={() => void revokeWorkspace.mutateAsync(grant.user_id)}><Trash2 className="h-3.5 w-3.5"/></button></div>)}</div></div>}
            </Card>
            {sharePickerOpen&&<SharingScopePicker folders={shareFolders} folderIds={shareFolderIds} setFolderIds={setShareFolderIds} fileIds={shareFileIds} setFileIds={setShareFileIds} fileSearch={shareFileSearch} setFileSearch={setShareFileSearch} files={shareFileResults?.files||[]} activeTab={sharePickerTab} setActiveTab={setSharePickerTab} selectingAll={selectingAllShareFiles} addAllFiles={addAllMatchingShareFiles} onClose={()=>setSharePickerOpen(false)}/>}
        </div>}

        {view === 'tts' && <TTSSettingsPanel/>}
        {view === 'markdown' && <MarkdownSettingsPanel/>}

        {view === 'appearance' && <div className="space-y-4"><Card id="appearance-color" icon={<Palette/>} title="رنگ کمد" subtitle="یکی از رنگ‌های آماده را انتخاب کن یا رنگ خودت را با نام دلخواه بساز."><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">{(Object.entries(colorThemes) as [ColorTheme, typeof colorThemes[ColorTheme]][]).map(([key,item]) => <button key={key} onClick={() => chooseTheme(key)} className={`flex min-h-12 items-center justify-between gap-2 rounded-2xl border px-3 transition ${theme===key?'border-primary-300/50 bg-primary-500/15 text-white shadow-lg shadow-primary-950/20':'border-white/[.07] bg-dark-800/60 text-dark-200 hover:border-white/15'}`}><span className="flex items-center gap-2"><span className="h-6 w-6 rounded-xl ring-2 ring-white/10" style={{backgroundColor:item.dot}}/>{item.label}</span>{theme===key&&<Check className="h-4 w-4 text-primary-200"/>}</button>)}</div></Card></div>}
        {view === 'appearance' && <Card id="appearance-display" icon={<FileStack/>} title="موارد قابل نمایش" subtitle="اطلاعاتی را که روی فایل‌ها و کشوها می‌بینی انتخاب کن."><CardDisplaySettings/></Card>}



        {view === 'files' && <div className="space-y-4"><Card id="files-root" icon={<Warehouse/>} title="فایل‌های بدون کشوی قبلی"><p className="mt-2 text-sm text-dark-400">مشخص کن محتوای کشوی پیش‌فرض در صفحه اصلی دیده شود یا داخل «فایل‌های من» بماند.</p><CustomSelect className="mt-3" value={localStorage.getItem('komod-root-files-mode') || 'folder'} onChange={value => { localStorage.setItem('komod-root-files-mode', value); window.dispatchEvent(new Event('komod-root-mode-changed')); }} options={[{value:'folder',label:'🗃️ نمایش داخل کشوی «فایل‌های من»'},{value:'files',label:'📦 نمایش مستقیم در صفحه اصلی'}]}/></Card></div>}

        {view === 'files' && <Card id="files-incoming" icon={<FolderPlus/>} title="محل فایل‌های تازه" subtitle="مقصد پیش‌فرض فایل‌ها و لینک‌هایی که از صفحهٔ اصلی اضافه می‌کنی."><CustomSelect className="mt-3" value={localStorage.getItem('komod-incoming-folder') || 'default'} onChange={value => { localStorage.setItem('komod-incoming-folder', String(value)); window.dispatchEvent(new Event('komod-incoming-folder-changed')); }} options={incomingFolderOptions}/></Card>}

        {view === 'files' && <Card id="files-links" icon={<Download/>} title="مقصد لینک‌ها" subtitle="برای یوتیوب و اینستاگرام کشوی پیش‌فرض جداگانه تعیین کن."><div className="mt-4 grid gap-3 sm:grid-cols-2"><CustomSelect label="لینک‌های یوتیوب" value={youtubeFolder} onChange={value=>{setYoutubeFolder(String(value));localStorage.setItem('komod-youtube-folder',String(value));}} options={[{value:'none',label:'هر بار انتخاب می‌کنم'},...incomingFolderOptions]}/><CustomSelect label="لینک‌های اینستاگرام" value={instagramFolder} onChange={value=>{setInstagramFolder(String(value));localStorage.setItem('komod-instagram-folder',String(value));}} options={[{value:'none',label:'هر بار انتخاب می‌کنم'},...incomingFolderOptions]}/></div></Card>}

        {view === 'files' && (!selectedSubsection || selectedSubsection === 'files-link-caption') && <LinkCaptionSettings/>}
        {view === 'files' && selectedSubsection === 'files-destinations' && <DeliverySettingsPanel section="destinations"/>}
        {view === 'files' && selectedSubsection === 'files-monitors' && <DeliverySettingsPanel section="monitors"/>}

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

        {view === 'admin-users' && user?.is_admin && <div className="space-y-4">
            {selectedSubsection==='admin-add'&&<Card id="admin-add" icon={<Plus/>} title="افزودن کاربر مجاز" subtitle="حذف دسترسی، فایل‌ها و اطلاعات قبلی کاربر را پاک نمی‌کند."><div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input dir="rtl" inputMode="numeric" value={newAdminTelegramId} onChange={event=>setNewAdminTelegramId(event.target.value.replace(/\D/g,''))} className="input text-right" placeholder="آیدی عددی تلگرام"/><input value={newAdminName} onChange={event=>setNewAdminName(event.target.value)} className="input" placeholder="نام دلخواه (اختیاری)"/><button disabled={addAdminUser.isPending||!newAdminTelegramId} onClick={()=>void addAuthorizedUser()} className="btn-primary min-h-11 px-5 disabled:opacity-40">افزودن</button></div></Card>}
            {adminUsersError && <div className="flex items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/[.07] p-4"><p className="min-w-0 flex-1 text-sm text-red-200">فهرست کاربران بارگذاری نشد. اتصال را بررسی کن و دوباره تلاش کن.</p><button className="btn-secondary shrink-0 px-3 py-2 text-xs" onClick={()=>void Promise.all([refetchAdminUsers(),refetchAdminStats()])}>تلاش دوباره</button></div>}
            {selectedSubsection?.startsWith('admin-users-')&&<Card id={selectedSubsection} icon={<UserRoundCog/>} title={selectedSubsection==='admin-users-pending'?'درخواست‌های منتظر تأیید':selectedSubsection==='admin-users-disabled'?'کاربران غیرفعال':'کاربران فعال'}>
                <label className="relative mt-4 block min-w-0"><Search className="pointer-events-none absolute right-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-dark-500"/><input value={adminQuery} onChange={event => setAdminQuery(event.target.value)} className="input w-full !pr-10" placeholder="جست‌وجو در همین بخش"/></label>
                <div className="admin-users-grid mt-4 grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-2">{visibleAdminUsers.map(item => <AdminRow key={item.id} item={item} onSave={(display_name) => updateAdmin.mutateAsync({id:item.id,display_name})} onQuota={(tts_daily_limit,tts_max_chars,stt_daily_limit,stt_max_seconds)=>updateAdmin.mutateAsync({id:item.id,tts_daily_limit,tts_max_chars,stt_daily_limit,stt_max_seconds})} onMonitorAccess={can_use_monitors=>updateAdmin.mutateAsync({id:item.id,can_use_monitors})} onToggle={() => item.is_active ? removeAdminUser.mutateAsync(item.id) : updateAdmin.mutateAsync({id:item.id,is_active:true})}/>)}</div>
                {adminUsersLoading && <div className="mt-4 grid gap-3 xl:grid-cols-2">{[0,1,2,3].map(item=><div key={item} className="h-48 animate-pulse rounded-2xl bg-dark-800/60"/>)}</div>}
                {!adminUsersLoading && !adminUsersError && !visibleAdminUsers.length && <p className="py-10 text-center text-sm text-dark-500">موردی در این بخش پیدا نشد.</p>}
            </Card>}
        </div>}

        {view === 'admin' && user?.is_admin && <div className="space-y-4">
            {selectedSubsection==='admin-captions'&&<DeliverySettingsPanel section="captions"/>}
            {selectedSubsection==='admin-summary'&&<section id="admin-summary" className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-300"><Gauge className="h-5 w-5"/></span><div><h2 className="font-bold">گزارش کلی</h2><p className="mt-1 text-xs text-dark-400">نمای سریع کاربران، فایل‌ها و مصرف ابزارهای هوش مصنوعی</p></div></div><div className="mt-4 grid gap-3 md:grid-cols-2"><div className="rounded-2xl bg-gradient-to-br from-primary-500/15 to-dark-800/60 p-4"><p className="text-xs text-dark-400">فضای کاربران</p><strong className="mt-2 block text-2xl text-primary-100">{adminStatsLoading?'…':formatFileSize(adminStats?.total_size||0)}</strong><div className="mt-4 grid grid-cols-2 gap-2"><AdminStat label="کاربر فعال" value={adminStatsLoading?'…':(adminStats?.active_users||0).toLocaleString('fa-IR')} icon={<Users/>}/><AdminStat label="کل فایل‌ها" value={adminStatsLoading?'…':(adminStats?.total_files||0).toLocaleString('fa-IR')} icon={<FileStack/>}/></div></div><div className="rounded-2xl border border-white/[.06] bg-dark-800/45 p-4"><p className="text-xs text-dark-400">مصرف متن و صدا</p><div className="mt-3 grid grid-cols-2 gap-2"><AdminStat label="TTS امروز" value={adminStatsLoading?'…':(adminStats?.tts_jobs_today||0).toLocaleString('fa-IR')} icon={<AudioLines/>}/><AdminStat label="STT امروز" value={adminStatsLoading?'…':(adminStats?.stt_jobs_today||0).toLocaleString('fa-IR')} icon={<FileText/>}/><AdminStat label="کل TTS" value={adminStatsLoading?'…':(adminStats?.tts_total_jobs||0).toLocaleString('fa-IR')} icon={<Gauge/>}/><AdminStat label="کل STT" value={adminStatsLoading?'…':(adminStats?.stt_total_jobs||0).toLocaleString('fa-IR')} icon={<FileStack/>}/></div></div></div></section>}
            {selectedSubsection==='admin-health'&&<section id="admin-health" className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5">
                <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-300"><Activity className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="font-bold">سلامت سرویس‌ها</h2><p className="mt-1 text-xs text-dark-400">وضعیت زندهٔ بخش‌های اصلی و صف‌های پردازش</p></div><button className="btn-icon" disabled={adminHealthFetching} onClick={()=>void refetchAdminHealth()} aria-label="تازه‌سازی وضعیت"><RefreshCw className={`h-4 w-4 ${adminHealthFetching?'animate-spin':''}`}/></button></div>
                {adminHealthError&&<div className="mt-4 rounded-xl border border-red-500/20 bg-red-500/[.07] p-3 text-sm text-red-200">گرفتن وضعیت سرویس‌ها انجام نشد.</div>}
                {adminHealthLoading?<div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="h-28 animate-pulse rounded-2xl bg-dark-800/60"/><div className="h-28 animate-pulse rounded-2xl bg-dark-800/60"/></div>:adminHealth&&<>
                    <div className={`mt-4 flex items-center gap-3 rounded-2xl border p-4 ${adminHealth.overall==='healthy'?'border-emerald-500/20 bg-emerald-500/[.07]':adminHealth.overall==='warning'?'border-amber-500/20 bg-amber-500/[.07]':'border-red-500/20 bg-red-500/[.07]'}`}>{adminHealth.overall==='healthy'?<CheckCircle2 className="h-5 w-5 text-emerald-300"/>:adminHealth.overall==='warning'?<AlertTriangle className="h-5 w-5 text-amber-300"/>:<XCircle className="h-5 w-5 text-red-300"/>}<div><strong className="text-sm">{adminHealth.overall==='healthy'?'همه‌چیز روبه‌راه است':adminHealth.overall==='warning'?'یک بخش نیاز به بررسی دارد':'یک سرویس در دسترس نیست'}</strong><p className="mt-1 text-xs text-dark-400">بررسی‌شده در {formatIranTime(adminHealth.checked_at)} به وقت ایران</p></div></div>
                    <div className="mt-3 grid gap-3 sm:grid-cols-2">{adminHealth.services.map(service=><ServiceHealthCard key={service.key} service={service}/>)}</div>
                    <div className="mt-4 rounded-2xl border border-white/[.06] bg-dark-800/40 p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-bold">کارهای گیرکرده</h3><p className="mt-1 text-xs text-dark-500">پردازش‌های بدون تغییر در ۱۵ دقیقه گذشته</p></div><span className="rounded-full bg-dark-700 px-2.5 py-1 text-xs">{adminHealth.stuck_jobs.length.toLocaleString('fa-IR')}</span></div>{adminHealth.stuck_jobs.length?<div className="mt-3 space-y-2">{adminHealth.stuck_jobs.map(job=><div key={job.id} className="flex items-center gap-3 rounded-xl bg-dark-950/45 p-3"><AlertTriangle className="h-4 w-4 shrink-0 text-amber-300"/><div className="min-w-0 flex-1"><strong className="block truncate text-xs">{job.title||'پردازش بدون عنوان'}</strong><small className="text-dark-500">{job.kind.toUpperCase()} · {job.state} · {job.progress.toLocaleString('fa-IR')}٪</small></div></div>)}</div>:<p className="mt-3 text-sm text-emerald-300">پردازش گیرکرده‌ای پیدا نشد.</p>}</div>
                    <div className="mt-4 rounded-2xl border border-white/[.06] bg-dark-800/40 p-4"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-bold">خطاهای قابل پیگیری</h3><p className="mt-1 text-xs text-dark-500">مسیر و پیام خطا برای بررسی دقیق‌تر نمایش داده می‌شود.</p></div><div className="flex shrink-0 items-center gap-1.5"><span className="rounded-full bg-dark-700 px-2.5 py-1 text-xs">{adminErrors.filter(item=>!item.resolved).length.toLocaleString('fa-IR')}</span>{adminErrors.length>0&&<button disabled={clearAdminErrors.isPending} onClick={()=>void clearAdminErrors.mutateAsync()} className="btn-icon h-8 w-8 text-red-300" title="پاک‌کردن همه خطاها"><Trash2 className="h-3.5 w-3.5"/></button>}</div></div>{adminErrors.length?<div className="mt-3 max-h-64 space-y-2 overflow-y-auto">{adminErrors.map(item=><div key={item.error_id} className={`flex items-center gap-3 rounded-xl p-3 ${item.resolved?'bg-dark-950/25 opacity-60':'bg-red-500/[.06]'}`}><code dir="ltr" className="shrink-0 rounded-lg bg-black/20 px-2 py-1 text-[10px] text-red-200">{item.error_id}</code><div className="min-w-0 flex-1"><strong dir="ltr" className="block truncate text-xs">{item.method} {item.path}</strong><small className="block truncate text-dark-500">{item.message}</small></div>{!item.resolved&&<button className="btn-icon h-8 w-8" title="بررسی شد" onClick={()=>resolveAdminError.mutate(item.error_id)}><Check className="h-4 w-4"/></button>}</div>)}</div>:<p className="mt-3 text-sm text-emerald-300">خطای ثبت‌شده‌ای وجود ندارد.</p>}</div>
                </>}
            </section>}
        </div>}
        {view === 'admin-messages' && user?.is_admin && <BotMessagesSettings/>}
        {view === 'admin-groups' && user?.is_admin && <AdminGroupsSettings/>}

        {confirmation && <div className="fixed inset-0 z-[180] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={() => setConfirmation(null)}><div className="w-full max-w-sm rounded-2xl border border-white/10 bg-dark-900 p-5" onClick={event=>event.stopPropagation()}><h2 className="text-lg font-bold">{confirmation==='all'?'خروج از همه دستگاه‌ها؟':'از این دستگاه خارج می‌شی؟'}</h2><p className="mt-2 text-sm text-dark-300">فایل‌ها و اطلاعات کمد حذف نمی‌شوند.</p><div className="mt-5 flex gap-2"><button className="flex-1 rounded-xl bg-red-500 px-4 py-2.5" onClick={() => confirmation==='all'?void logoutEverywhere():void logoutThisDevice()}>خروج</button><button className="btn-secondary flex-1" onClick={()=>setConfirmation(null)}>بی‌خیال</button></div></div></div>}
    </div></SettingsSectionContext.Provider>;
}

function viewTitle(view: SettingsView) { return ({ home:'تنظیمات', accounts:'حساب‌ها', security:'ورود و امنیت', sessions:'مدیریت نشست‌ها', access:'دسترسی و اشتراک‌گذاری', storage:'فضای ذخیره‌سازی', files:'فایل‌ها و مقصدها', appearance:'ظاهر برنامه', markdown:'مطالعه و Markdown', connection:'اتصال برنامه', admin:'گزارش و سلامت', 'admin-users':'مدیریت کاربران', 'admin-groups':'مدیریت گروه‌ها', 'admin-messages':'پیام‌های ربات', tags:'مدیریت تگ‌ها', transfers:'مرکز انتقال‌ها', tts:'متن و صدا' })[view]; }
function viewSubtitle(view: SettingsView) { return ({ home:'', accounts:'حساب‌های ذخیره‌شده روی این دستگاه.', security:'رمز و روش ورودت را تنظیم کن.', sessions:'ورودهای فعال حساب فعلی را مدیریت کن.', access:'مشخص کن چه کسی کمدت را ببیند یا داخلش فایل ذخیره کند.', storage:'فضای فایل‌ها و شیوه حذف را مدیریت کن.', files:'مقصد فایل‌های تازه و لینک‌ها را انتخاب کن.', appearance:'رنگ و حالت نمایش کمد را تنظیم کن.', markdown:'ظاهر و رفتار پیش‌فرض فایل‌های متنی را تنظیم کن.', connection:'آدرس اصلی و مسیرهای جایگزین HTTPS را مدیریت کن.', admin:'آمار، سرویس‌ها و خطاهای قابل پیگیری.', 'admin-users':'درخواست‌ها و دسترسی کاربران را در بخش‌های جدا مدیریت کن.', 'admin-groups':'تأیید، محدودیت و مصرف گروه‌ها.', 'admin-messages':'متن پاسخ‌های ربات را ویرایش کن.', tags:'تگ‌های دلخواه و نمایش آن‌ها را تنظیم کن.', transfers:'همه انتقال‌های فعال و اخیر را یکجا مدیریت کن.', tts:'ساخت صدا و استخراج متن.' })[view]; }
function securityEventLabel(type: string) { return ({ login_success:'ورود موفق به حساب', login_failed:'تلاش ناموفق برای ورود', credentials_updated:'تغییر اطلاعات ورود', two_factor_enabled:'فعال‌سازی تأیید دومرحله‌ای', two_factor_disabled:'غیرفعال‌سازی تأیید دومرحله‌ای', sessions_revoked_all:'خروج از همه نشست‌ها', sessions_revoked_others:'خروج از نشست‌های دیگر', session_revoked:'لغو یک نشست', public_link_created:'ساخت پیوند عمومی', public_link_revoked:'لغو پیوند عمومی', public_links_revoked:'لغو گروهی پیوندهای عمومی', public_link_unlocked:'باز شدن پیوند رمزدار', public_link_password_failed:'رمز اشتباه برای پیوند عمومی', public_view:'مشاهده پیوند عمومی', account_backup_restored:'بازیابی نسخه پشتیبان حساب', workspace_grant_updated:'تغییر دسترسی اشتراک‌گذاری', workspace_grant_revoked:'لغو دسترسی اشتراک‌گذاری', vault_password_updated:'تغییر رمز گاوصندوق', vault_unlocked:'باز شدن گاوصندوق', vault_unlock_failed:'رمز اشتباه گاوصندوق' } as Record<string,string>)[type] || 'رویداد امنیتی'; }
function permissionLabel(permission: 'owner' | Permission) { return permission === 'owner' ? 'کمد خودم' : permission === 'write' ? 'مشاهده و ذخیره' : 'فقط مشاهده'; }
function PermissionSelect({ value, onChange }:{ value:Permission; onChange:(value:Permission)=>void }) { return <CustomSelect value={value} onChange={onChange} options={[{value:'read',label:'👁️ فقط مشاهده'},{value:'write',label:'📥 مشاهده و ذخیره'}]}/>; }
function SharingScopePicker({folders,folderIds,setFolderIds,fileIds,setFileIds,fileSearch,setFileSearch,files,activeTab,setActiveTab,selectingAll,addAllFiles,onClose}:{folders:Array<{id:number;name:string;depth:number}>;folderIds:number[];setFolderIds:React.Dispatch<React.SetStateAction<number[]>>;fileIds:number[];setFileIds:React.Dispatch<React.SetStateAction<number[]>>;fileSearch:string;setFileSearch:(value:string)=>void;files:TelegramFile[];activeTab:'folders'|'files';setActiveTab:(tab:'folders'|'files')=>void;selectingAll:boolean;addAllFiles:()=>Promise<void>;onClose:()=>void}) {
    const toggleFolder=(id:number)=>setFolderIds(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id]);
    const toggleFile=(id:number)=>setFileIds(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id]);
    const allFoldersSelected=folders.length>0&&folderIds.length===folders.length;
    return <div className="fixed inset-0 z-[210] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
        <section dir="rtl" className="flex max-h-[92dvh] min-h-[72dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-dark-900 shadow-2xl sm:min-h-0 sm:rounded-3xl" onClick={event=>event.stopPropagation()}>
            <header className="flex items-center gap-3 border-b border-white/[.07] px-4 py-3.5 sm:px-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/12 text-primary-200"><FileStack className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h3 className="font-bold">انتخاب محدودهٔ دسترسی</h3><p className="mt-1 text-[11px] text-dark-400">فقط موارد انتخاب‌شده در دسترس این فرد قرار می‌گیرند.</p></div><button className="btn-icon h-9 w-9" onClick={onClose} aria-label="بستن"><XCircle className="h-4 w-4"/></button></header>
            <div className="grid grid-cols-2 gap-1 border-b border-white/[.06] bg-dark-950/35 p-2"><button onClick={()=>setActiveTab('folders')} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-xs font-semibold transition ${activeTab==='folders'?'bg-primary-500 text-white':'text-dark-400 hover:bg-white/[.05]'}`}><Warehouse className="h-4 w-4"/>کشوها<span className="rounded-md bg-black/15 px-1.5 py-0.5 text-[9px]">{folderIds.length.toLocaleString('fa-IR')}</span></button><button onClick={()=>setActiveTab('files')} className={`flex min-h-11 items-center justify-center gap-2 rounded-xl text-xs font-semibold transition ${activeTab==='files'?'bg-primary-500 text-white':'text-dark-400 hover:bg-white/[.05]'}`}><FileText className="h-4 w-4"/>فایل‌ها<span className="rounded-md bg-black/15 px-1.5 py-0.5 text-[9px]">{fileIds.length.toLocaleString('fa-IR')}</span></button></div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
                {activeTab==='folders'?<><div className="mb-2 flex items-center justify-between gap-3"><p className="text-xs text-dark-400">{folders.length.toLocaleString('fa-IR')} کشو</p><button className="rounded-lg px-2.5 py-1.5 text-xs text-primary-200 hover:bg-primary-500/10" onClick={()=>setFolderIds(allFoldersSelected?[]:folders.map(folder=>folder.id))}>{allFoldersSelected?'لغو انتخاب همه':'انتخاب همه'}</button></div><div className="space-y-1.5">{folders.map(folder=>{const checked=folderIds.includes(folder.id);return <button type="button" key={folder.id} onClick={()=>toggleFolder(folder.id)} className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-right transition ${checked?'border-primary-400/30 bg-primary-500/[.09]':'border-white/[.06] bg-dark-800/45 hover:border-white/15'}`} style={{paddingRight:`${.75+Math.min(folder.depth,5)*1.1}rem`}}><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${checked?'border-primary-400 bg-primary-500 text-white':'border-white/20 text-transparent'}`}><Check className="h-3 w-3"/></span><Warehouse className={`h-4 w-4 shrink-0 ${checked?'text-primary-300':'text-dark-500'}`}/><span className="min-w-0 flex-1 truncate text-sm">{folder.name}</span></button>})}{!folders.length&&<p className="py-12 text-center text-sm text-dark-500">کشویی برای انتخاب وجود ندارد.</p>}</div></>:<><label className="relative block"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-500"/><input value={fileSearch} onChange={event=>setFileSearch(event.target.value)} className="input w-full !pr-10" placeholder="نام فایل را جست‌وجو کن"/></label>{fileSearch.trim()?<><div className="my-2 flex items-center justify-between gap-3"><p className="text-xs text-dark-400">{files.length.toLocaleString('fa-IR')} نتیجه در این صفحه</p><button disabled={selectingAll} className="rounded-lg px-2.5 py-1.5 text-xs text-primary-200 hover:bg-primary-500/10 disabled:opacity-50" onClick={()=>void addAllFiles()}>{selectingAll?'در حال افزودن…':'افزودن همهٔ نتایج'}</button></div><div className="space-y-1.5">{files.map(file=>{const checked=fileIds.includes(file.id);return <button type="button" key={file.id} onClick={()=>toggleFile(file.id)} className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-3 text-right transition ${checked?'border-primary-400/30 bg-primary-500/[.09]':'border-white/[.06] bg-dark-800/45 hover:border-white/15'}`}><span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${checked?'border-primary-400 bg-primary-500 text-white':'border-white/20 text-transparent'}`}><Check className="h-3 w-3"/></span><FileText className={`h-4 w-4 shrink-0 ${checked?'text-primary-300':'text-dark-500'}`}/><span dir="auto" className="min-w-0 flex-1 truncate text-sm">{file.file_name}</span></button>})}{!files.length&&<p className="py-12 text-center text-sm text-dark-500">فایلی با این نام پیدا نشد.</p>}</div></>:<div className="flex min-h-56 flex-col items-center justify-center text-center"><Search className="h-8 w-8 text-dark-600"/><p className="mt-3 text-sm text-dark-400">برای پیدا کردن فایل، بخشی از نامش را بنویس.</p><p className="mt-1 text-xs text-dark-600">فایل‌های انتخاب‌شده با عوض‌کردن جست‌وجو باقی می‌مانند.</p></div>}</>}
            </div>
            <footer className="flex items-center gap-3 border-t border-white/[.07] bg-dark-950/45 p-3 sm:p-4"><div className="min-w-0 flex-1"><strong className="block text-xs">{(folderIds.length+fileIds.length).toLocaleString('fa-IR')} مورد انتخاب شده</strong><small className="text-[10px] text-dark-500">{folderIds.length.toLocaleString('fa-IR')} کشو · {fileIds.length.toLocaleString('fa-IR')} فایل</small></div><button className="btn-primary min-h-10 px-6 text-sm" onClick={onClose}>تأیید</button></footer>
        </section>
    </div>;
}
function SettingsLayoutPicker({value,onChange}:{value:SettingsHomeLayout;onChange:(value:SettingsHomeLayout)=>void}) {
    const options:Array<{value:SettingsHomeLayout;label:string;icon:React.ReactElement}>=[
        {value:'cards',label:'کارت‌ها',icon:<LayoutGrid/>},
        {value:'list',label:'فهرست',icon:<List/>},
        {value:'compact',label:'فشرده',icon:<Grid2X2/>},
    ];
    return <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-white/[.08] bg-dark-950/55 p-0.5" role="radiogroup" aria-label="نوع نمایش تنظیمات">{options.map(option=><button key={option.value} type="button" role="radio" aria-checked={value===option.value} title={`نمای ${option.label}`} aria-label={`نمای ${option.label}`} onClick={()=>onChange(option.value)} className={`flex h-9 w-9 items-center justify-center rounded-lg transition ${value===option.value?'bg-primary-500 text-white shadow-md shadow-primary-950/30':'text-dark-400 hover:bg-white/[.05] hover:text-white'}`}><span className="[&>svg]:h-4 [&>svg]:w-4">{option.icon}</span></button>)}</div>;
}
const SETTINGS_GROUPS_MODE_KEY='komod-settings-groups-mode';
const SETTINGS_GROUPS_EVENT='komod-settings-groups-toggle';
function setAllSettingsGroups(open:boolean){localStorage.setItem(SETTINGS_GROUPS_MODE_KEY,open?'open':'closed');window.dispatchEvent(new CustomEvent(SETTINGS_GROUPS_EVENT,{detail:{open}}));}
function SettingsGroup({title,text,icon,layout,children}:{title:string;text:string;icon:React.ReactElement;layout:SettingsHomeLayout;children:React.ReactNode}) {
    const storageKey=`komod-settings-group:${title}`;
    const [open,setOpen]=useState(()=>{const own=localStorage.getItem(storageKey);if(own!==null)return own==='1';return localStorage.getItem(SETTINGS_GROUPS_MODE_KEY)==='open'});
    useEffect(()=>{const listener=(event:Event)=>{const next=Boolean((event as CustomEvent<{open:boolean}>).detail?.open);localStorage.setItem(storageKey,next?'1':'0');setOpen(next)};window.addEventListener(SETTINGS_GROUPS_EVENT,listener);return()=>window.removeEventListener(SETTINGS_GROUPS_EVENT,listener)},[storageKey]);
    const toggle=()=>setOpen(value=>{const next=!value;localStorage.setItem(storageKey,next?'1':'0');return next});
    const contentClass=layout==='list'?'grid grid-cols-1 gap-2':layout==='compact'?'grid grid-cols-2 auto-rows-fr gap-2 sm:grid-cols-3 lg:grid-cols-4':'grid auto-rows-fr gap-3 sm:grid-cols-2 lg:grid-cols-3';
    return <section className="min-w-0 overflow-hidden rounded-3xl border border-white/[.06] bg-dark-950/25 p-3 sm:p-4"><button type="button" className={`flex w-full min-w-0 items-center gap-3 rounded-2xl px-1 text-right transition ${open?'mb-3':'hover:bg-white/[.025]'}`} aria-expanded={open} onClick={toggle}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-300 [&>svg]:h-4.5 [&>svg]:w-4.5">{icon}</span><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-bold text-dark-100">{title}</h2>{open&&<p className="mt-0.5 truncate text-[11px] text-dark-500">{text}</p>}</div><ChevronDown className={`h-4 w-4 shrink-0 text-dark-500 transition-transform duration-200 ${open?'rotate-180 text-primary-300':''}`}/></button>{open&&<div className={contentClass}>{children}</div>}</section>;
}
function SettingsButton({icon,title,text,onClick,layout='cards'}:{icon:React.ReactElement;title:string;text:string;onClick:()=>void;layout?:SettingsHomeLayout}) {
    const compact=layout==='compact';
    return <button onClick={onClick} title={compact?`${title}؛ ${text}`:undefined} className={`group flex h-full w-full min-w-0 overflow-hidden rounded-2xl border border-white/[.07] bg-dark-900/70 text-right transition hover:-translate-y-0.5 hover:border-primary-400/25 hover:bg-primary-500/[.06] hover:shadow-lg hover:shadow-black/10 ${compact?'min-h-28 flex-col items-center justify-center gap-2 p-3 text-center':layout==='list'?'min-h-16 items-center gap-3 p-3':'min-h-24 items-center gap-3 p-4'}`}><span className={`flex shrink-0 items-center justify-center bg-primary-500/10 text-primary-300 transition group-hover:bg-primary-500/15 group-hover:text-primary-200 [&>svg]:h-5 [&>svg]:w-5 ${compact?'h-12 w-12 rounded-2xl':'h-11 w-11 rounded-2xl'}`}>{icon}</span><span className={`${compact?'w-full text-center':'min-w-0 flex-1'}`}><strong className={`block text-sm ${compact?'mx-auto line-clamp-2 text-center':''}`}>{title}</strong>{!compact&&<small className={`mt-1 block min-w-0 text-dark-400 ${layout==='list'?'truncate':'line-clamp-2 leading-5'}`}>{text}</small>}</span>{!compact&&<ArrowRight className="h-4 w-4 shrink-0 rotate-180 text-dark-600 transition group-hover:translate-x-[-2px] group-hover:text-primary-300"/>}</button>;
}
function SummaryCard({icon,title,text}:{icon:React.ReactElement;title:string;text:string}) { return <div className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/[.07] bg-dark-950/30 p-3.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-300 [&>svg]:h-4.5 [&>svg]:w-4.5">{icon}</span><span className="min-w-0"><strong className="block truncate text-sm">{title}</strong><small className="text-dark-500">{text}</small></span></div>; }
function Card({id,icon,title,subtitle,children}:{id?:string;icon:React.ReactElement;title:string;subtitle?:string;children:React.ReactNode}) { const active=useContext(SettingsSectionContext); if(id&&active&&id!==active&&!id.startsWith(`${active}-`))return null; return <section id={id} className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-5"><div className="flex items-center gap-3"><span className="text-primary-300 [&>svg]:h-5 [&>svg]:w-5">{icon}</span><div><h2 className="font-bold">{title}</h2>{subtitle&&<p className="mt-1 text-xs text-dark-400">{subtitle}</p>}</div></div>{title==='رنگ کمد'&&<ThemeColorControl/>}{children}</section>; }

function settingsSectionLinks(view:SettingsView,canUseMonitors=false):Array<{id:string;label:string}>{
    const sections:Partial<Record<SettingsView,Array<{id:string;label:string}>>>={
        accounts:[{id:'accounts-overview',label:'حساب‌ها'},{id:'accounts-backup',label:'پشتیبان'}],
        sessions:[{id:'sessions-active',label:'نشست‌ها'},{id:'sessions-events',label:'رویدادهای امنیتی'},{id:'sessions-shares',label:'پیوندهای عمومی'}],
        security:[{id:'security-login',label:'ورود'},{id:'security-2fa',label:'تأیید دومرحله‌ای'},{id:'security-vault',label:'گاوصندوق'}],
        access:[{id:'access-workspaces',label:'کمدهای در دسترس'},{id:'access-sharing',label:'اشتراک‌گذاری'}],
        files:[{id:'files-root',label:'نمایش فایل‌ها'},{id:'files-incoming',label:'فایل‌های تازه'},{id:'files-links',label:'مقصد لینک‌ها'},{id:'files-link-caption',label:'توضیحات لینک'},{id:'files-destinations',label:'مقصدهای ارسال'},...(canUseMonitors?[{id:'files-monitors',label:'پایش منابع'}]:[])],
        storage:[{id:'storage-overview',label:'نمای کلی'},{id:'storage-channel',label:'فضای شخصی'},{id:'storage-delete',label:'حذف فایل'}],
        appearance:[{id:'appearance-color',label:'رنگ کمد'},{id:'appearance-display',label:'موارد قابل نمایش'}],
        tags:[{id:'tags-library',label:'تگ‌های من'},{id:'tags-display',label:'نمایش تگ‌ها'}],
        admin:[{id:'admin-summary',label:'گزارش کلی'},{id:'admin-health',label:'سلامت سرویس‌ها'},{id:'admin-captions',label:'متن عمومی خروجی‌ها'}],
        'admin-users':[{id:'admin-users-pending',label:'درخواست‌ها'},{id:'admin-users-active',label:'فعال‌ها'},{id:'admin-users-disabled',label:'غیرفعال‌ها'},{id:'admin-add',label:'افزودن کاربر'}],
    };
    return sections[view]||[];
}
function PublicSharesPanel(){
    const {data:shares=[],isLoading,isError}=usePublicShares();
    const revoke=useRevokePublicShares();
    const addToast=useAppStore(state=>state.addToast);
    const [selected,setSelected]=useState<number[]>([]);
    const [confirmIds,setConfirmIds]=useState<number[]|null>(null);
    useEffect(()=>setSelected(current=>current.filter(id=>shares.some(item=>item.file_id===id))),[shares]);
    const allSelected=shares.length>0&&shares.every(item=>selected.includes(item.file_id));
    const toggle=(id:number)=>setSelected(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id]);
    const link=(item:PublicShareItem)=>`${window.location.origin}/s/${item.public_hash}`;
    const copy=async(item:PublicShareItem)=>{try{await navigator.clipboard.writeText(link(item));addToast('پیوند کپی شد.','success')}catch{addToast('کپی پیوند انجام نشد.','error')}};
    const applyRevoke=async()=>{if(!confirmIds?.length)return;try{const result=await revoke.mutateAsync(confirmIds);if(!result.revoked)throw new Error('این پیوند قبلاً لغو شده یا متعلق به کمد دیگری است.');setSelected(current=>current.filter(id=>!result.file_ids.includes(id)));setConfirmIds(null);addToast(`${result.revoked.toLocaleString('fa-IR')} پیوند لغو شد.`,'success')}catch(error:any){addToast(error?.response?.data?.detail||error?.message||'لغو پیوندها انجام نشد.','error')}};
    const typeIcon:Record<string,string>={audio:'🎵',video:'🎬',image:'🖼️',text:'📝',document:'📄'};
    return <Card id="sessions-shares" icon={<Globe2/>} title="پیوندهای عمومی" subtitle="پیوندهای فعال، میزان استفاده و دسترسی هر فایل را یکجا مدیریت کن.">
        <div className="mt-4 flex flex-wrap items-center gap-2">
            <button disabled={!shares.length} onClick={()=>setSelected(allSelected?[]:shares.map(item=>item.file_id))} className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs font-semibold transition disabled:opacity-40 ${allSelected?'border-primary-400/35 bg-primary-500 text-white':'border-primary-400/20 bg-primary-500/10 text-primary-100 hover:bg-primary-500/15'}`}><Check className="h-4 w-4"/>{allSelected?'برداشتن انتخاب':'انتخاب همه'}</button>
            {selected.length>0&&<button onClick={()=>setConfirmIds(selected)} className="flex min-h-10 items-center gap-2 rounded-xl bg-red-500/10 px-3 text-xs font-semibold text-red-300"><Trash2 className="h-4 w-4"/>لغو {selected.length.toLocaleString('fa-IR')} پیوند</button>}
            <span className="mr-auto rounded-xl bg-white/[.05] px-3 py-2 text-[11px] text-dark-400">{shares.length.toLocaleString('fa-IR')} پیوند</span>
        </div>
        <div className="mt-3 space-y-2">
            {isLoading&&<p className="py-10 text-center text-sm text-dark-500">در حال دریافت پیوندها…</p>}
            {isError&&<p className="rounded-xl bg-red-500/10 px-3 py-3 text-sm text-red-300">دریافت پیوندهای عمومی انجام نشد.</p>}
            {!isLoading&&!isError&&!shares.length&&<div className="rounded-2xl border border-dashed border-white/10 py-10 text-center"><Globe2 className="mx-auto h-8 w-8 text-dark-600"/><p className="mt-3 text-sm text-dark-400">فعلاً پیوند عمومی فعالی نداری.</p></div>}
            {shares.map(item=>{const exhausted=Boolean(item.view_limit&&item.view_count>=item.view_limit);return <div key={item.file_id} className={`rounded-2xl border p-3 transition ${selected.includes(item.file_id)?'border-primary-400/35 bg-primary-500/[.08]':'border-white/[.06] bg-dark-800/45'}`}>
                <div className="flex flex-wrap items-center gap-3">
                    <button onClick={()=>toggle(item.file_id)} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition ${selected.includes(item.file_id)?'border-primary-400 bg-primary-500 text-white':'border-white/15 text-transparent hover:border-primary-400/50'}`} aria-label={`انتخاب ${item.file_name}`}><Check className="h-4 w-4"/></button>
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[.05] text-lg">{typeIcon[item.file_type]||'📦'}</span>
                    <div className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm">{item.file_name}</strong><p className="mt-1 text-[10px] text-dark-500">{formatFileSize(item.file_size)} · {item.view_count.toLocaleString('fa-IR')}{item.view_limit?` از ${item.view_limit.toLocaleString('fa-IR')}`:''} مشاهده</p></div>
                    <div className="mr-auto flex shrink-0 items-center gap-1 max-sm:w-full max-sm:justify-end max-sm:border-t max-sm:border-white/[.05] max-sm:pt-2"><button onClick={()=>void copy(item)} className="btn-icon h-9 w-9 text-primary-200" title="کپی پیوند"><Copy className="h-4 w-4"/></button><a href={link(item)} target="_blank" rel="noopener noreferrer" className="btn-icon h-9 w-9 text-primary-200" title="بازکردن پیوند"><ExternalLink className="h-4 w-4"/></a><button onClick={()=>setConfirmIds([item.file_id])} className="btn-icon h-9 w-9 text-red-300" title="لغو پیوند"><Trash2 className="h-4 w-4"/></button></div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] sm:pr-11">
                    <span className={`rounded-lg px-2 py-1 ${item.expired||exhausted?'bg-red-500/10 text-red-300':'bg-emerald-500/10 text-emerald-300'}`}>{item.expired?'منقضی‌شده':exhausted?'سقف مشاهده پر شده':'فعال'}</span>
                    <span className="rounded-lg bg-white/[.05] px-2 py-1 text-dark-400">{item.password_protected?'🔒 رمزدار':'بدون رمز'}</span>
                    <span className="rounded-lg bg-white/[.05] px-2 py-1 text-dark-400">{item.allow_download?'دانلود مجاز':'فقط مشاهده'}</span>
                    {item.expires_at&&<span className="rounded-lg bg-white/[.05] px-2 py-1 text-dark-400">انقضا: {formatPersianDate(item.expires_at)}</span>}
                </div>
            </div>})}
        </div>
        {confirmIds&&<div className="mt-4 rounded-2xl border border-red-400/20 bg-red-500/[.07] p-3"><p className="text-sm text-red-100">پیوند {confirmIds.length.toLocaleString('fa-IR')} فایل فوراً از دسترس خارج شود؟ خود فایل‌ها حذف نمی‌شوند.</p><div className="mt-3 grid grid-cols-2 gap-2"><button disabled={revoke.isPending} onClick={()=>setConfirmIds(null)} className="btn-secondary min-h-10">انصراف</button><button disabled={revoke.isPending} onClick={()=>void applyRevoke()} className="min-h-10 rounded-xl bg-red-500 px-3 text-sm font-semibold text-white disabled:opacity-50">{revoke.isPending?'در حال لغو…':'لغو پیوند'}</button></div></div>}
    </Card>;
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
    const [editingColor,setEditingColor]=useState<string|null>(null);
    const [colorMenu,setColorMenu]=useState<string|null>(null);
    const [saved,setSaved]=useState<SavedColor[]>(()=>{try{return (JSON.parse(localStorage.getItem('komod-saved-colors')||'[]') as Array<string|SavedColor>).map((item,index)=>typeof item==='string'?{color:item,name:`رنگ ${index+1}`}:item)}catch{return[]}});
    const [hsl,setHsl]=useState(()=>hexToHsl(localStorage.getItem('komod-custom-color')||'#A855F7'));
    const normalized=()=>{const color=value.trim().startsWith('#')?value.trim():`#${value.trim()}`;return /^#[0-9a-f]{6}$/i.test(color)?color.toUpperCase():null};
    const applyColor=(color:string)=>{setValue(color);setHsl(hexToHsl(color));localStorage.setItem('komod-custom-color',color);localStorage.setItem('komod-color-theme','custom');applyCustomTheme(color)};
    const apply=()=>{const color=normalized();if(!color)return;applyColor(color)};
    const changeHsl=(part:0|1|2,next:number)=>{const updated:[number,number,number]=[...hsl] as [number,number,number];updated[part]=next;setHsl(updated);applyColor(hslToHex(...updated))};
    const save=()=>{const color=normalized();if(!color)return;apply();const next=[{color,name:name.trim()||`رنگ ${saved.length+1}`},...saved.filter(item=>item.color.toLowerCase()!==color.toLowerCase()&&item.color.toLowerCase()!==editingColor?.toLowerCase())].slice(0,12);setSaved(next);localStorage.setItem('komod-saved-colors',JSON.stringify(next));setName('');setEditingColor(null)};
    const startFresh=()=>{setEditingColor(null);setName('');setColorMenu(null);setOpen(true)};
    const edit=(item:SavedColor)=>{setEditingColor(item.color);setValue(item.color);setHsl(hexToHsl(item.color));setName(item.name);setColorMenu(null);setOpen(true)};
    const remove=(color:string)=>{const next=saved.filter(item=>item.color!==color);setSaved(next);localStorage.setItem('komod-saved-colors',JSON.stringify(next));setColorMenu(null);if(editingColor===color)startFresh()};
    return <div className="mt-4 space-y-3">
        {saved.length>0&&<div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{saved.map(item=><div key={`${item.color}-${item.name}`} className="relative flex min-w-0 items-center gap-2 rounded-xl border border-white/[.07] bg-white/[.04] p-2"><button className="h-8 w-8 shrink-0 rounded-lg border border-white/15" style={{backgroundColor:item.color}} onClick={()=>applyColor(item.color)} aria-label={`انتخاب ${item.name}`}/><button type="button" onClick={()=>applyColor(item.color)} className="min-w-0 flex-1 truncate text-right text-xs" title={item.name}>{item.name}</button><button className="btn-icon h-7 w-7 shrink-0" onClick={()=>setColorMenu(current=>current===item.color?null:item.color)} aria-label="گزینه‌های رنگ"><MoreVertical className="h-3.5 w-3.5"/></button>{colorMenu===item.color&&<div className="absolute left-2 top-10 z-30 w-32 rounded-xl border border-white/10 bg-dark-950 p-1 shadow-2xl"><button className="context-menu-item w-full text-xs" onClick={()=>edit(item)}><Pencil className="h-3.5 w-3.5"/>ویرایش</button><button className="context-menu-item w-full text-xs text-red-300" onClick={()=>remove(item.color)}><Trash2 className="h-3.5 w-3.5"/>حذف</button></div>}</div>)}</div>}
        <button type="button" onClick={()=>{if(open)setOpen(false);else startFresh()}} className={`flex min-h-11 w-full items-center justify-between rounded-xl border px-3 text-sm transition ${open?'border-primary-400/30 bg-primary-500/10 text-primary-100':'border-white/[.08] bg-dark-800/60 text-dark-300'}`}><span className="flex items-center gap-2"><Palette className="h-4 w-4"/>{editingColor?'ویرایش رنگ':'رنگ سفارشی تازه'}</span><ChevronLeft className={`h-4 w-4 transition ${open?'-rotate-90':''}`}/></button>
        {open&&<div className="rounded-2xl border border-primary-400/20 bg-primary-500/[.05] p-3"><div className="mb-3 flex items-center justify-between"><strong className="text-xs">{editingColor?'ویرایش رنگ ذخیره‌شده':'ساخت رنگ تازه'}</strong>{editingColor&&<button type="button" className="text-xs text-dark-400 hover:text-white" onClick={()=>{setEditingColor(null);setName('')}}>لغو ویرایش</button>}</div><div className="grid gap-3 md:grid-cols-[7rem_1fr]"><div className="flex min-h-28 items-center justify-center rounded-2xl border border-white/10 shadow-inner" style={{backgroundColor:/^#[0-9a-f]{6}$/i.test(value)?value:'#A855F7'}}><Palette className="h-8 w-8 text-white drop-shadow-lg"/></div><div className="space-y-2"><ColorRange label="فام" value={hsl[0]} max={360} onChange={next=>changeHsl(0,next)} gradient="linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)"/><ColorRange label="اشباع" value={hsl[1]} max={100} onChange={next=>changeHsl(1,next)} gradient={`linear-gradient(90deg,hsl(${hsl[0]} 0% ${hsl[2]}%),hsl(${hsl[0]} 100% ${hsl[2]}%))`}/><ColorRange label="روشنایی" value={hsl[2]} max={100} onChange={next=>changeHsl(2,next)} gradient={`linear-gradient(90deg,#000,hsl(${hsl[0]} ${hsl[1]}% 50%),#fff)`}/></div></div><div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto]"><input dir="ltr" value={value} onChange={event=>setValue(event.target.value.toUpperCase())} onBlur={apply} onKeyDown={event=>{if(event.key==='Enter')apply()}} className="input min-w-0 text-left font-mono uppercase" maxLength={7} placeholder="کد هگز؛ مثل #A855F7" aria-label="کد هگز رنگ"/><input value={name} onChange={event=>setName(event.target.value)} className="input min-w-0" placeholder="نام رنگ؛ مثلاً بنفش شب"/><button onClick={save} className="btn-primary min-h-11 px-4">ذخیره رنگ</button></div></div>}
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
function AdminRow({item,onSave,onQuota,onMonitorAccess,onToggle}:{item:AdminUser;onSave:(name:string|null)=>Promise<unknown>;onQuota:(daily:number,maxChars:number,sttDaily:number,sttMaxSeconds:number)=>Promise<unknown>;onMonitorAccess:(enabled:boolean)=>Promise<unknown>;onToggle:()=>Promise<unknown>}) {
    const standalone=item.telegram_id<0;
    const telegramName = standalone?(item.login_username||'حساب مستقل'):[item.first_name,item.last_name].filter(Boolean).join(' ') || item.username || `کاربر ${item.telegram_id}`;
    const initial = item.display_name || telegramName;
    const savedAlias = item.display_name || '';
    const [name,setName]=useState(item.display_name || ''); const [saving,setSaving]=useState(false);
    useEffect(()=>setName(item.display_name||''),[item.display_name]);
    const [daily,setDaily]=useState(item.tts_daily_limit||0); const [maxChars,setMaxChars]=useState(item.tts_max_chars||200000); const [sttDaily,setSttDaily]=useState(item.stt_daily_limit||0); const [sttMaxSeconds,setSttMaxSeconds]=useState(item.stt_max_seconds||0); const [quotaSaving,setQuotaSaving]=useState(false); const [monitorSaving,setMonitorSaving]=useState(false); const [detailsOpen,setDetailsOpen]=useState(false);
    const save = async () => { const next=name.trim()||null;if(next===(item.display_name||null))return;setSaving(true);try{await onSave(next)}finally{setSaving(false)} };
    return <article className={`rounded-2xl border p-4 ${standalone&&!item.is_active?'border-amber-400/25 bg-amber-500/[.045]':'border-white/[.07] bg-dark-800/45'}`}><div className="flex items-start gap-3"><span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-500/12 text-lg font-black text-primary-200">{initial[0]}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><strong dir="auto" className="min-w-0 truncate text-sm">{initial}</strong><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${item.is_active?'bg-emerald-500/10 text-emerald-300':standalone?'bg-amber-500/10 text-amber-300':'bg-red-500/10 text-red-300'}`}>{item.is_active?'فعال':standalone?'منتظر تأیید':'غیرفعال'}</span>{standalone&&<span className="shrink-0 rounded-full bg-sky-500/10 px-2 py-0.5 text-[10px] text-sky-300">بدون تلگرام</span>}</div>{item.display_name&&<p dir="auto" className="mt-1 truncate text-xs text-dark-400">{telegramName}</p>}<p dir={standalone?'auto':'ltr'} className="mt-1 truncate text-xs text-dark-500">{standalone?`نام کاربری: ${item.login_username}`:`${item.username?`@${item.username} · `:''}ID: ${item.telegram_id}`}</p></div></div>{standalone&&!item.is_active&&<button type="button" onClick={()=>void onToggle()} className="mt-3 min-h-10 w-full rounded-xl bg-emerald-500/15 text-xs font-semibold text-emerald-200 transition hover:bg-emerald-500/25">تأیید و فعال‌کردن حساب</button>}<button type="button" onClick={()=>setDetailsOpen(value=>!value)} className="btn-secondary mt-3 min-h-10 w-full text-xs">{detailsOpen?'بستن جزئیات':'جزئیات و محدودیت‌ها'}</button>{detailsOpen&&<><div className="mt-3 grid grid-cols-2 gap-1.5 text-center sm:grid-cols-5"><span className="rounded-xl bg-white/[.035] p-2"><strong className="block text-xs">{item.file_count.toLocaleString('fa-IR')}</strong><small className="text-[10px] text-dark-500">فایل</small></span><span className="rounded-xl bg-white/[.035] p-2"><strong className="block truncate text-xs">{formatFileSize(item.total_size)}</strong><small className="text-[10px] text-dark-500">فضای مصرفی</small></span><span className="rounded-xl bg-white/[.035] p-2"><strong className="block text-xs">{item.tts_used_today.toLocaleString('fa-IR')} / {item.tts_daily_limit?item.tts_daily_limit.toLocaleString('fa-IR'):'∞'}</strong><small className="text-[10px] text-dark-500">TTS امروز</small></span><span className="rounded-xl bg-white/[.035] p-2"><strong className="block truncate text-xs">{item.tts_total_jobs.toLocaleString('fa-IR')}</strong><small className="text-[10px] text-dark-500">کل TTS</small></span><span className="rounded-xl bg-white/[.035] p-2"><strong className="block truncate text-xs">{item.stt_used_today.toLocaleString('fa-IR')} / {item.stt_daily_limit?item.stt_daily_limit.toLocaleString('fa-IR'):'∞'}</strong><small className="text-[10px] text-dark-500">STT امروز</small></span></div><div className="mt-3 grid grid-cols-2 gap-2"><label className="flex flex-col text-[10px] text-dark-500"><span className="min-h-8">سقف روزانه TTS</span><input type="number" min="0" max="10000" value={daily} onChange={event=>setDaily(Number(event.target.value))} className="input mt-1 w-full"/></label><label className="flex flex-col text-[10px] text-dark-500"><span className="min-h-8">حداکثر نویسه هر متن</span><input type="number" min="100" max="200000" value={maxChars} onChange={event=>setMaxChars(Number(event.target.value))} className="input mt-1 w-full"/></label><label className="flex flex-col text-[10px] text-dark-500"><span className="min-h-8">سقف روزانه STT</span><input type="number" min="0" max="10000" value={sttDaily} onChange={event=>setSttDaily(Number(event.target.value))} className="input mt-1 w-full"/></label><label className="flex flex-col text-[10px] text-dark-500"><span className="min-h-8">حداکثر مدت STT به ثانیه</span><input type="number" min="0" max="604800" value={sttMaxSeconds} onChange={event=>setSttMaxSeconds(Number(event.target.value))} className="input mt-1 w-full"/></label></div><button disabled={quotaSaving} onClick={async()=>{setQuotaSaving(true);try{await onQuota(daily,maxChars,sttDaily,sttMaxSeconds)}finally{setQuotaSaving(false)}}} className="btn-secondary mt-2 min-h-9 w-full text-xs disabled:opacity-40">{quotaSaving?'در حال ذخیره…':'ذخیره محدودیت‌های متن و صدا'}</button><button disabled={monitorSaving||item.is_admin} onClick={async()=>{if(item.is_admin)return;setMonitorSaving(true);try{await onMonitorAccess(!item.can_use_monitors)}finally{setMonitorSaving(false)}}} className={`mt-2 min-h-10 w-full rounded-xl border text-xs font-semibold transition disabled:cursor-default disabled:opacity-70 ${item.can_use_monitors?'border-emerald-400/25 bg-emerald-500/10 text-emerald-200':'border-white/[.08] bg-white/[.025] text-dark-400'}`}>{item.is_admin?'مدیر؛ دسترسی پایش همیشه فعال است':monitorSaving?'در حال ذخیره…':item.can_use_monitors?'دسترسی پایش منابع: فعال':'فعال‌کردن دسترسی پایش منابع'}</button><div className="mt-3 flex gap-2"><input value={name} onChange={event=>setName(event.target.value)} className="input min-w-0 flex-1" aria-label="نام نمایشی کاربر"/><button disabled={saving || name.trim()===savedAlias} className="btn-secondary px-3 text-xs disabled:opacity-40" onClick={()=>void save()}>{saving?'…':'ذخیره نام'}</button>{item.display_name&&<button className="btn-icon shrink-0 text-primary-200" title={standalone?'استفاده از نام کاربری':'استفاده از نام تلگرام'} onClick={()=>void onSave(null)}><RefreshCw className="h-4 w-4"/></button>}</div><button className={`mt-2 min-h-10 w-full rounded-xl text-xs font-semibold ${item.is_active?'bg-red-500/10 text-red-300 hover:bg-red-500/15':'bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/15'}`} onClick={()=>void onToggle()}>{item.is_active?'غیرفعال کردن کاربر':'فعال کردن کاربر'}</button></>}</article>;
}
