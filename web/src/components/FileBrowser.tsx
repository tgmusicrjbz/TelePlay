/**
 * Main FileBrowser component - the core of the web interface
 */
import { lazy, Suspense, useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FolderPlus, Folder as FolderIcon, Grid, LayoutGrid, List, Search, ChevronRight, ChevronDown, Home, Clipboard, ArrowUp, Film, Music, Image as ImageIcon, FileText, StickyNote, FolderInput, Trash2, Pencil, X, SlidersHorizontal, Boxes, ArrowDown, ArrowDownUp, ChevronUp, Plus, CheckSquare, Square, ListChecks, ListPlus, Upload, Star, RefreshCw, Link2, DownloadCloud, Download, Send, Eye, EyeOff, Minus, Play, Tags, Cloud, CloudOff, AudioLines, FileAudio, Sparkles, BookmarkPlus, Combine } from 'lucide-react';
import { api, useFiles, useFolders, useFolderTree, useUpdateFile, useUpdateFolder, useDeleteFolder, useDeleteFiles, useMoveFiles, TelegramFile, Folder, Pack, useActivityFeed, useDeleteFolders, useMoveFolders, canPreviewText, SortCriterion, SortField, serializeSort, useBatchUpdateFiles, BatchFileEdit, useUploadFile, useImportLink, useTagSettings, useUnlockVault, useWorkspaces, sendFilesToTelegram, useTTSJobs, useSTTJobs, SavedFilter, useSavedFilters, useUpdateSavedFilters, usePacks, useExpandSmartSearch, formatFileSize, LibraryChangeDetail } from '../lib/api';
import { useAppStore } from '../lib/store';
import { cacheAllTextNotes, queueOfflineText, saveFileOffline } from '../lib/offline';
import FileCard from './FileCard';
import FolderCard from './FolderCard';
import NewFolderModal from './NewFolderModal';
import MoveFileModal from './MoveFileModal';
import DeleteConfirmModal from './DeleteConfirmModal';
import RenameModal from './RenameModal';
import DescriptionModal from './DescriptionModal';
import BatchEditModal from './BatchEditModal';
import Sidebar from './Sidebar';
import Toasts from './Toasts';
import CustomSelect from './CustomSelect';
import { applyTheme, getStoredTheme } from '../lib/theme';
import { publishLocalTransfer } from '../lib/transfers';
import { folderTreeLabel } from '../lib/folderTreeLabel';
import PackCard from './PackCard';

// Heavy sections are downloaded only when the user opens them. Vite still
// precaches the resulting chunks in the service worker, so they remain
// available after the first successful online load.
const SettingsPage = lazy(() => import('./SettingsPage'));
const PlaylistBrowser = lazy(() => import('./PlaylistBrowser'));
const DownloadsPage = lazy(() => import('./DownloadsPage'));
const CreatePackModal = lazy(() => import('./PackModal').then(module => ({ default: module.CreatePackModal })));
const PackViewer = lazy(() => import('./PackModal').then(module => ({ default: module.PackViewer })));

function SectionFallback() {
    return <div className="mx-auto mt-6 h-52 w-full max-w-5xl animate-pulse rounded-3xl bg-dark-800/70" aria-label="در حال باز کردن بخش"/>;
}

const sortLabels: Record<SortField, string> = {
    name: 'نام', type: 'نوع', size: 'حجم', duration: 'مدت',
    created: 'تاریخ آپلود', updated: 'تاریخ ویرایش', count: 'تعداد فایل‌های کشو',
};

const extractImportUrls = (value: string) => {
    const starts = Array.from(value.matchAll(/https?:\/\//gi), match => match.index ?? -1).filter(index => index >= 0);
    return starts.map((start, index) => value.slice(start, starts[index + 1] ?? value.length)
        .split(/[\s<>()[\]{}"']/, 1)[0]
        .replace(/[،,.;!?]+$/g, ''))
        .filter(Boolean);
};

type ImportPlatform = 'youtube' | 'instagram' | 'pinterest';
const classifyImportUrl = (raw:string):ImportPlatform|null => {
    try {
        const parsed=new URL(raw);
        if(!['http:','https:'].includes(parsed.protocol))return null;
        const host=parsed.hostname.toLowerCase().replace(/^www\./,'');
        if(host==='youtu.be'||host==='youtube.com'||host.endsWith('.youtube.com'))return 'youtube';
        if(host==='instagram.com'||host.endsWith('.instagram.com'))return 'instagram';
        if(host==='pin.it'||host==='pinterest.com'||host.endsWith('.pinterest.com'))return 'pinterest';
    } catch { /* incomplete URL */ }
    return null;
};

const importSourceLabel = (job:Pick<ImportStatus,'source'|'url'>) => {
    if (job.source === 'drive') return 'گوگل درایو';
    const platform = classifyImportUrl(job.url);
    return platform === 'youtube' ? 'یوتیوب'
        : platform === 'pinterest' ? 'پینترست'
            : platform === 'instagram' ? 'اینستاگرام'
                : 'لینک';
};

type ImportStatus = {
    id: string;
    source: 'link' | 'drive';
    url: string;
    quality?: string;
    folder_id?: number | null;
    created_at?: string;
    state: 'queued' | 'downloading' | 'saving' | 'paused' | 'cancelled' | 'done' | 'error';
    message: string;
    saved?: number;
    progress?: number;
};
const mergeImportStatuses=(current:ImportStatus[],incoming:ImportStatus[])=>{
    const merged=new Map<string,ImportStatus>();
    current.forEach(item=>merged.set(item.id,item));
    incoming.forEach(item=>merged.set(item.id,{...merged.get(item.id),...item}));
    return Array.from(merged.values());
};
type DriveEntry={id:string;name:string;mimeType:string;size?:string;modifiedTime?:string;thumbnailLink?:string};
type DriveViewMode='list'|'grid'|'dense';
type DriveTypeFilter='all'|'folder'|'image'|'video'|'audio'|'document';
type DriveSort='name'|'modified'|'size'|'type';
const driveEntryKind=(entry:DriveEntry):DriveTypeFilter=>entry.mimeType==='application/vnd.google-apps.folder'?'folder':entry.mimeType.startsWith('image/')?'image':entry.mimeType.startsWith('video/')?'video':entry.mimeType.startsWith('audio/')?'audio':'document';
const driveKindLabel:Record<DriveTypeFilter,string>={all:'همه',folder:'پوشه',image:'عکس',video:'ویدیو',audio:'صدا',document:'سند و فایل'};
type DriveAccount={email:string;mode:'full'|'picker'};
type DriveConnection={
    configured:boolean; full_configured:boolean; picker_configured:boolean;
    connected:boolean; email?:string|null; mode?:'full'|'picker'|null; accounts?:DriveAccount[];
};
type DeliveryDestination={id:number;name:string;chat_id:number;chat_type:string;is_default:boolean;enabled:boolean};

function DeliveryTargetPicker({value,onChange,className=''}:{value:number[];onChange:(ids:number[])=>void;className?:string}) {
    const [items,setItems]=useState<DeliveryDestination[]>([]);
    const [loading,setLoading]=useState(true);
    useEffect(()=>{let active=true;void api.get<DeliveryDestination[]>('/delivery/destinations').then(({data})=>{if(active){setItems(data.filter(item=>item.enabled));if(!value.length){const defaults=data.filter(item=>item.enabled&&item.is_default).map(item=>item.id);if(defaults.length)onChange(defaults)}}}).catch(()=>undefined).finally(()=>{if(active)setLoading(false)});return()=>{active=false}},[]);
    if(loading)return <div className={`mt-3 rounded-2xl border border-white/[.07] bg-white/[.025] p-3 text-xs text-dark-500 ${className}`}>در حال خواندن مقصدهای تلگرام…</div>;
    if(!items.length)return <div className={`mt-3 rounded-2xl border border-white/[.07] bg-white/[.025] p-3 text-xs leading-6 text-dark-400 ${className}`}>مقصد جداگانه‌ای ثبت نشده؛ خروجی به گفت‌وگوی خودت با ربات فرستاده می‌شود.</div>;
    return <div className={`mt-3 rounded-2xl border border-white/[.07] bg-white/[.025] p-3 ${className}`}><div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold">مقصدهای تلگرام</span><span className="text-[10px] text-dark-500">انتخاب چند مقصد ممکن است</span></div><div className="flex flex-wrap gap-2">{items.map(item=>{const selected=value.includes(item.id);return <button type="button" key={item.id} onClick={()=>onChange(selected?value.filter(id=>id!==item.id):[...value,item.id])} className={`flex min-h-10 items-center gap-2 rounded-xl border px-3 text-xs transition ${selected?'border-primary-400/35 bg-primary-500/15 text-primary-100':'border-white/[.07] bg-dark-900/60 text-dark-300 hover:border-primary-400/20'}`}><span className={`flex h-4 w-4 items-center justify-center rounded-full border ${selected?'border-primary-300 bg-primary-500':'border-dark-500'}`}>{selected&&<CheckSquare className="h-3 w-3"/>}</span><span>{item.name}</span>{item.is_default&&<span className="text-[9px] text-primary-300">پیش‌فرض</span>}</button>})}</div>{!value.length&&<p className="mt-2 text-[10px] text-dark-500">بدون انتخاب، مقصد پیش‌فرض یا گفت‌وگوی خودت استفاده می‌شود.</p>}</div>;
}

let googlePickerLoader:Promise<void>|null=null;
const loadGooglePicker=()=>{
    if((window as any).google?.picker)return Promise.resolve();
    if(googlePickerLoader)return googlePickerLoader;
    googlePickerLoader=new Promise<void>((resolve,reject)=>{
        const ready=()=>{
            const gapi=(window as any).gapi;
            if(!gapi){reject(new Error('Google API unavailable'));return}
            gapi.load('picker',{callback:resolve,onerror:()=>reject(new Error('Google Picker unavailable'))});
        };
        const existing=document.querySelector<HTMLScriptElement>('script[data-komod-google-picker]');
        if(existing){if((window as any).gapi)ready();else existing.addEventListener('load',ready,{once:true});return}
        const script=document.createElement('script');script.src='https://apis.google.com/js/api.js';script.async=true;script.dataset.komodGooglePicker='true';script.onload=ready;script.onerror=()=>reject(new Error('Google API load failed'));document.head.appendChild(script);
    });
    return googlePickerLoader;
};

export default function FileBrowser() {
    const readOnlyWorkspace = Boolean(localStorage.getItem('komod-active-workspace')) && localStorage.getItem('komod-active-workspace-permission') === 'read';
    const activeWorkspaceId = Number(localStorage.getItem('komod-active-workspace') || 0);
    const {data:workspaces=[]} = useWorkspaces();
    const activeSharedWorkspace = activeWorkspaceId ? workspaces.find(space=>space.user_id===activeWorkspaceId) : undefined;
    const {
        currentFolderId,
        setCurrentFolderId,
        breadcrumbs,
        setBreadcrumbs,
        selectedFileIds,
        selectFile,
        selectedFolderIds,
        selectFolder,
        clearSelection,
        selectAll,
        viewMode,
        setViewMode,
        previewFile,
        setPreviewFile,
        setContentPreviewFile,
        showNewFolder,
        setShowNewFolder,
        moveItems,
        setMoveItems,
        deleteConfirm,
        setDeleteConfirm,
        searchQuery,
        setSearchQuery,
        fileTypeFilter,
        setFileTypeFilter,
        renameFile,
        setRenameFile,
        renameFolder,
        setRenameFolder,
        descriptionItem,
        setDescriptionItem,
        clipboard,
        setClipboard,
        selectionBox,
        setSelectionBox,
        activeSection,
        setActiveSection,
        addToast,
        setSelectedFiles,
        setPlaylistFiles,
        startQueue
    } = useAppStore();
    useEffect(()=>{
        if(localStorage.getItem('komod-open-settings-after-login')!=='1') return;
        localStorage.removeItem('komod-open-settings-after-login');
        setActiveSection('settings');
    },[setActiveSection]);

    // Pagination state
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [allFiles, setAllFiles] = useState<TelegramFile[]>([]);
    const [showSort, setShowSort] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [showBatchEdit, setShowBatchEdit] = useState(false);
    const [showCreatePack, setShowCreatePack] = useState(false);
    const [showCombineTexts,setShowCombineTexts]=useState(false);
    const [combineTitle,setCombineTitle]=useState('متن ترکیبی');
    const [combineSeparator,setCombineSeparator]=useState<'line'|'blank'|'none'>('line');
    const [combineIncludeNames,setCombineIncludeNames]=useState(true);
    const [combiningTexts,setCombiningTexts]=useState(false);
    const [packFileIds,setPackFileIds]=useState<number[]>([]);
    const [openPackId, setOpenPackId] = useState<number|null>(null);
    const [restorePackFileId,setRestorePackFileId]=useState<number|null>(null);
    const [selectionMode, setSelectionMode] = useState(false);
    const [selectedPackIds,setSelectedPackIds]=useState<Set<number>>(new Set());
    const [pullDistance, setPullDistance] = useState(0);
    const pullStartY = useRef<number | null>(null);
    const [favoriteOnly, setFavoriteOnly] = useState(false);
    const [showTextComposer, setShowTextComposer] = useState(false);
    const [showAddMenu, setShowAddMenu] = useState(false);
    const [showImportLink, setShowImportLink] = useState(false);
    const [showImportDrive, setShowImportDrive] = useState(false);
    const [importDeliveryMode,setImportDeliveryMode]=useState<'library'|'both'|'telegram'>('library');
    const [importDestinationIds,setImportDestinationIds]=useState<number[]>([]);
    const [driveSendToTelegram,setDriveSendToTelegram]=useState(false);
    const [driveDestinationIds,setDriveDestinationIds]=useState<number[]>([]);
    const [showSendPicker,setShowSendPicker]=useState(false);
    const [sendDestinationIds,setSendDestinationIds]=useState<number[]>([]);
    const [sendingToTelegram,setSendingToTelegram]=useState(false);
    const [driveUrl, setDriveUrl] = useState('');
    const [driveFolder, setDriveFolder] = useState<number | null>(null);
    const [driveSubmitting, setDriveSubmitting] = useState(false);
    const [driveConnection,setDriveConnection]=useState<DriveConnection|null>(null);
    const [driveConnecting,setDriveConnecting]=useState(false);
    const [driveEntries,setDriveEntries]=useState<DriveEntry[]>([]);
    const [driveBrowserVisible,setDriveBrowserVisible]=useState(()=>{
        const saved=localStorage.getItem('komod-drive-browser-visible');
        if(saved!==null)return saved==='1';
        const legacy=localStorage.getItem('komod-drive-folders-visible');
        if(legacy!==null){localStorage.setItem('komod-drive-browser-visible',legacy);localStorage.removeItem('komod-drive-folders-visible')}
        return legacy==='1';
    });
    const [driveViewMode,setDriveViewMode]=useState<DriveViewMode>(()=>{const saved=localStorage.getItem('komod-drive-view');return saved==='grid'||saved==='dense'?saved:'list'});
    const [driveTypeFilter,setDriveTypeFilter]=useState<DriveTypeFilter>('all');
    const [driveQuery,setDriveQuery]=useState('');
    const [driveSort,setDriveSort]=useState<DriveSort>('name');
    const [driveSortDirection,setDriveSortDirection]=useState<'asc'|'desc'>('asc');
    const [drivePath,setDrivePath]=useState<Array<{id:string;name:string}>>([{id:'root',name:'درایو من'}]);
    const [driveSelected,setDriveSelected]=useState<Set<string>>(new Set());
    const [driveSelectedDetails,setDriveSelectedDetails]=useState<Record<string,DriveEntry>>({});
    const [driveLoading,setDriveLoading]=useState(false);
    const [importUrl, setImportUrl] = useState('');
    const [importFolder, setImportFolder] = useState<number | 'new' | null>(null);
    const [importFolderName, setImportFolderName] = useState('');
    const [importQuality, setImportQuality] = useState<'auto' | 'audio' | '480' | '720' | '1080'>('480');
    const [uploadProgress, setUploadProgress] = useState<{name:string; index:number; total:number; percent:number; phase:'uploading'|'processing'}|null>(null);
    const [uploadPanelMode, setUploadPanelMode] = useState<'open'|'collapsed'|'hidden'>('open');
    const [isFileDragOver, setIsFileDragOver] = useState(false);
    const [importJobs, setImportJobs] = useState<ImportStatus[]>([]);
    const [importPanelMode, setImportPanelMode] = useState<'open'|'collapsed'|'hidden'>('open');
    const [forceOffline, setForceOffline] = useState(() => localStorage.getItem('komod-force-offline') === '1');
    useEffect(()=>{const params=new URLSearchParams(window.location.search);const drive=params.get('drive');if(!drive)return;addToast(drive==='connected'?'حساب گوگل با موفقیت متصل شد.':'اتصال حساب گوگل کامل نشد؛ دوباره تلاش کن.',drive==='connected'?'success':'error');params.delete('drive');const query=params.toString();window.history.replaceState({},'',`${window.location.pathname}${query?`?${query}`:''}${window.location.hash}`)},[addToast]);
    useEffect(()=>{const open=(event:Event)=>{const ids=(event as CustomEvent<{fileIds:number[]}>).detail?.fileIds||[];if(ids.length){setPackFileIds(ids);setShowCreatePack(true)}};window.addEventListener('komod-add-to-pack',open);return()=>window.removeEventListener('komod-add-to-pack',open)},[]);
    useEffect(()=>{const restore=(event:Event)=>{const detail=(event as CustomEvent<{packId:number;fileId:number}>).detail;if(!detail?.packId||!detail.fileId)return;setRestorePackFileId(detail.fileId);setOpenPackId(detail.packId)};window.addEventListener('komod-pack-restore',restore);return()=>window.removeEventListener('komod-pack-restore',restore)},[]);
    // Vault views are deliberately ephemeral. Persisting this state used to
    // reopen the app inside an empty hidden-only view after refresh/login.
    const [showHidden, setShowHidden] = useState(false);
    const [hiddenOnly, setHiddenOnly] = useState(false);
    const [showVaultPrompt, setShowVaultPrompt] = useState(false);
    const [vaultPassword, setVaultPassword] = useState('');
    const unlockVault = useUnlockVault();
    useTagSettings();
    const {data:globalTTSJobs=[],isSuccess:ttsJobsReady}=useTTSJobs();
    const {data:globalSTTJobs=[],isSuccess:sttJobsReady}=useSTTJobs();
    const knownSpeechJobs=useRef<Record<string,string>>({});
    const speechJobsInitialized=useRef(false);
    useEffect(()=>{
        if(!ttsJobsReady||!sttJobsReady)return;
        const combined=[...globalTTSJobs.map(job=>({...job,kind:'tts'})),...globalSTTJobs.map(job=>({...job,kind:'stt'}))];
        if(!speechJobsInitialized.current){combined.forEach(job=>{knownSpeechJobs.current[`${job.kind}:${job.id}`]=job.state});speechJobsInitialized.current=true;return}
        combined.forEach(job=>{const key=`${job.kind}:${job.id}`;const previous=knownSpeechJobs.current[key];if(previous&&previous!==job.state&&job.state==='done')addToast(job.kind==='tts'?'صدات آماده شد 🎧':'متنت آماده شد 📝','success');if(previous&&previous!==job.state&&job.state==='error')addToast(job.message||'پردازش صدا انجام نشد.','error');knownSpeechJobs.current[key]=job.state});
    },[globalTTSJobs,globalSTTJobs,ttsJobsReady,sttJobsReady,addToast]);
    const hiddenPressTimer = useRef<number | null>(null);
    const hiddenPressTriggered = useRef(false);
    const uploadAbortRef = useRef<AbortController | null>(null);
    const importUrls = useMemo(() => extractImportUrls(importUrl), [importUrl]);
    const importPlatform = useMemo<ImportPlatform | null>(() => {
        if (importUrls.length !== 1) return null;
        try {
            return classifyImportUrl(importUrls[0]);
        } catch { /* incomplete URL */ }
        return null;
    }, [importUrls]);
    const visibleDriveEntries=useMemo(()=>{
        const query=driveQuery.trim().toLocaleLowerCase('fa');
        return driveEntries.filter(item=>(driveTypeFilter==='all'||driveEntryKind(item)===driveTypeFilter)&&(!query||item.name.toLocaleLowerCase('fa').includes(query))).sort((a,b)=>{
            const folderOrder=Number(driveEntryKind(b)==='folder')-Number(driveEntryKind(a)==='folder');
            if(folderOrder&&driveTypeFilter==='all')return folderOrder;
            const value=driveSort==='name'?a.name.localeCompare(b.name,'fa'):driveSort==='modified'?String(a.modifiedTime||'').localeCompare(String(b.modifiedTime||'')):driveSort==='size'?Number(a.size||0)-Number(b.size||0):driveEntryKind(a).localeCompare(driveEntryKind(b),'fa')||a.name.localeCompare(b.name,'fa');
            return driveSortDirection==='asc'?value:-value;
        });
    },[driveEntries,driveQuery,driveTypeFilter,driveSort,driveSortDirection]);
    useEffect(() => {
        const syncConnectionMode = () => setForceOffline(localStorage.getItem('komod-force-offline') === '1');
        window.addEventListener('komod-connectivity-mode', syncConnectionMode);
        return () => window.removeEventListener('komod-connectivity-mode', syncConnectionMode);
    }, []);

    useEffect(() => {
        if (!navigator.onLine || forceOffline) return;
        let cancelled=false;
        const syncQueue=async()=>{try{
            const [links,drives]=await Promise.all([
                api.get<Omit<ImportStatus,'source'>[]>('/files/import-link/status'),
                api.get<Omit<ImportStatus,'source'>[]>('/files/import-drive/status'),
            ]);
            if(!cancelled)setImportJobs(mergeImportStatuses([], [
                ...links.data.map(job=>({...job,source:'link' as const})),
                ...drives.data.map(job=>({...job,source:'drive' as const})),
            ]));
        }catch{/* وضعیت محلی حفظ می‌شود */}};
        void syncQueue();
        const timer=window.setInterval(syncQueue,4000);
        return()=>{cancelled=true;window.clearInterval(timer)};
    },[forceOffline]);

    useEffect(() => {
        sessionStorage.removeItem('komod-show-hidden');
        sessionStorage.removeItem('komod-hidden-only');
    }, []);

    useEffect(() => {
        if(!uploadProgress)return;
        publishLocalTransfer({id:'device-upload',kind:'upload',title:uploadProgress.name,state:'downloading',percent:uploadProgress.percent,detail:uploadProgress.phase==='processing'?'در حال ذخیره نهایی':`فایل ${uploadProgress.index} از ${uploadProgress.total}`});
    },[uploadProgress]);
    useEffect(()=>{const cancel=()=>uploadAbortRef.current?.abort();window.addEventListener('komod-cancel-upload',cancel);return()=>window.removeEventListener('komod-cancel-upload',cancel)},[]);

    useEffect(() => {
        const applyHiddenVisibility = (event: Event) => {
            const explicit = (event as CustomEvent<{visible?:boolean}>).detail?.visible;
            const next = typeof explicit === 'boolean' ? explicit : false;
            setShowHidden(next); setPage(1); setAllFiles([]);
        };
        window.addEventListener('komod-hidden-visibility', applyHiddenVisibility);
        return () => window.removeEventListener('komod-hidden-visibility', applyHiddenVisibility);
    }, []);
    useEffect(() => {
        const lockVault = () => { setShowHidden(false); setHiddenOnly(false); sessionStorage.removeItem('komod-hidden-only'); };
        window.addEventListener('komod-vault-changed', lockVault);
        return () => window.removeEventListener('komod-vault-changed', lockVault);
    }, []);
    const toggleConnectionMode = () => {
        const next = !forceOffline;
        if (next) localStorage.setItem('komod-force-offline', '1'); else localStorage.removeItem('komod-force-offline');
        setForceOffline(next);
        window.dispatchEvent(new Event('komod-connectivity-mode'));
        addToast(next ? 'حالت آفلاین فعال شد.' : navigator.onLine ? 'حالت آنلاین فعال شد.' : 'اینترنت دستگاه هنوز قطع است.', navigator.onLine || next ? 'success' : 'error');
    };
    const [textFileName, setTextFileName] = useState('یادداشت تازه');
    const [textContent, setTextContent] = useState('');
    const [textFolder, setTextFolder] = useState<number | null>(null);
    const [contentScope, setContentScope] = useState<'all' | 'files' | 'folders'>('all');
    const {data:savedFilters=[]} = useSavedFilters();
    const updateSavedFilters = useUpdateSavedFilters();
    const [activeSavedFilterId, setActiveSavedFilterId] = useState<string|null>(null);
    const [showSaveFilter, setShowSaveFilter] = useState(false);
    const [savedFilterName, setSavedFilterName] = useState('');
    const [sortCriteria, setSortCriteria] = useState<SortCriterion[]>(() => {
        try { return (JSON.parse(localStorage.getItem('komod-sort') || '') || [{ field: 'created', direction: 'desc' }]).slice(0,1); }
        catch { return [{ field: 'created', direction: 'desc' }]; }
    });
    const sortValue = serializeSort(sortCriteria.filter(item => item.field !== 'count'));
    const folderSortValue = serializeSort(sortCriteria.filter(item => ['name', 'created', 'updated', 'count'].includes(item.field)));
    const [rootFilesMode, setRootFilesMode] = useState(() => localStorage.getItem('komod-root-files-mode') || 'folder');
    const [incomingFolderSetting, setIncomingFolderSetting] = useState(() => localStorage.getItem('komod-incoming-folder') || 'default');
    const { data: rootFolders } = useFolders(null, folderSortValue, false, showHidden);
    const { data: folderTree, isLoading: folderTreeLoading, error: folderTreeError } = useFolderTree(showHidden);
    const importFolderOptions = useMemo(() => {
        const result:{value:string;label:string}[]=[];
        const walk=(items:Folder[]|undefined,depth=0)=>items?.forEach(folder=>{result.push({value:String(folder.id),label:folderTreeLabel(folder.name,depth)});walk(folder.children,depth+1)});
        walk(folderTree);
        return result;
    },[folderTree]);
    const hiddenFolderRoots = useMemo(() => {
        const result:Folder[]=[];
        const walk=(items:Folder[]|undefined,parentHidden=false)=>items?.forEach(folder=>{
            const hidden=Boolean(folder.is_hidden);
            if(hidden&&!parentHidden) result.push(folder);
            walk(folder.children,parentHidden||hidden);
        });
        walk(folderTree);
        return result;
    },[folderTree]);
    const defaultFolder = rootFolders?.find(folder => folder.is_default);
    const effectiveFolderId = currentFolderId === null && rootFilesMode === 'files' && defaultFolder ? defaultFolder.id : currentFolderId;
    const incomingFolderId = currentFolderId ?? (incomingFolderSetting !== 'default' && Number.isFinite(Number(incomingFolderSetting)) ? Number(incomingFolderSetting) : defaultFolder?.id ?? null);

    useEffect(() => {
        if (!activeWorkspaceId || activeSection !== 'playlists') return;
        setActiveSection('files');
        window.history.replaceState({}, '', '/');
    }, [activeSection, activeWorkspaceId, setActiveSection]);

    useEffect(() => {
        if (!showImportLink || !importPlatform) return;
        const storageKey=`komod-${importPlatform}-folder`;
        const saved = localStorage.getItem(storageKey) || 'none';
        if (saved === 'none') return;
        const requested=saved==='default'?(defaultFolder?.id??null):Number(saved);
        const valid=requested===null||requested===defaultFolder?.id||importFolderOptions.some(option=>Number(option.value)===requested);
        if(!valid){
            localStorage.setItem(storageKey,'none');
            setImportFolder(null);
            return;
        }
        setImportFolder(requested);
    }, [showImportLink, importPlatform, defaultFolder?.id, importFolderOptions]);

    useEffect(() => {
        const refreshMode = () => setRootFilesMode(localStorage.getItem('komod-root-files-mode') || 'folder');
        const refreshIncoming = () => setIncomingFolderSetting(localStorage.getItem('komod-incoming-folder') || 'default');
        window.addEventListener('komod-root-mode-changed', refreshMode);
        window.addEventListener('komod-incoming-folder-changed', refreshIncoming);
        return () => { window.removeEventListener('komod-root-mode-changed', refreshMode); window.removeEventListener('komod-incoming-folder-changed', refreshIncoming); };
    }, []);

    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(searchQuery);
    const [smartSearchQuery, setSmartSearchQuery] = useState<string | null>(null);
    const [smartSearchTerms, setSmartSearchTerms] = useState<string[]>([]);
    const expandSmartSearch = useExpandSmartSearch();
    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedSearchQuery(searchQuery.trim()), 300);
        return () => window.clearTimeout(timer);
    }, [searchQuery]);
    useEffect(() => {
        setSmartSearchQuery(null);
        setSmartSearchTerms([]);
    }, [searchQuery]);
    const runSmartSearch = async () => {
        const query=searchQuery.trim();
        if(query.length<2){addToast('اول عبارت جست‌وجو را بنویس.','info');return}
        try{
            const expanded=await expandSmartSearch.mutateAsync(query);
            setSmartSearchQuery(expanded.query);
            setSmartSearchTerms(expanded.terms);
            setPage(1);setAllFiles([]);
        }catch(error:any){
            addToast(error?.response?.data?.detail||'جست‌وجوی هوشمند آماده نشد؛ جست‌وجوی عادی همچنان فعاله.','error');
        }
    };

    // Data Fetching
    const packFilterActive = fileTypeFilter.includes('pack');
    const apiFileTypeFilter = fileTypeFilter.filter(type => type !== 'pack');
    const packOnlyFilter = packFilterActive && apiFileTypeFilter.length === 0;
    const effectiveSearchQuery=smartSearchQuery||debouncedSearchQuery;
    const browseAllFiles=currentFolderId===null&&contentScope==='files';
    const { data: filesList, isLoading: filesLoading, isFetching: filesFetching, error: filesError, refetch: refetchFiles } = useFiles(hiddenOnly || effectiveSearchQuery || activeSavedFilterId || browseAllFiles ? undefined : effectiveFolderId, apiFileTypeFilter.join(',') || undefined, effectiveSearchQuery || undefined, page, sortValue, favoriteOnly, false, showHidden, hiddenOnly, browseAllFiles);
    const { data: activityFeed, isLoading: activityLoading, isError: activityError, refetch: refetchActivity } = useActivityFeed(activeSection === 'activity', 50);


    // For files section, accumulate files from all pages
    useEffect(() => {
        if (filesList && activeSection === 'files') {
            setAllFiles(prev => {
                if (filesList.page === 1) return filesList.files;
                const refreshed = new Map(prev.map(f => [f.id, f]));
                filesList.files.forEach(f => refreshed.set(f.id, f));
                return Array.from(refreshed.values());
            });
            setHasMore(filesList.page * filesList.per_page < filesList.total);
        }
    }, [filesList, activeSection]);

    // Fetch remaining pages sequentially in the background. This keeps each
    // response small while making selection/search within a folder complete
    // without forcing the user to scroll to the bottom first.
    useEffect(()=>{
        if(activeSection!=='files'||!hasMore||filesFetching||!filesList||filesList.page!==page)return;
        const timer=window.setTimeout(()=>setPage(current=>current===page?current+1:current),140);
        return()=>window.clearTimeout(timer);
    },[activeSection,filesFetching,filesList,hasMore,page]);

    // Determine which files to show
    let displayFiles: TelegramFile[] | undefined;
    let isLoading = false;

    const activityQuery = searchQuery.trim().toLocaleLowerCase('fa');
    const matchesActivityQuery = (item: TelegramFile) => !activityQuery
        || item.file_name.toLocaleLowerCase('fa').includes(activityQuery)
        || (item.description || '').toLocaleLowerCase('fa').includes(activityQuery);
    const continueWatchingFiles = (activityFeed?.continue_watching || []).filter(matchesActivityQuery);
    const continueWatchingIds = new Set(continueWatchingFiles.map(item => item.id));
    const recentlyAddedFiles = (activityFeed?.recent || [])
        .filter(matchesActivityQuery)
        .filter(item => !continueWatchingIds.has(item.id));

    if (activeSection === 'activity') {
        displayFiles = [...continueWatchingFiles, ...recentlyAddedFiles];
        isLoading = activityLoading;
    } else {
        displayFiles = allFiles;
        // A pack-only filter must not wait for the unrelated files request.
        // This was the reason selecting «جعبه» could leave the page empty.
        isLoading = packOnlyFilter ? false : filesLoading;
    }
    if (hiddenOnly) displayFiles = displayFiles?.filter(item => item.is_hidden);

    // Folder and file visibility is controlled from one shared content switcher.
    const { data: folders, isLoading: foldersLoading, error: foldersError, refetch: refetchFolders } = useFolders(currentFolderId, folderSortValue, favoriteOnly, showHidden);
    // When the default drawer is flattened into the root, files and packs must
    // use the same effective location. Otherwise the «pack» filter looks empty.
    const { data: packs = [], refetch: refetchPacks } = usePacks(effectiveSearchQuery ? null : effectiveFolderId, Boolean(effectiveSearchQuery));
    const visibleFolders = (hiddenOnly ? hiddenFolderRoots : folders)?.filter(folder => {
        if (hiddenOnly && !folder.is_hidden) return false;
        if (currentFolderId === null && rootFilesMode === 'files' && folder.is_default) return false;
        if (!searchQuery.trim()) return true;
        const query = searchQuery.trim().toLocaleLowerCase('fa');
        return folder.name.toLocaleLowerCase('fa').includes(query)
            || (folder.description || '').toLocaleLowerCase('fa').includes(query);
    });
    const showFolders = activeSection === 'files' && contentScope !== 'files' && fileTypeFilter.length === 0;
    const showPacks = activeSection === 'files' && (contentScope !== 'folders' || packFilterActive) && (fileTypeFilter.length === 0 || packFilterActive);
    const showFiles = (activeSection !== 'files' || contentScope !== 'folders') && !packOnlyFilter;
    const visiblePacks = hiddenOnly || favoriteOnly ? [] : packs.filter(pack => {
        const query = searchQuery.trim().toLocaleLowerCase('fa');
        return !query || `${pack.name} ${pack.description || ''} ${pack.preview_names.join(' ')}`.toLocaleLowerCase('fa').includes(query);
    });

    // Combined loading state
    isLoading = isLoading || (activeSection === 'files' && ((showFolders && foldersLoading) || (hiddenOnly && folderTreeLoading)));

    // Mutations
    const deleteFilesMutation = useDeleteFiles();
    const deleteFolderMutation = useDeleteFolder();
    const deleteFoldersMutation = useDeleteFolders();
    const updateFileMutation = useUpdateFile();
    const moveFilesMutation = useMoveFiles();
    const moveFoldersMutation = useMoveFolders();
    const updateFolderMutation = useUpdateFolder();
    const batchUpdateFilesMutation = useBatchUpdateFiles();
    const uploadFileMutation = useUploadFile();
    const importLinkMutation = useImportLink();

    const containerRef = useRef<HTMLDivElement>(null);
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const selectionStart = useRef({ x: 0, y: 0 });

    useEffect(() => applyTheme(getStoredTheme()), []);

    useEffect(() => {
        if (navigator.onLine && localStorage.getItem('komod-force-offline') !== '1') void cacheAllTextNotes();
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        const driveResult=params.get('drive');
        if(driveResult){addToast(driveResult==='connected'?'حساب گوگل متصل شد ✅':'اتصال حساب گوگل انجام نشد.',driveResult==='connected'?'success':'error');window.history.replaceState({},'',window.location.pathname);return}
        if (params.get('share-target') !== '1') return;
        const shared = [params.get('url'), params.get('text')].filter(Boolean).join('\n');
        const urls = extractImportUrls(shared);
        if (urls.length) { setImportUrl(urls.join('\n')); setShowImportLink(true); }
        window.history.replaceState({}, '', window.location.pathname);
    }, []);

    useEffect(() => {
        if (activeSection !== 'files') {
            setSelectionMode(false);
            clearSelection();
            setSelectedPackIds(new Set());
        }
    }, [activeSection, clearSelection]);

    const uploadSelectedFiles = async (selected: globalThis.File[]) => {
        if (!selected.length) return;
        if (uploadAbortRef.current) {
            addToast('یک صف آپلود در حال اجراست؛ کمی صبر کن یا آن را لغو کن.', 'info');
            return;
        }
        const controller = new AbortController();
        uploadAbortRef.current = controller;
        setUploadPanelMode('open');
        let uploaded = 0;
        let shortcuts = 0;
        try {
            for (const file of selected) {
                setUploadProgress({name:file.name,index:uploaded+1,total:selected.length,percent:0,phase:'uploading'});
                const saved = await uploadFileMutation.mutateAsync({ file, folderId: incomingFolderId, signal: controller.signal, onProgress: percent => setUploadProgress({name:file.name,index:uploaded+1,total:selected.length,percent,phase:percent >= 100 ? 'processing' : 'uploading'}) });
                if (saved.is_shortcut) shortcuts += 1;
                uploaded += 1;
            }
            publishLocalTransfer({id:'device-upload',kind:'upload',title:selected[selected.length-1]?.name||'آپلود از دستگاه',state:'done',percent:100,detail:`${uploaded} فایل ذخیره شد`});
            addToast(shortcuts
                ? `${uploaded.toLocaleString('fa-IR')} مورد اضافه شد؛ ${shortcuts.toLocaleString('fa-IR')} فایل تکراری به‌صورت میانبر ذخیره شد 🔗`
                : `${uploaded.toLocaleString('fa-IR')} فایل با موفقیت به کمد اضافه شد 📥`);
            handleRefresh();
        } catch (error:any) {
            publishLocalTransfer({id:'device-upload',kind:'upload',title:selected[Math.min(uploaded,selected.length-1)]?.name||'آپلود از دستگاه',state:controller.signal.aborted?'cancelled':'error',percent:selected.length?Math.round(uploaded/selected.length*100):0,detail:controller.signal.aborted?'آپلود لغو شد':'آپلود ناموفق بود'});
            if (controller.signal.aborted || error?.code === 'ERR_CANCELED') addToast(uploaded ? `${uploaded.toLocaleString('fa-IR')} فایل ذخیره شد و ادامهٔ آپلود لغو شد.` : 'آپلود لغو شد.', 'info');
            else addToast(uploaded ? `${uploaded.toLocaleString('fa-IR')} فایل ذخیره شد؛ ادامهٔ آپلود متوقف شد.` : 'آپلود فایل انجام نشد. کمی بعد دوباره تلاش کن.', 'error');
        } finally { uploadAbortRef.current = null; setUploadProgress(null); }
    };

    const handleWebUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const selected = Array.from(event.target.files || []);
        event.target.value = '';
        void uploadSelectedFiles(selected);
    };

    const handleExternalFileDrop = (event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsFileDragOver(false);
        const selected = Array.from(event.dataTransfer.files || []);
        if (selected.length) void uploadSelectedFiles(selected);
    };

    // handle refresh
    const handleRefresh = useCallback(() => {
        if (activeSection === 'files') {
            refetchFiles();
            refetchFolders();
            refetchPacks();
        } else if (activeSection === 'activity') {
            refetchActivity();
        } else {
            window.location.reload();
        }
    }, [activeSection, refetchFiles, refetchFolders, refetchPacks, refetchActivity]);

    useEffect(()=>{
        const refreshLibrary=(event:Event)=>{
            if(activeSection!=='files')return;
            const detail=(event as CustomEvent<LibraryChangeDetail>).detail;
            if(detail?.updatedFiles?.length){
                const updatedById=new Map(detail.updatedFiles.map(file=>[file.id,file]));
                setAllFiles(current=>current.flatMap(file=>{
                    const updated=updatedById.get(file.id);
                    if(!updated)return [file];
                    const merged={...file,...updated};
                    if(!showHidden&&merged.is_hidden)return [];
                    if(hiddenOnly&&!merged.is_hidden)return [];
                    if(favoriteOnly&&!merged.is_favorite)return [];
                    return [merged];
                }));
            }
            if(detail?.deletedFileIds?.length){
                const deleted=new Set(detail.deletedFileIds);
                setAllFiles(current=>current.filter(file=>!deleted.has(file.id)));
            }
            if(detail?.movedFileIds?.length){
                const moved=new Set(detail.movedFileIds);
                setAllFiles(current=>current.flatMap(file=>{
                    if(!moved.has(file.id))return [file];
                    const updated={...file,folder_id:detail.targetFolderId??null};
                    const scoped=!hiddenOnly&&!effectiveSearchQuery&&!activeSavedFilterId&&!browseAllFiles;
                    return scoped&&updated.folder_id!==effectiveFolderId?[]:[updated];
                }));
            }
            void Promise.all([refetchFiles(),refetchFolders(),refetchPacks()]);
        };
        window.addEventListener('komod-library-changed',refreshLibrary);
        return()=>window.removeEventListener('komod-library-changed',refreshLibrary);
    },[activeSection,activeSavedFilterId,browseAllFiles,effectiveFolderId,effectiveSearchQuery,favoriteOnly,hiddenOnly,refetchFiles,refetchFolders,refetchPacks,showHidden]);

    const pullEnabled = !(window as Window & { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp?.initData;
    const handlePullStart = (event: React.TouchEvent<HTMLDivElement>) => {
        if (!pullEnabled || event.currentTarget.scrollTop > 0) return;
        pullStartY.current = event.touches[0]?.clientY ?? null;
    };
    const handlePullMove = (event: React.TouchEvent<HTMLDivElement>) => {
        if (pullStartY.current === null || event.currentTarget.scrollTop > 0) return;
        const distance = Math.max(0, (event.touches[0]?.clientY ?? pullStartY.current) - pullStartY.current);
        setPullDistance(Math.min(78, distance * 0.55));
    };
    const handlePullEnd = () => {
        if (pullDistance >= 52) { handleRefresh(); addToast('کمد تازه شد ✨'); }
        pullStartY.current = null;
        setPullDistance(0);
    };

    // Handle drag-drop file to folder
    const handleFileDrop = useCallback(async (fileId: number, folderId: number) => {
        await updateFileMutation.mutateAsync({ id: fileId, folder_id: folderId });
    }, [updateFileMutation]);

    // Handle file rename
    const handleRenameFile = useCallback(async (newName: string) => {
        if (!renameFile) return;
        await updateFileMutation.mutateAsync({ id: renameFile.id, file_name: newName });
        setRenameFile(null);
    }, [renameFile, updateFileMutation, setRenameFile]);

    // Handle folder rename
    const handleRenameFolder = useCallback(async (newName: string) => {
        if (!renameFolder) return;
        await updateFolderMutation.mutateAsync({ id: renameFolder.id, name: newName });
        setRenameFolder(null);
    }, [renameFolder, updateFolderMutation, setRenameFolder]);

    const handleSaveDescription = useCallback(async (description: string) => {
        if (!descriptionItem) return;
        if (descriptionItem.type === 'file') {
            await updateFileMutation.mutateAsync({ id: descriptionItem.item.id, description });
        } else {
            await updateFolderMutation.mutateAsync({ id: descriptionItem.item.id, description });
        }
        setDescriptionItem(null);
    }, [descriptionItem, updateFileMutation, updateFolderMutation, setDescriptionItem]);

    const handleBatchEdit = useCallback(async (data: Omit<BatchFileEdit, 'ids'>) => {
        await batchUpdateFilesMutation.mutateAsync({ ids: Array.from(selectedFileIds), ...data });
        clearSelection();
        addToast(`${selectedFileIds.size} فایل با موفقیت ویرایش شد`, 'success');
    }, [addToast, batchUpdateFilesMutation, clearSelection, selectedFileIds]);

    useEffect(() => {
        localStorage.setItem('komod-sort', JSON.stringify(sortCriteria));
    }, [sortCriteria]);

    // Navigate to folder
    const navigateToFolder = useCallback((folder: Folder | null) => {
        if (folder === null) {
            setCurrentFolderId(null);
            setBreadcrumbs([{ id: null, name: 'کمد من' }]);
        } else {
            setCurrentFolderId(folder.id);
            setBreadcrumbs([...breadcrumbs, { id: folder.id, name: folder.name }]);
            window.history.pushState({ komodFolder: true }, '');
        }
        clearSelection();
    }, [breadcrumbs, clearSelection, setBreadcrumbs, setCurrentFolderId]);

    // Navigate via breadcrumbs
    const navigateToBreadcrumb = useCallback((index: number) => {
        const target = breadcrumbs[index];
        setCurrentFolderId(target.id);
        setBreadcrumbs(breadcrumbs.slice(0, index + 1));
        clearSelection();
    }, [breadcrumbs, clearSelection, setBreadcrumbs, setCurrentFolderId]);

    const navigateToParentFolder = useCallback(() => {
        if (breadcrumbs.length > 1) navigateToBreadcrumb(breadcrumbs.length - 2);
    }, [breadcrumbs.length, navigateToBreadcrumb]);

    useEffect(() => {
        const handleBrowserBack = () => {
            if (activeSection === 'files' && breadcrumbs.length > 1) navigateToBreadcrumb(breadcrumbs.length - 2);
        };
        window.addEventListener('popstate', handleBrowserBack);
        return () => window.removeEventListener('popstate', handleBrowserBack);
    }, [activeSection, breadcrumbs.length, navigateToBreadcrumb]);

    useEffect(() => {
        if (activeSection === 'playlists') return;
        const backButton = (window as Window & { Telegram?: { WebApp?: { BackButton?: { show: () => void; hide: () => void; onClick: (handler: () => void) => void; offClick: (handler: () => void) => void } } } }).Telegram?.WebApp?.BackButton;
        if (!backButton) return;
        const canGoBack = activeSection === 'files' && breadcrumbs.length > 1;
        const goBack = navigateToParentFolder;
        if (canGoBack) {
            backButton.show();
            backButton.onClick(goBack);
        } else {
            backButton.hide();
        }
        return () => {
            if (canGoBack) backButton.offClick(goBack);
        };
    }, [activeSection, breadcrumbs.length, navigateToParentFolder]);

    // Handle delete confirmation
    const handleDeleteConfirm = async (deleteContents: boolean) => {
        if (!deleteConfirm) return;
        const { type, items } = deleteConfirm;

        try {
            if (type === 'file') {
                const ids = items.map(i => i.id);
                await deleteFilesMutation.mutateAsync(ids);
            } else if (type === 'folder') {
                const ids = items.map(i => i.id);
                if (ids.length > 1) {
                    await deleteFoldersMutation.mutateAsync({ ids, deleteContents });
                } else {
                    await deleteFolderMutation.mutateAsync({ id: ids[0], deleteContents });
                }
            } else if (type === 'multiple') {
                 // Split into files and folders
                 const fileIds = items.filter(i => 'file_name' in i).map(i => i.id);
                 const folderIds = items.filter(i => 'name' in i && !('file_name' in i)).map(i => i.id);

                 if (folderIds.length > 0) await deleteFoldersMutation.mutateAsync({ ids: folderIds, deleteContents });
                 if (fileIds.length > 0) await deleteFilesMutation.mutateAsync(fileIds);
            }
            setDeleteConfirm(null);
            clearSelection();
            addToast('موارد انتخاب‌شده با موفقیت حذف شدند.', 'success');
        } catch (error) {
            console.error('Delete failed:', error);
            addToast('حذف موارد انتخاب‌شده انجام نشد.', 'error');
            setDeleteConfirm(null);
        }
    };



    // Handle Paste
    const handlePaste = useCallback(async () => {
        if (!clipboard) return;

        try {
            if (clipboard.mode === 'cut') {
                if (clipboard.files.length > 0) {
                    await moveFilesMutation.mutateAsync({
                        ids: clipboard.files.map(f => f.id),
                        folderId: currentFolderId
                    });
                }
                if (clipboard.folders.length > 0) {
                    await moveFoldersMutation.mutateAsync({
                        ids: clipboard.folders.map(f => f.id),
                        folderId: currentFolderId
                    });
                }
                setClipboard(null);
            } else if (clipboard.mode === 'copy') {
                alert('در حال حاضر فقط جابه‌جایی فایل‌ها پشتیبانی می‌شود.');
            }
        } catch (error) {
            console.error('Paste failed:', error);
        }
    }, [clipboard, currentFolderId, moveFilesMutation, moveFoldersMutation, setClipboard]);


    // Selection Box Logic
    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return; // Only left click
        // If clicking on a card or button, ignore
        if ((e.target as HTMLElement).closest('[data-file-id], [data-folder-id]') ||
            (e.target as HTMLElement).closest('button') ||
            (e.target as HTMLElement).closest('.sidebar')) return;

        setIsSelecting(true);
        // Determine relative position in the container
        const rect = containerRef.current?.getBoundingClientRect();
        if (rect) {
            const startX = e.clientX - rect.left + containerRef.current!.scrollLeft;
            const startY = e.clientY - rect.top + containerRef.current!.scrollTop;
            selectionStart.current = { x: startX, y: startY };
            setSelectionBox({ x1: startX, y1: startY, x2: startX, y2: startY, active: true });
        }

        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
            clearSelection();
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isSelecting || !containerRef.current) return;

        const rect = containerRef.current.getBoundingClientRect();
        const currentX = e.clientX - rect.left + containerRef.current.scrollLeft;
        const currentY = e.clientY - rect.top + containerRef.current.scrollTop;

        setSelectionBox({
            x1: selectionStart.current.x,
            y1: selectionStart.current.y,
            x2: currentX,
            y2: currentY,
            active: true
        });

        // Calculate selection
        const box = {
            left: Math.min(selectionStart.current.x, currentX),
            top: Math.min(selectionStart.current.y, currentY),
            right: Math.max(selectionStart.current.x, currentX),
            bottom: Math.max(selectionStart.current.y, currentY),
        };

        const fileIdsToSelect: number[] = [];
        const folderIdsToSelect: number[] = [];

        // Check files
        const fileElements = containerRef.current.querySelectorAll('[data-file-id]');
        fileElements.forEach((el) => {
            const elRect = (el as HTMLElement).getBoundingClientRect();
            const elLeft = elRect.left - rect.left + containerRef.current!.scrollLeft;
            const elTop = elRect.top - rect.top + containerRef.current!.scrollTop;
            const elRight = elLeft + elRect.width;
            const elBottom = elTop + elRect.height;

            if (elLeft < box.right && elRight > box.left && elTop < box.bottom && elBottom > box.top) {
                fileIdsToSelect.push(Number((el as HTMLElement).dataset.fileId));
            }
        });

        // Check folders
        const folderElements = containerRef.current.querySelectorAll('[data-folder-id]');
        folderElements.forEach((el) => {
            const elRect = (el as HTMLElement).getBoundingClientRect();
            const elLeft = elRect.left - rect.left + containerRef.current!.scrollLeft;
            const elTop = elRect.top - rect.top + containerRef.current!.scrollTop;
            const elRight = elLeft + elRect.width;
            const elBottom = elTop + elRect.height;

            if (elLeft < box.right && elRight > box.left && elTop < box.bottom && elBottom > box.top) {
                folderIdsToSelect.push(Number((el as HTMLElement).dataset.folderId));
            }
        });

        if (fileIdsToSelect.length > 0 || folderIdsToSelect.length > 0) {
            selectAll(fileIdsToSelect, folderIdsToSelect);
        } else {
            clearSelection();
        }
    };

    const handleMouseUp = () => {
        if (isSelecting) {
            setIsSelecting(false);
            setSelectionBox(null);
        }
    };

    // Handle File Open / Play
    const handleFileOpen = (file: TelegramFile) => {
        if (file.prefer_text_view && file.description?.trim()) {
            setContentPreviewFile(file);
        } else if (file.file_type === 'video' || file.file_type === 'audio') {
            const queue = (displayFiles || []).filter(item => item.file_type === 'video' || item.file_type === 'audio');
            const index = queue.findIndex(item => item.id === file.id);
            startQueue(queue.length ? queue : [file], Math.max(0, index));
        } else if (file.file_type === 'image' || file.file_type === 'document' || canPreviewText(file)) {
            setContentPreviewFile(file);
        }
    };

    const downloadSelectedFiles = async () => {
        addToast('دارم لینک‌های دانلود رو آماده می‌کنم…', 'info');
        for (const file of selectedFilesForActions) {
            try {
                const token=localStorage.getItem('access_token')||'';
                const raw=file.stream_url||`/api/stream/${file.id}`;
                const stream=raw.startsWith('http')?raw:`${window.location.origin}${raw.startsWith('/')?'':'/'}${raw}`;
                const anchor=document.createElement('a');
                anchor.href=`${stream}${stream.includes('?')?'&':'?'}token=${encodeURIComponent(token)}&download=1`;
                anchor.download=file.file_name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
                await new Promise(resolve=>setTimeout(resolve,250));
            } catch { /* continue with the remaining selected files */ }
        }
        addToast('دانلود فایل‌های انتخاب‌شده شروع شد.');
    };

    const openImportLink = () => {
        const validIncoming=incomingFolderId===null||incomingFolderId===defaultFolder?.id||importFolderOptions.some(option=>Number(option.value)===incomingFolderId);
        if(!validIncoming){localStorage.setItem('komod-incoming-folder','default');setIncomingFolderSetting('default')}
        setImportFolder(validIncoming?incomingFolderId:(defaultFolder?.id??null));
        setImportDeliveryMode('library'); setImportDestinationIds([]);
        setShowAddMenu(false); setShowImportLink(true);
    };
    const loadDriveFolder=async(id='root',name='درایو من',reset=false)=>{setDriveLoading(true);try{const {data}=await api.get<DriveEntry[]>('/files/drive/browse',{params:{folder_id:id}});setDriveEntries(data);setDrivePath(previous=>{if(reset||id==='root')return[{id:'root',name:'درایو من'}];const existing=previous.findIndex(item=>item.id===id);return existing>=0?previous.slice(0,existing+1):[...previous,{id,name}]})}catch(error:any){addToast(error?.response?.data?.detail||'خواندن فایل‌های گوگل درایو انجام نشد.','error')}finally{setDriveLoading(false)}};
    const fetchDriveConnection=async()=>{const {data}=await api.get<DriveConnection>('/files/drive/status');setDriveConnection(data);return data};
    const openImportDrive = () => { setDriveFolder(incomingFolderId);setDriveSelected(new Set());setDriveSelectedDetails({});setDriveSendToTelegram(false);setDriveDestinationIds([]);setShowAddMenu(false);setShowImportDrive(true);void (async()=>{try{const data=await fetchDriveConnection();if(data.connected&&data.mode==='full'&&driveBrowserVisible)void loadDriveFolder('root','درایو من',true)}catch{setDriveConnection(null)}})() };
    const toggleDriveBrowser=async()=>{const next=!driveBrowserVisible;setDriveBrowserVisible(next);localStorage.setItem('komod-drive-browser-visible',next?'1':'0');if(next&&driveConnection?.mode==='full')await loadDriveFolder('root','درایو من',true)};
    const connectGoogleDrive=async(mode:'full'|'picker'='picker')=>{setDriveConnecting(true);try{const {data}=await api.get<{url:string}>('/files/drive/connect',{params:{mode}});window.location.href=data.url}catch(error:any){setDriveConnecting(false);addToast(error?.response?.data?.detail||'شروع اتصال گوگل انجام نشد.','error')}};
    const openGoogleDrivePicker=async()=>{
        if(!driveConnection?.picker_configured){addToast('انتخاب‌گر عمومی گوگل هنوز روی سرور تنظیم نشده است.','error');return}
        if(!driveConnection.connected){await connectGoogleDrive('picker');return}
        try{
            setDriveLoading(true);
            if(driveConnection.mode!=='picker'){
                const pickerAccount=(driveConnection.accounts||[]).find(account=>account.mode==='picker');
                if(!pickerAccount){setDriveLoading(false);await connectGoogleDrive('picker');return}
                await api.post('/files/drive/switch',{email:pickerAccount.email,mode:'picker'});
                await fetchDriveConnection();
            }
            const [{data}]=await Promise.all([api.get<{access_token:string;developer_key:string;app_id:string}>('/files/drive/picker-config'),loadGooglePicker()]);
            const google=(window as any).google;
            const view=new google.picker.DocsView(google.picker.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
            const picker=new google.picker.PickerBuilder().setOAuthToken(data.access_token).setDeveloperKey(data.developer_key).setAppId(data.app_id).setOrigin(window.location.origin).setLocale('fa').addView(view).enableFeature(google.picker.Feature.MULTISELECT_ENABLED).setCallback((result:any)=>{
                if(result.action!==google.picker.Action.PICKED)return;
                const picked:DriveEntry[]=(result.docs||[]).map((doc:any)=>({id:doc.id||doc[google.picker.Document.ID],name:doc.name||doc[google.picker.Document.NAME],mimeType:doc.mimeType||doc[google.picker.Document.MIME_TYPE]}));
                setDriveSelected(new Set(picked.map(item=>item.id)));
                setDriveSelectedDetails(Object.fromEntries(picked.map(item=>[item.id,item])));
                addToast(`${picked.length.toLocaleString('fa-IR')} فایل انتخاب شد.`);
            }).build();
            picker.setVisible(true);
        }catch(error:any){addToast(error?.response?.data?.detail||'بازکردن انتخاب‌گر گوگل انجام نشد.','error')}finally{setDriveLoading(false)}
    };
    const switchGoogleDrive=async(email:string,mode:'full'|'picker')=>{try{await api.post('/files/drive/switch',{email,mode});const data=await fetchDriveConnection();setDriveSelected(new Set());setDriveSelectedDetails({});setDriveEntries([]);if(data.mode==='full'&&driveBrowserVisible)await loadDriveFolder('root','درایو من',true);addToast('حساب گوگل عوض شد.')}catch(error:any){addToast(error?.response?.data?.detail||'تغییر حساب انجام نشد.','error')}};
    const disconnectGoogleDrive=async()=>{if(!driveConnection?.email||!driveConnection.mode)return;try{await api.delete('/files/drive/disconnect',{params:{email:driveConnection.email,mode:driveConnection.mode}});const data=await fetchDriveConnection();setDriveEntries([]);setDriveSelected(new Set());setDriveSelectedDetails({});if(data.connected&&data.mode==='full'&&driveBrowserVisible)await loadDriveFolder('root','درایو من',true);addToast('حساب گوگل خارج شد.')}catch(error:any){addToast(error?.response?.data?.detail||'خروج از حساب انجام نشد.','error')}};
    const openSpeechTools = (mode:'tts'|'stt') => {
        localStorage.setItem('komod-settings-target','tts');
        localStorage.setItem('komod-speech-mode',mode);
        sessionStorage.setItem('komod-settings-return-section','files');
        setActiveSection('settings');
        window.history.pushState({},'', '/');
    };
    const submitImportLink = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!importUrls.length) return;
        if (importUrls.some(url => !classifyImportUrl(url))) { addToast('یکی از لینک‌ها معتبر نیست؛ فقط یوتیوب، اینستاگرام و پینترست پذیرفته می‌شود.', 'error'); return; }
        try {
            let lastMessage='';
            const jobs:string[]=[];
            for (let index=0; index<importUrls.length; index++) {
                const url=importUrls[index], platform=classifyImportUrl(url);
                const result = await importLinkMutation.mutateAsync({ url, folder_id: importFolder === 'new' ? currentFolderId : importFolder, new_folder_name: importFolder === 'new' && index===0 ? importFolderName.trim() : undefined, quality: platform === 'instagram' || platform === 'pinterest' ? 'auto' : importQuality, save_to_library:importDeliveryMode!=='telegram', send_to_telegram:importDeliveryMode!=='library', destination_ids:importDestinationIds });
                lastMessage=result.message;
                jobs.push(result.job_id);
                setImportJobs(previous => mergeImportStatuses(previous, [{id:result.job_id,source:'link',url,state:'queued',message:'در صف پردازش',saved:0}]));
                setImportPanelMode('open');
            }
            setShowImportLink(false); setImportUrl(''); setImportFolderName('');
            addToast(importUrls.length>1 ? `${importUrls.length.toLocaleString('fa-IR')} لینک به صف اضافه شد؛ وضعیت هرکدام را همین‌جا و در ربات می‌بینی.` : lastMessage);
            jobs.forEach(jobId => { void (async () => {
                for (let attempt=0; attempt<90; attempt++) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    try {
                        const {data}=await api.get<{state:'queued'|'downloading'|'saving'|'paused'|'cancelled'|'done'|'error';message:string;saved:number;progress?:number}>(`/files/import-link/status/${jobId}`);
                        setImportJobs(previous => previous.map(job => job.id === jobId ? {...job,...data} : job));
                        if(data.state==='done'){ addToast(`${data.saved.toLocaleString('fa-IR')} فایل از لینک به کمد اضافه شد ✅`); handleRefresh(); window.setTimeout(()=>setImportJobs(previous=>previous.filter(job=>job.id!==jobId)),1800); return; }
                        if(data.state==='error'||data.state==='cancelled'){ if(data.state==='error') addToast(data.message,'error'); window.setTimeout(()=>setImportJobs(previous=>previous.filter(job=>job.id!==jobId)),1800); return; }
                    } catch { return; }
                }
            })(); });
        } catch (error: any) { addToast(error?.response?.data?.detail || 'ثبت لینک انجام نشد.', 'error'); }
    };

    const submitDriveImport = async (event: React.FormEvent) => {
        event.preventDefault();
        const urls=extractImportUrls(driveUrl);
        if(!urls.length&&!driveSelected.size)return;
        try{
            setDriveSubmitting(true);
            const added:ImportStatus[]=[];
            if(driveSelected.size){const chosen=Object.values(driveSelectedDetails),names=Object.fromEntries(chosen.map(item=>[item.id,item.name])),mimeTypes=Object.fromEntries(chosen.map(item=>[item.id,item.mimeType]));const {data}=await api.post<{job_ids:string[]}>('/files/drive/import-selected',{file_ids:Array.from(driveSelected),file_names:names,mime_types:mimeTypes,folder_id:driveFolder,send_to_telegram:driveSendToTelegram,destination_ids:driveDestinationIds});data.job_ids.forEach((id,index)=>added.push({id,source:'drive',url:`drive://${Array.from(driveSelected)[index]}`,folder_id:driveFolder,state:'queued',message:'در صف دریافت از گوگل درایو',saved:0,progress:1}))}
            for(const url of urls){const {data}=await api.post<{job_id:string}>('/files/import-drive',{url,folder_id:driveFolder,send_to_telegram:driveSendToTelegram,destination_ids:driveDestinationIds});added.push({id:data.job_id,source:'drive',url,folder_id:driveFolder,state:'queued',message:'در صف دریافت از گوگل درایو',saved:0,progress:1})}
            setImportJobs(previous=>mergeImportStatuses(previous,added));
            setImportPanelMode('open');
            setShowImportDrive(false);
            setDriveUrl('');
            setDriveSelected(new Set());
            setDriveSelectedDetails({});
            addToast(`${added.length.toLocaleString('fa-IR')} فایل گوگل درایو به صف انتقال اضافه شد.`);
        }catch(error:any){
            addToast(error?.response?.data?.detail||'انتقال از گوگل درایو شروع نشد.','error');
        }finally{setDriveSubmitting(false)}
    };

    const controlImportJob = async (jobId:string, action:'pause'|'cancel'|'retry') => {
        try {
            const job=importJobs.find(item=>item.id===jobId);
            if(job?.source==='drive'&&action!=='cancel')return;
            const endpoint=job?.source==='drive'?`/files/import-drive/status/${jobId}/cancel`:`/files/import-link/status/${jobId}/${action}`;
            const {data}=await api.post<any>(endpoint);
            if(action==='retry'&&data.job_id){setImportJobs(previous=>[...previous.filter(job=>job.id!==jobId),{id:data.job_id,source:'link',...data.status}]);addToast('دوباره به صف اضافه شد.');return}
            setImportJobs(previous=>previous.map(job=>job.id===jobId?{...job,...data}:job));
            if (data.state === 'cancelled') window.setTimeout(()=>setImportJobs(previous=>previous.filter(job=>job.id!==jobId)),1200);
        } catch (error:any) { addToast(error?.response?.data?.detail || 'تغییر وضعیت انجام نشد.','error'); }
    };

    const handleCreateText = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!textContent.trim()) return;
        const rawName = textFileName.trim() || 'یادداشت تازه';
        const fileName = /\.(md|txt)$/i.test(rawName) ? rawName : `${rawName}.md`;
        const saveToOutbox = async () => {
            await queueOfflineText(fileName, textContent, textFolder);
            setShowTextComposer(false); setTextFileName('یادداشت تازه'); setTextContent('');
            addToast('یادداشت روی دستگاه ذخیره شد؛ وقتی آنلاین بشی خودکار به کمد اضافه می‌شه 📝');
        };
        if (!navigator.onLine || localStorage.getItem('komod-force-offline') === '1') { await saveToOutbox(); return; }
        try {
            await uploadFileMutation.mutateAsync({ file: new File([textContent], fileName, { type: 'text/markdown;charset=utf-8' }), folderId: textFolder });
            setShowTextComposer(false);
            setTextFileName('یادداشت تازه');
            setTextContent('');
            addToast('یادداشت به کمد اضافه شد 📝');
            handleRefresh();
        } catch (error: any) {
            if (!navigator.onLine || !error?.response) await saveToOutbox();
            else addToast('ذخیره یادداشت انجام نشد.', 'error');
        }
    };

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // Never intercept typing or editing shortcuts.
            const target = e.target as HTMLElement | null;
            if (target && (['INPUT', 'TEXTAREA'].includes(target.tagName) || target.isContentEditable)) return;

            // Ctrl+Shift+N - New Folder
            if (e.ctrlKey && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
                e.preventDefault();
                setShowNewFolder(true);
                return;
            }

            // F5 or Ctrl+R - Refresh
            if (e.key === 'F5' || (e.ctrlKey && e.key === 'r')) {
                e.preventDefault();
                handleRefresh();
                return;
            }

            // Escape - close modals or clear selection
            if (e.key === 'Escape') {
                if (previewFile) setPreviewFile(null);
                else if (showNewFolder) setShowNewFolder(false);
                else if (moveItems) setMoveItems(null);
                else if (deleteConfirm) setDeleteConfirm(null);
                else clearSelection();
            }

            // Ctrl+A - select all
            if (e.ctrlKey && e.key === 'a' && displayFiles) {
                e.preventDefault();
                const allFileIds = displayFiles.map(f => f.id);
                const allFolderIds = folders?.map(f => f.id) || [];
                selectAll(allFileIds, allFolderIds);
            }

            // Delete - delete selected
            if (e.key === 'Delete' && (selectedFileIds.size > 0 || selectedFolderIds.size > 0)) {
                e.preventDefault();
                const selectedFiles = displayFiles?.filter(f => selectedFileIds.has(f.id)) || [];
                const selectedFolders = folders?.filter(f => selectedFolderIds.has(f.id)) || [];
                if (selectedFiles.length > 0 || selectedFolders.length > 0) {
                    setDeleteConfirm({ type: 'multiple', items: [...selectedFiles, ...selectedFolders] });
                }
            }

            // F2 - rename selected
            if (e.key === 'F2') {
                e.preventDefault();
                if (selectedFileIds.size === 1) {
                    const file = displayFiles?.find(f => selectedFileIds.has(f.id));
                    if (file) setRenameFile(file);
                } else if (selectedFolderIds.size === 1) {
                    const folder = folders?.find(f => selectedFolderIds.has(f.id));
                    if (folder) setRenameFolder(folder);
                }
            }

            // Backspace - go to parent folder
            if (e.key === 'Backspace' && breadcrumbs.length > 1) {
                navigateToBreadcrumb(breadcrumbs.length - 2);
            }

            // Ctrl+C - Copy
            if (e.ctrlKey && e.key === 'c' && (selectedFileIds.size > 0 || selectedFolderIds.size > 0)) {
                e.preventDefault();
                const selectedFiles = displayFiles?.filter(f => selectedFileIds.has(f.id)) || [];
                const selectedFolders = folders?.filter(f => selectedFolderIds.has(f.id)) || [];
                setClipboard({ mode: 'copy', files: selectedFiles, folders: selectedFolders });
            }

            // Ctrl+X - Cut
            if (e.ctrlKey && e.key === 'x' && (selectedFileIds.size > 0 || selectedFolderIds.size > 0)) {
                e.preventDefault();
                const selectedFiles = displayFiles?.filter(f => selectedFileIds.has(f.id)) || [];
                const selectedFolders = folders?.filter(f => selectedFolderIds.has(f.id)) || [];
                setClipboard({ mode: 'cut', files: selectedFiles, folders: selectedFolders });
            }

            // Ctrl+V - Paste
            if (e.ctrlKey && e.key === 'v' && clipboard && (clipboard.files.length > 0 || clipboard.folders.length > 0)) {
                e.preventDefault();
                handlePaste();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [
        previewFile, showNewFolder, moveItems, deleteConfirm,
        selectedFileIds, displayFiles, breadcrumbs, clipboard,
        currentFolderId, handlePaste, handleRefresh,
        setPreviewFile, setShowNewFolder, setMoveItems, setDeleteConfirm,
        clearSelection, selectAll, setRenameFile, navigateToBreadcrumb, setClipboard, folders
    ]);

    // Keep selectedFiles in sync with selectedFileIds
    useEffect(() => {
        const selectedFiles = displayFiles?.filter(f => selectedFileIds.has(f.id)) || [];
        setSelectedFiles(selectedFiles);
    }, [selectedFileIds, displayFiles, setSelectedFiles]);

    // Infinite scrolling
    useEffect(() => {
        const handleScroll = () => {
            if (containerRef.current && !isLoading && hasMore && activeSection === 'files') {
                const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
                if (scrollTop + clientHeight >= scrollHeight - 100) {
                    // Load more files
                    setPage(prev => prev + 1);
                }
            }
        };

        const container = containerRef.current;
        if (container) {
            container.addEventListener('scroll', handleScroll);
            return () => container.removeEventListener('scroll', handleScroll);
        }
    }, [isLoading, hasMore, activeSection]);

    // Reset pagination when the query changes. Page-one data replaces the old list
    // when it arrives; clearing here could race with that response and hide results.
    useEffect(() => {
        setPage(1);
        setHasMore(true);
    }, [currentFolderId, fileTypeFilter, favoriteOnly, searchQuery, activeSection, sortValue, activeSavedFilterId, contentScope]);

    const selectedFilesForActions = displayFiles?.filter(file => selectedFileIds.has(file.id)) || [];
    const selectedTextFilesForActions = selectedFilesForActions.filter(file=>canPreviewText(file));
    const selectedPlayableFilesForActions = selectedFilesForActions.filter(file => file.file_type === 'audio' || file.file_type === 'video');
    const selectedFoldersForActions = folders?.filter(folder => selectedFolderIds.has(folder.id)) || [];
    const selectedPacksForActions = visiblePacks.filter(pack=>selectedPackIds.has(pack.id));
    const selectedItems = [...selectedFilesForActions, ...selectedFoldersForActions];
    const selectedItemCount=selectedItems.length+selectedPacksForActions.length;
    const combineSelectedTexts=async()=>{if(selectedTextFilesForActions.length<2)return;setCombiningTexts(true);try{const contents=await Promise.all(selectedTextFilesForActions.map(async file=>({file,content:(await api.get<{content:string}>(`/files/${file.id}/text`)).data.content})));const separator=combineSeparator==='line'?'\n\n---\n\n':combineSeparator==='blank'?'\n\n':'';const merged=contents.map(({file,content})=>`${combineIncludeNames?`## ${file.file_name}\n\n`:''}${content.trim()}`).join(separator);const raw=combineTitle.trim()||'متن ترکیبی';const name=/\.md$/i.test(raw)?raw:`${raw}.md`;await uploadFileMutation.mutateAsync({file:new File([merged],name,{type:'text/markdown;charset=utf-8'}),folderId:effectiveFolderId});setShowCombineTexts(false);cancelSelection();addToast('فایل ترکیبی ساخته شد.','success')}catch(error:any){addToast(error?.response?.data?.detail||'ترکیب متن‌ها انجام نشد.','error')}finally{setCombiningTexts(false)}};
    const selectFileRange=()=>{
        const ordered=(displayFiles||[]).map(file=>file.id);
        const selectedIndexes=ordered.map((id,index)=>selectedFileIds.has(id)?index:-1).filter(index=>index>=0);
        if(selectedIndexes.length<2){addToast('اول فایل ابتدا و انتهای بازه را انتخاب کن.','info');return}
        const first=Math.min(...selectedIndexes),last=Math.max(...selectedIndexes);
        selectAll(ordered.slice(first,last+1),Array.from(selectedFolderIds));
        addToast(`${(last-first+1).toLocaleString('fa-IR')} فایلِ بین دو انتخاب انتخاب شد.`);
    };
    const cancelAllImportJobs=async()=>{
        try{
            await Promise.all([api.post('/files/import-link/cancel-all'),api.post('/files/import-drive/cancel-all')]);
            setImportJobs(previous=>previous.map(job=>['queued','downloading','saving','paused'].includes(job.state)?{...job,state:'cancelled',message:'لغو شد',progress:0}:job));
            window.setTimeout(()=>setImportJobs(previous=>previous.filter(job=>job.state!=='cancelled')),1200);
        }catch(error:any){addToast(error?.response?.data?.detail||'لغو صف انجام نشد.','error')}
    };
    const sectionTitle = activeSection === 'activity' ? 'فعالیت' : (breadcrumbs[breadcrumbs.length - 1]?.name || 'کمد من');
    const shownFolderCount = showFolders ? visibleFolders?.length || 0 : 0;
    const shownPackCount = showPacks ? visiblePacks.length : 0;
    const shownFileCount = showFiles ? displayFiles?.length || 0 : 0;
    const selectScope = (scope: 'all' | 'files' | 'folders') => {
        setActiveSavedFilterId(null);
        setContentScope(scope);
        if (scope === 'folders') setFileTypeFilter(null);
        const allowed:SortField[]=scope==='files'?['name','type','size','duration','created','updated']:scope==='folders'?['name','count','created','updated']:['name','created','updated'];
        if(!allowed.includes(sortCriteria[0]?.field))setSortCriteria([{field:'created',direction:'desc'}]);
        clearSelection();
        setSelectedPackIds(new Set());
    };
    const toggleFileType = (type: string | null) => {
        setActiveSavedFilterId(null);
        if (type !== null) setContentScope(type === 'pack' ? 'all' : 'files');
        setFileTypeFilter(type);
        clearSelection();
        setSelectedPackIds(new Set());
    };
    const scopeSortFields:SortField[]=contentScope==='files'?['name','type','size','duration','created','updated']:contentScope==='folders'?['name','count','created','updated']:['name','created','updated'];
    const availableSortFields = scopeSortFields.filter(field => !sortCriteria.some(item => item.field === field));
    const updateSort = (index: number, next: SortCriterion) => { setActiveSavedFilterId(null); setSortCriteria(sortCriteria.map((item, itemIndex) => itemIndex === index ? next : item)); };
    const applySavedFilter = (filter: SavedFilter) => {
        const [rawField, rawDirection] = (filter.sort || 'created:desc').split(':');
        const fields:SortField[]=['name','type','size','duration','created','updated'];
        const field=fields.includes(rawField as SortField)?rawField as SortField:'created';
        const direction=rawDirection==='asc'?'asc':'desc';
        setCurrentFolderId(null);
        setBreadcrumbs([{id:null,name:'کمد من'}]);
        setContentScope('files');
        setSearchQuery(filter.query);
        setFileTypeFilter(filter.file_types);
        setFavoriteOnly(filter.favorite_only);
        setSortCriteria([{field,direction}]);
        setActiveSavedFilterId(filter.id);
        setShowFilters(false);
        setShowSort(false);
        clearSelection();
    };
    const saveCurrentFilter = async () => {
        const name=savedFilterName.trim();
        if(!name){addToast('یک نام برای کشوی هوشمند بنویس.','error');return}
        const id=typeof crypto.randomUUID==='function'?crypto.randomUUID():`filter-${Date.now()}`;
        const filter:SavedFilter={id,name:name.slice(0,40),query:searchQuery.trim().slice(0,100),file_types:fileTypeFilter.filter(type=>['video','audio','image','document','text'].includes(type)) as SavedFilter['file_types'],favorite_only:favoriteOnly,sort:sortValue||'created:desc'};
        try{await updateSavedFilters.mutateAsync([...savedFilters,filter]);setSavedFilterName('');setShowSaveFilter(false);setActiveSavedFilterId(id);addToast('کشوی هوشمند ذخیره شد.');}
        catch{addToast('ذخیره فیلتر انجام نشد.','error')}
    };
    const removeSavedFilter = async (id:string) => {
        try{await updateSavedFilters.mutateAsync(savedFilters.filter(item=>item.id!==id));if(activeSavedFilterId===id)setActiveSavedFilterId(null);addToast('کشوی هوشمند حذف شد.');}
        catch{addToast('حذف فیلتر انجام نشد.','error')}
    };
    const visibleFileIds = showFiles ? displayFiles?.map(file => file.id) || [] : [];
    const visibleFolderIds = showFolders ? visibleFolders?.map(folder => folder.id) || [] : [];
    const totalSelectableFiles = showFiles ? (filesList?.total ?? visibleFileIds.length) : 0;
    const visiblePackIds = showPacks ? visiblePacks.map(pack=>pack.id) : [];
    const visibleItemCount = totalSelectableFiles + visibleFolderIds.length + visiblePackIds.length;
    const allVisibleSelected = visibleItemCount > 0
        && selectedFileIds.size >= totalSelectableFiles
        && visibleFileIds.every(id => selectedFileIds.has(id))
        && visibleFolderIds.every(id => selectedFolderIds.has(id))
        && visiblePackIds.every(id=>selectedPackIds.has(id));
    const toggleSelectAll = async () => {
        if (allVisibleSelected) {clearSelection();setSelectedPackIds(new Set());}
        else {
            try {
                let fileIds = visibleFileIds;
                if (showFiles && totalSelectableFiles > visibleFileIds.length) {
                    const collected = new Set<number>();
                    const perPage = 100;
                    const totalPages = Math.ceil(totalSelectableFiles / perPage);
                    for (let requestedPage = 1; requestedPage <= totalPages; requestedPage += 1) {
                        const params:Record<string,unknown> = {page:requestedPage,per_page:perPage};
                        if (!hiddenOnly && !activeSavedFilterId && !searchQuery.trim() && effectiveFolderId !== undefined) params.folder_id = effectiveFolderId;
                        if (apiFileTypeFilter.length) params.file_type = apiFileTypeFilter.join(',');
                        if (searchQuery.trim()) params.search = searchQuery.trim();
                        if (sortValue) params.sort = sortValue;
                        if (favoriteOnly) params.favorite_only = true;
                        if (showHidden) params.include_hidden = true;
                        if (hiddenOnly) params.hidden_only = true;
                        const {data} = await api.get<{files:TelegramFile[]}>('/files',{params});
                        data.files.forEach(file=>collected.add(file.id));
                    }
                    fileIds = Array.from(collected);
                }
                selectAll(fileIds, visibleFolderIds);
                setSelectedPackIds(new Set(visiblePackIds));
            } catch {
                addToast('انتخاب همهٔ نتایج انجام نشد؛ دوباره تلاش کن.', 'error');
            }
        }
    };
    const sendSelectedToTelegram = async (destinationIds?:number[]) => {
        if (!selectedFilesForActions.length&&!selectedPacksForActions.length) return;
        if(destinationIds===undefined){setShowSendPicker(true);return}
        setSendingToTelegram(true);
        addToast('دارم فایل‌ها را به تلگرام می‌فرستم…', 'info');
        try {
            const packDetails=await Promise.all(selectedPacksForActions.map(pack=>api.get<Pack>(`/packs/${pack.id}`).then(response=>response.data)));
            const fileIds=Array.from(new Set([...selectedFilesForActions.map(item=>item.id),...packDetails.flatMap(pack=>pack.items.map(item=>item.file.id))]));
            if(!fileIds.length)throw new Error('جعبه‌های انتخاب‌شده خالی هستند.');
            let sent=0;const failed:number[]=[];
            for(let offset=0;offset<fileIds.length;offset+=50){const result=await sendFilesToTelegram(fileIds.slice(offset,offset+50),destinationIds);sent+=result.sent;failed.push(...result.failed)}
            const result={sent,failed};
            addToast(result.failed.length ? `${result.sent.toLocaleString('fa-IR')} فایل فرستاده شد؛ ${result.failed.length.toLocaleString('fa-IR')} مورد ناموفق بود.` : `${result.sent.toLocaleString('fa-IR')} فایل در تلگرام فرستاده شد.`);
            setShowSendPicker(false);
        } catch (error:any) {
            addToast(error?.response?.data?.detail || 'ارسال به تلگرام انجام نشد.', 'error');
        } finally { setSendingToTelegram(false); }
    };
    const clearFinishedImportJobs = async () => {
        try {
            await Promise.all([api.delete('/files/import-link/status'),api.delete('/files/import-drive/status')]);
            setImportJobs(jobs=>jobs.filter(job=>!['done','error','cancelled'].includes(job.state)));
            addToast('موارد پایان‌یافته از صف پاک شدند.');
        } catch { addToast('پاک‌کردن صف انجام نشد.', 'error'); }
    };
    const cancelSelection = () => {
        clearSelection();
        setSelectedPackIds(new Set());
        setSelectionMode(false);
    };
    const hideSelectedItems = async () => {
        if (!sessionStorage.getItem('komod-vault-token')) { addToast('برای مخفی‌کردن، اول گاوصندوق را از تنظیمات باز کن.', 'error'); return; }
        try {
            if (selectedFileIds.size) await batchUpdateFilesMutation.mutateAsync({ids:Array.from(selectedFileIds),is_hidden:true});
            for (const folder of (folders||[]).filter(item=>selectedFolderIds.has(item.id))) await updateFolderMutation.mutateAsync({id:folder.id,is_hidden:true});
            addToast(`${selectedFileIds.size+selectedFolderIds.size} مورد مخفی شد.`,'success'); cancelSelection();
        } catch(error:any) { addToast(error?.response?.data?.detail||'مخفی‌کردن انجام نشد.','error'); }
    };
    const beginHiddenPress = () => {
        hiddenPressTriggered.current=false;
        hiddenPressTimer.current=window.setTimeout(()=>{
            hiddenPressTriggered.current=true;
            setVaultPassword('');
            setShowVaultPrompt(true);
        },650);
    };
    const endHiddenPress=()=>{if(hiddenPressTimer.current!==null){window.clearTimeout(hiddenPressTimer.current);hiddenPressTimer.current=null;}};
    const toggleFavorites=()=>{if(hiddenPressTriggered.current){hiddenPressTriggered.current=false;return;}setActiveSavedFilterId(null);setFavoriteOnly(value=>!value);setPage(1);setAllFiles([]);};
    const showVaultItems = async () => {
        try {
            if(!sessionStorage.getItem('komod-vault-token')) await unlockVault.mutateAsync(vaultPassword);
            setShowHidden(true); setHiddenOnly(false); setPage(1); setAllFiles([]);
            setShowVaultPrompt(false); setVaultPassword('');
            requestAnimationFrame(()=>containerRef.current?.scrollTo({top:0,behavior:'smooth'}));
            addToast('موارد مخفی هم نمایش داده می‌شوند.');
        } catch(error:any) { addToast(error?.response?.data?.detail||'رمز گاوصندوق درست نیست.','error'); }
    };
    const closeVaultItems = useCallback(() => {
        setShowHidden(false);
        setHiddenOnly(false);
        sessionStorage.removeItem('komod-show-hidden');
        sessionStorage.removeItem('komod-hidden-only');
        setPage(1);
        setAllFiles([]);
        setShowVaultPrompt(false);
        requestAnimationFrame(()=>containerRef.current?.scrollTo({top:0}));
    }, []);
    const vaultAccessError = hiddenOnly && [filesError, foldersError, folderTreeError].some(error => [401, 403, 423].includes(Number((error as any)?.response?.status)));
    useEffect(() => {
        if (!vaultAccessError) return;
        closeVaultItems();
        sessionStorage.removeItem('komod-vault-token');
        addToast('دسترسی گاوصندوق منقضی شده؛ دوباره رمز را وارد کن.', 'error');
    }, [addToast, closeVaultItems, vaultAccessError]);
    const toggleSelectionMode = () => {
        const nextMode = !selectionMode;
        clearSelection();
        setSelectedPackIds(new Set());
        setSelectionMode(nextMode);
    };

    return (
        <div dir="rtl" className="flex h-screen bg-dark-950 text-white selection:bg-primary-500/30 overflow-hidden">
            {hiddenOnly && createPortal(<div className="fixed inset-x-3 top-[calc(env(safe-area-inset-top)+.75rem)] z-[270] mx-auto flex max-w-xl items-center gap-3 rounded-2xl border border-amber-300/25 bg-dark-950/95 p-2.5 text-amber-100 shadow-2xl backdrop-blur-xl"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-400/10"><EyeOff className="h-4 w-4"/></span><div className="min-w-0 flex-1"><strong className="block text-xs">فقط موارد مخفی</strong><span className="block truncate text-[10px] text-amber-100/60">{filesLoading||foldersLoading||folderTreeLoading?'در حال دریافت…':filesError||foldersError||folderTreeError?'نمایش موارد مخفی با خطا روبه‌رو شد':`${(shownFolderCount+shownFileCount).toLocaleString('fa-IR')} مورد`}</span></div><button type="button" onClick={closeVaultItems} className="flex min-h-9 shrink-0 items-center gap-1 rounded-xl bg-white/[.08] px-3 text-xs font-semibold hover:bg-white/[.13]" aria-label="خروج از نمایش موارد مخفی"><ChevronRight className="h-4 w-4"/>بازگشت</button></div>, document.body)}
            <Sidebar />

            <main className="relative flex min-w-0 flex-1 flex-col bg-gradient-to-br from-dark-950 to-dark-900 md:mr-24">
                {/* Header */}
                <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/[0.07] bg-dark-900/75 px-4 shadow-lg shadow-black/[.06] backdrop-blur-2xl sm:px-6">
                    <div className="flex items-center gap-3 md:gap-6 flex-1 min-w-0">
                        {activeSection === 'files' && breadcrumbs.length > 1 && (
                            <button
                                type="button"
                                onClick={navigateToParentFolder}
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-dark-800/80 text-white active:scale-95 sm:hidden"
                                aria-label="برگشت به کشوی قبلی"
                                title="کشوی قبلی"
                            >
                                <ChevronRight className="h-5 w-5" />
                            </button>
                        )}
                        {/* Search */}
                        {(activeSection === 'files' || activeSection === 'activity') && <div className="relative min-w-0 flex-1 max-w-[24rem]">
                            <Search className="pointer-events-none absolute right-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-dark-500" />
                            <input
                                type="text"
                                placeholder="جست‌وجو در کمد…"
                                value={searchQuery}
                                onChange={(e) => {setActiveSavedFilterId(null);setSearchQuery(e.target.value)}}
                                onKeyDown={event=>{if(event.key==='Enter'&&event.shiftKey&&activeSection==='files'){event.preventDefault();void runSmartSearch()}}}
                                className="input-search h-10 w-full pr-9 text-sm"
                            />
                            {activeSection==='files'&&<button type="button" onClick={()=>void runSmartSearch()} disabled={expandSmartSearch.isPending||searchQuery.trim().length<2} className={`absolute left-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md transition disabled:opacity-35 ${smartSearchQuery?'bg-primary-500/20 text-primary-200':'text-dark-400 hover:bg-white/[.06] hover:text-white'}`} title="جست‌وجوی هوشمند (Shift + Enter)" aria-label="جست‌وجوی هوشمند">{expandSmartSearch.isPending?<RefreshCw className="h-3.5 w-3.5 animate-spin"/>:<Sparkles className="h-3.5 w-3.5"/>}</button>}
                            {activeSection==='files'&&smartSearchQuery&&<div className="absolute inset-x-0 top-[calc(100%+.45rem)] z-50 flex items-center gap-2 rounded-xl border border-primary-400/15 bg-dark-900/95 px-2.5 py-2 text-[11px] text-primary-100 shadow-xl backdrop-blur-xl"><Sparkles className="h-3.5 w-3.5 shrink-0"/><span className="min-w-0 flex-1 truncate">هوشمند: {smartSearchTerms.length?smartSearchTerms.join('، '):'عبارت اصلی'}</span><button type="button" onClick={()=>{setSmartSearchQuery(null);setSmartSearchTerms([]);setPage(1);setAllFiles([])}} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-white/10" aria-label="بازگشت به جست‌وجوی عادی"><X className="h-3.5 w-3.5"/></button></div>}
                            {activeSection === 'files' && searchQuery.trim() === debouncedSearchQuery && filesList?.search_mode === 'fuzzy' && Boolean(filesList.suggestions?.length) && <div className="absolute inset-x-0 top-[calc(100%+.45rem)] z-50 rounded-2xl border border-white/[.09] bg-dark-900/95 p-2 shadow-2xl backdrop-blur-xl">
                                <p className="px-2 pb-1.5 text-[11px] text-dark-400">نتیجهٔ دقیق پیدا نشد؛ شاید منظورت این‌هاست:</p>
                                <div className="flex flex-wrap gap-1.5">{filesList.suggestions!.map(suggestion=><button key={suggestion} type="button" onClick={()=>{setActiveSavedFilterId(null);setSearchQuery(suggestion)}} className="max-w-full truncate rounded-xl bg-primary-500/10 px-2.5 py-1.5 text-xs text-primary-200 transition hover:bg-primary-500/20">{suggestion}</button>)}</div>
                            </div>}
                        </div>}
                        {activeSection === 'playlists' && <span className="truncate text-sm font-semibold text-white">🎧 پلی‌لیست‌ها</span>}
                        {activeSection === 'settings' && <span className="truncate text-sm font-semibold text-white">⚙️ تنظیمات</span>}
                        {activeSection === 'downloads' && <span className="truncate text-sm font-semibold text-white">📥 دانلودها</span>}

                        {/* Vertical Div */}
                        <div className="hidden sm:block w-px h-6 bg-white/[0.1]"></div>

                        {/* Breadcrumbs */}
                        {activeSection === 'files' && <nav className="flex items-center gap-0.5 overflow-hidden hidden sm:flex">
                            {breadcrumbs.map((crumb, index) => (
                                <div key={crumb.id || 'root'} className="flex items-center min-w-0">
                                    {index > 0 && <ChevronRight className="w-4 h-4 text-dark-600 mx-1 shrink-0 rotate-180" />}
                                    <button
                                        onClick={() => navigateToBreadcrumb(index)}
                                        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-sm truncate max-w-[150px] transition-colors ${index === breadcrumbs.length - 1
                                            ? 'text-white font-medium bg-white/[0.05]'
                                            : 'text-dark-400 hover:text-white hover:bg-white/[0.05]'
                                            }`}
                                    >
                                        {index === 0 && <Home className="w-3.5 h-3.5 shrink-0" />}
                                        <span className="truncate">{crumb.name}</span>
                                    </button>
                                </div>
                            ))}
                        </nav>}
                    </div>

                    {/* Right: Actions */}
                    <div className="mr-2 flex shrink-0 items-center gap-1 sm:mr-4 sm:gap-2">
                        {activeSection === 'files' && hiddenOnly && <button onClick={closeVaultItems} className="flex h-10 shrink-0 items-center gap-2 rounded-xl border border-amber-400/25 bg-amber-500/10 px-2.5 text-xs text-amber-100 transition hover:bg-amber-500/15" title="خروج از نمایش موارد مخفی"><ChevronRight className="h-4 w-4"/><span className="hidden sm:inline">بازگشت به کمد</span></button>}
                        {activeSection!=='settings'&&<button onClick={toggleConnectionMode} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border p-0 leading-none transition ${forceOffline?'border-primary-400/30 bg-primary-500/15 text-primary-200':'border-white/[.08] bg-dark-800/70 text-dark-300 hover:text-white'}`} title={forceOffline?'رفتن به حالت آنلاین':'رفتن به حالت آفلاین'} aria-label={forceOffline?'فعال‌کردن حالت آنلاین':'فعال‌کردن حالت آفلاین'}>{forceOffline?<CloudOff className="block h-5 w-5"/>:<Cloud className="block h-5 w-5"/>}</button>}
                        {clipboard && (clipboard.files.length > 0 || clipboard.folders.length > 0) && (
                            <button
                                onClick={handlePaste}
                                className="mr-2 btn-secondary py-1.5 px-3 text-xs flex items-center gap-2 bg-primary-500/10 text-primary-300 border-primary-500/20 hover:bg-primary-500/20"
                            >
                                <Clipboard className="w-3.5 h-3.5" />
                                انتقال به اینجا ({clipboard.files.length + clipboard.folders.length})
                            </button>
                        )}

                        {activeSection === 'files' && !readOnlyWorkspace && (
                            <>
                                <input ref={uploadInputRef} type="file" multiple className="hidden" onChange={handleWebUpload} />
                                <button type="button" onClick={() => setShowAddMenu(true)} className="btn-primary flex h-10 items-center gap-2 px-3 py-0 text-sm shadow-lg shadow-primary-500/20"><Plus className="h-4 w-4"/><span className="hidden sm:inline">افزودن به کمد</span></button>
                            </>
                        )}
                    </div>
                </header>

                {/* Content Area */}
                <div
                    ref={containerRef}
                    data-main-scroll="true"
                    className={`relative flex-1 overflow-auto overscroll-y-contain p-4 pb-28 outline-none transition sm:p-6 md:pb-6 lg:p-8 ${isFileDragOver?'ring-2 ring-inset ring-primary-400/60 bg-primary-500/[.04]':''}`}
                    style={{ overscrollBehaviorY: 'contain' }}
                    onTouchStart={handlePullStart}
                    onTouchMove={handlePullMove}
                    onTouchEnd={handlePullEnd}
                    onTouchCancel={handlePullEnd}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    tabIndex={0}
                    onDragEnter={event=>{if(event.dataTransfer.types.includes('Files'))setIsFileDragOver(true)}}
                    onDragOver={event=>{event.preventDefault();if(event.dataTransfer.types.includes('Files'))event.dataTransfer.dropEffect='copy'}}
                    onDragLeave={event=>{if(event.currentTarget===event.target)setIsFileDragOver(false)}}
                    onDrop={handleExternalFileDrop}
                >
                    {isFileDragOver&&<div className="pointer-events-none fixed inset-4 z-[220] flex items-center justify-center rounded-3xl border-2 border-dashed border-primary-400/60 bg-dark-950/80 backdrop-blur-sm"><div className="text-center"><Upload className="mx-auto h-10 w-10 text-primary-300"/><p className="mt-3 font-bold">فایل‌ها را اینجا رها کن</p><p className="mt-1 text-xs text-dark-400">چند فایل با هم هم پشتیبانی می‌شود</p></div></div>}
                    {pullEnabled && pullDistance > 0 && <div className="pointer-events-none fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-full border border-white/10 bg-dark-900/95 px-3 py-1.5 text-xs text-primary-200 shadow-xl backdrop-blur" style={{ transform: `translate(-50%, ${pullDistance / 3}px)` }}>{pullDistance >= 52 ? 'رها کن تا تازه بشه ✨' : 'برای تازه‌سازی پایین بکش'}</div>}
                    {!readOnlyWorkspace && (selectionMode || selectedItemCount > 0) && activeSection === 'files' && (
                        <div className="fixed inset-x-4 top-20 z-40 mx-auto flex min-h-14 w-auto max-w-7xl flex-nowrap items-center gap-1 overflow-x-auto rounded-2xl border border-primary-500/25 bg-dark-900/95 p-1.5 shadow-2xl backdrop-blur-xl sm:hidden">
                            <span className="shrink-0 px-2 text-xs font-semibold text-primary-200">{selectedItemCount ? `${selectedItemCount.toLocaleString('fa-IR')} انتخاب` : 'یک کارت را لمس کن'}</span>
                            {selectedItems.length === 1&&selectedPacksForActions.length===0 && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-dark-200 hover:bg-white/10" aria-label="تغییر نام" title="تغییر نام" onClick={() => selectedFilesForActions[0] ? setRenameFile(selectedFilesForActions[0]) : setRenameFolder(selectedFoldersForActions[0])}><Pencil className="h-5 w-5" /></button>}
                            {selectedFilesForActions.length > 0 && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-dark-200 hover:bg-white/10" aria-label="تگ‌ها و ویرایش گروهی" title="افزودن، حذف یا جایگزینی تگ‌ها" onClick={() => setShowBatchEdit(true)}><Tags className="h-5 w-5" /></button>}
                            {selectedTextFilesForActions.length > 1 && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-primary-200 hover:bg-primary-500/10" aria-label="ترکیب متن‌ها" title="ساخت یک فایل از متن‌های انتخابی" onClick={()=>setShowCombineTexts(true)}><Combine className="h-5 w-5"/></button>}
                            {selectedFileIds.size>=2&&<button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-primary-200 hover:bg-primary-500/10" aria-label="انتخاب فایل‌های میانی" title="انتخاب همه فایل‌های بین اولین و آخرین انتخاب" onClick={selectFileRange}><ListChecks className="h-5 w-5"/></button>}
                            {selectedFilesForActions.length > 0 && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-violet-200 hover:bg-violet-500/10" aria-label="ساخت جعبه" title="قرار دادن فایل‌های انتخابی در یک جعبه" onClick={() => setShowCreatePack(true)}><Boxes className="h-5 w-5" /></button>}
                            {selectedPlayableFilesForActions.length > 0 && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-emerald-300 hover:bg-emerald-500/10" aria-label="ساخت صف پخش موقت" title="پخش پشت‌سرهم فایل‌های انتخاب‌شده" onClick={() => { startQueue(selectedPlayableFilesForActions,0); cancelSelection(); addToast('صف پخش موقت ساخته شد.'); }}><Play className="h-5 w-5" /></button>}
                            {selectedPlayableFilesForActions.length > 0 && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-200 hover:bg-primary-500/20" aria-label="افزودن به پلی‌لیست" title="افزودن فایل‌های صدا و ویدیو به پلی‌لیست" onClick={() => setPlaylistFiles(selectedPlayableFilesForActions)}><ListPlus className="h-5 w-5" /></button>}
                            {selectedFilesForActions.length > 0 && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-primary-200 hover:bg-primary-500/10" aria-label="ذخیره آفلاین" title="افزودن همه به صف ذخیره آفلاین" onClick={() => { selectedFilesForActions.forEach(file => void saveFileOffline(file)); addToast(`${selectedFilesForActions.length.toLocaleString('fa-IR')} فایل به صف ذخیره آفلاین اضافه شد.`); }}><DownloadCloud className="h-5 w-5" /></button>}
                             {selectedFilesForActions.length > 0 && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-dark-200 hover:bg-white/10" aria-label="دانلود" title="دانلود فایل‌های انتخاب‌شده" onClick={() => void downloadSelectedFiles()}><Download className="h-5 w-5" /></button>}
                             {(selectedFilesForActions.length > 0||selectedPacksForActions.length>0) && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sky-300 hover:bg-sky-500/10" aria-label="ارسال به تلگرام" title="ارسال فایل‌ها و جعبه‌های انتخاب‌شده به تلگرام" onClick={() => void sendSelectedToTelegram()}><Send className="h-5 w-5" /></button>}
                            <button disabled={!selectedItems.length} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-dark-200 hover:bg-white/10 disabled:opacity-30" aria-label="مخفی‌کردن" title="انتقال انتخاب‌ها به گاوصندوق" onClick={()=>void hideSelectedItems()}><EyeOff className="h-5 w-5"/></button>
                            <button disabled={!selectedItems.length} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-dark-200 hover:bg-white/10 disabled:opacity-30" aria-label="جابه‌جایی" title="جابه‌جایی" onClick={() => setMoveItems({ files: selectedFilesForActions, folders: selectedFoldersForActions })}><FolderInput className="h-5 w-5" /></button>
                            <button disabled={!selectedItems.length} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-red-300 hover:bg-red-500/10 disabled:opacity-30" aria-label="حذف" title="حذف" onClick={() => setDeleteConfirm({ type: selectedFoldersForActions.length && selectedFilesForActions.length ? 'multiple' : selectedFoldersForActions.length ? 'folder' : 'file', items: selectedItems })}><Trash2 className="h-5 w-5" /></button>
                            <button className="mr-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-dark-300 hover:bg-white/10" aria-label="پایان انتخاب گروهی" title="پایان انتخاب" onClick={cancelSelection}><X className="h-5 w-5" /></button>
                        </div>
                    )}
                    {activeSection === 'playlists' ? <Suspense fallback={<SectionFallback/>}><PlaylistBrowser /></Suspense> : activeSection === 'settings' ? <Suspense fallback={<SectionFallback/>}><SettingsPage /></Suspense> : activeSection === 'downloads' ? <Suspense fallback={<SectionFallback/>}><DownloadsPage /></Suspense> : <>
                    <div className="max-w-7xl mx-auto mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                            <h1 className="truncate text-2xl font-bold tracking-tight text-white sm:text-3xl">{sectionTitle}</h1>
                            {activeSection !== 'activity' && <span className="shrink-0 rounded-full border border-white/[0.07] bg-dark-800/70 px-2.5 py-1 text-xs text-dark-300">{(shownFolderCount + shownPackCount + shownFileCount).toLocaleString('fa-IR')} مورد</span>}
                        </div>
                        {selectedItemCount > 0 ? (
                            <div className="fixed left-6 right-6 top-20 z-40 mx-auto hidden max-w-7xl flex-wrap items-center gap-1.5 rounded-2xl border border-primary-500/20 bg-dark-900/95 p-1.5 shadow-2xl backdrop-blur-xl sm:flex md:right-32 lg:left-8">
                                <span className="text-sm font-medium text-primary-200 px-2">{selectedItemCount.toLocaleString('fa-IR')} مورد انتخاب شده</span>
                                {selectedItems.length === 1&&selectedPacksForActions.length===0 && <button className="btn-secondary shrink-0 text-sm flex items-center gap-2" onClick={() => selectedFilesForActions[0] ? setRenameFile(selectedFilesForActions[0]) : setRenameFolder(selectedFoldersForActions[0])}><Pencil className="w-4 h-4" /> تغییر نام</button>}
                                {selectedFilesForActions.length > 0 && <button className="btn-secondary shrink-0 text-sm flex items-center gap-2" onClick={() => setShowBatchEdit(true)}><Tags className="w-4 h-4" /> تگ‌ها و ویرایش</button>}
                                {selectedTextFilesForActions.length > 1 && <button className="btn-secondary shrink-0 text-sm flex items-center gap-2 text-primary-200" onClick={()=>setShowCombineTexts(true)}><Combine className="h-4 w-4"/> ترکیب متن‌ها</button>}
                                {selectedFileIds.size>=2&&<button className="btn-secondary shrink-0 text-sm flex items-center gap-2 text-primary-200" onClick={selectFileRange}><ListChecks className="h-4 w-4"/> انتخاب فاصله</button>}
                                {selectedFilesForActions.length > 0 && <button className="btn-secondary shrink-0 text-sm flex items-center gap-2 text-violet-200" onClick={() => setShowCreatePack(true)}><Boxes className="w-4 h-4" /> ساخت جعبه</button>}
                                {selectedPlayableFilesForActions.length > 0 && <button className="btn-secondary shrink-0 text-sm flex items-center gap-2 text-emerald-200" onClick={() => { startQueue(selectedPlayableFilesForActions,0); cancelSelection(); addToast('صف پخش موقت ساخته شد.'); }}><Play className="w-4 h-4" /> پخش پشت‌سرهم</button>}
                                {selectedPlayableFilesForActions.length > 0 && <button className="btn-secondary shrink-0 text-sm flex items-center gap-2" onClick={() => setPlaylistFiles(selectedPlayableFilesForActions)}><ListPlus className="w-4 h-4" /> افزودن به پلی‌لیست</button>}
                                {selectedFilesForActions.length > 0 && <button className="btn-secondary shrink-0 text-sm flex items-center gap-2" onClick={() => { selectedFilesForActions.forEach(file => void saveFileOffline(file)); addToast(`${selectedFilesForActions.length.toLocaleString('fa-IR')} فایل به صف ذخیره آفلاین اضافه شد.`); }}><DownloadCloud className="w-4 h-4" /> ذخیره آفلاین</button>}
                                 {selectedFilesForActions.length > 0 && <button className="btn-secondary shrink-0 text-sm flex items-center gap-2" onClick={() => void downloadSelectedFiles()}><Download className="w-4 h-4" /> دانلود</button>}
                                 {(selectedFilesForActions.length > 0||selectedPacksForActions.length>0) && <button className="btn-secondary shrink-0 text-sm flex items-center gap-2 text-sky-200" onClick={() => void sendSelectedToTelegram()}><Send className="w-4 h-4" /> ارسال به تلگرام</button>}
                                {selectedItems.length>0&&<button className="btn-secondary shrink-0 text-sm flex items-center gap-2" onClick={()=>void hideSelectedItems()}><EyeOff className="w-4 h-4"/> مخفی‌کردن</button>}
                                {selectedItems.length>0&&<button className="btn-secondary shrink-0 text-sm flex items-center gap-2" onClick={() => setMoveItems({ files: selectedFilesForActions, folders: selectedFoldersForActions })}><FolderInput className="w-4 h-4" /> جابه‌جایی</button>}
                                {selectedItems.length>0&&<button className="btn-secondary shrink-0 text-sm flex items-center gap-2 text-red-300" onClick={() => setDeleteConfirm({ type: selectedFoldersForActions.length && selectedFilesForActions.length ? 'multiple' : selectedFoldersForActions.length ? 'folder' : 'file', items: selectedItems })}><Trash2 className="w-4 h-4" /> حذف</button>}
                                <button className="btn-icon shrink-0" title="پایان انتخاب" onClick={cancelSelection}><X className="w-4 h-4" /></button>
                            </div>
                        ) : null}
                    </div>
                    {activeSection === 'files' && activeSharedWorkspace && <div className="mx-auto mb-3 flex max-w-7xl items-center gap-3 rounded-2xl border border-primary-400/20 bg-primary-500/[.07] px-3 py-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary-500/15">🤝</span><div className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm text-primary-100">فضای {activeSharedWorkspace.name}</strong><p className="text-xs text-primary-100/60">{activeSharedWorkspace.permission==='write'?'اجازهٔ مشاهده و ذخیره داری':'این فضا فقط قابل مشاهده است'}</p></div><button className="rounded-xl bg-white/[.06] px-3 py-2 text-xs" onClick={()=>{localStorage.removeItem('komod-active-workspace');localStorage.removeItem('komod-active-workspace-permission');window.location.reload()}}>کمد من</button></div>}
                    {activeSection === 'files' && hiddenOnly && <div className="mx-auto mb-4 flex max-w-7xl items-center gap-3 rounded-2xl border border-amber-400/20 bg-amber-500/[.07] p-3 shadow-lg shadow-black/5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-400/10 text-amber-200"><EyeOff className="h-5 w-5"/></span><div className="min-w-0 flex-1"><strong className="block text-sm text-amber-100">فقط موارد مخفی</strong><p className="mt-0.5 truncate text-xs text-amber-100/60">{shownFolderCount+shownFileCount ? `${(shownFolderCount+shownFileCount).toLocaleString('fa-IR')} مورد پیدا شد` : 'مورد مخفی‌ای در این بخش نیست'}</p></div><button onClick={closeVaultItems} className="flex min-h-10 shrink-0 items-center gap-2 rounded-xl bg-white/[.07] px-3 text-xs text-white transition hover:bg-white/[.12]"><ChevronRight className="h-4 w-4"/> بازگشت به کمد</button></div>}
                    {activeSection === 'files' && (
                        <div className="max-w-7xl mx-auto mb-4">
                            <div className="flex flex-col gap-2">
                                <div className="grid grid-cols-3 gap-1 rounded-xl bg-dark-900/70 p-1" aria-label="انتخاب نوع محتوا">
                                    {([
                                        ['all', 'همه', Boxes],
                                        ['files', 'فایل‌ها', FileText],
                                        ['folders', 'کشوها', FolderIcon],
                                    ] as const).map(([scope, label, Icon]) => (
                                        <button key={scope} onClick={() => selectScope(scope)} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm transition-all ${contentScope === scope ? 'bg-primary-600 text-white shadow-md' : 'text-dark-400 hover:bg-white/[0.05] hover:text-white'}`}>
                                            <Icon className="h-4 w-4" />
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                {savedFilters.length>0&&<div className="rounded-2xl border border-white/[.06] bg-dark-900/45 p-2">
                                    <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
                                        {savedFilters.map(filter=><div key={filter.id} className={`flex shrink-0 items-center rounded-xl border transition ${activeSavedFilterId===filter.id?'border-primary-400/35 bg-primary-500/15 text-primary-100':'border-white/[.07] bg-white/[.025] text-dark-300'}`}>
                                            <button type="button" onClick={()=>applySavedFilter(filter)} className="flex min-h-9 items-center gap-2 px-3 text-xs font-medium"><Sparkles className="h-3.5 w-3.5"/><span>{filter.name}</span></button>
                                            <button type="button" onClick={()=>void removeSavedFilter(filter.id)} className="ml-1 flex h-7 w-7 items-center justify-center rounded-lg text-dark-500 hover:bg-red-500/10 hover:text-red-300" title="حذف کشوی هوشمند"><X className="h-3.5 w-3.5"/></button>
                                        </div>)}
                                    </div>
                                </div>}
                                <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/[0.06] bg-dark-900/55 p-1.5 shadow-sm">
                                    <div className="flex min-w-0 flex-wrap items-center gap-1 rounded-xl border border-white/[.07] bg-dark-950/60 p-1">
                                    <button title="تازه‌سازی" aria-label="تازه‌سازی" onClick={handleRefresh} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-dark-400 hover:text-white"><RefreshCw className={`h-4 w-4 ${filesFetching ? 'animate-spin' : ''}`}/></button>
                                    <button title="فیلتر نوع فایل" aria-label="فیلتر نوع فایل" onClick={() => { setShowFilters(value => !value); setShowSort(false); }} disabled={contentScope === 'folders'} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${fileTypeFilter.length || showFilters ? 'bg-primary-600 text-white shadow' : 'text-dark-400 hover:text-white'}`}>
                                        <SlidersHorizontal className="h-4 w-4" />
                                        {fileTypeFilter.length > 0 && <span className="rounded-full bg-primary-500 px-1.5 text-[10px] text-white">{fileTypeFilter.length.toLocaleString('fa-IR')}</span>}
                                    </button>
                                    <button title="مرتب‌سازی" aria-label="مرتب‌سازی" onClick={() => { setShowSort(value => !value); setShowFilters(false); }} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs transition-colors ${showSort ? 'bg-primary-600 text-white shadow' : 'text-dark-400 hover:text-white'}`}>
                                        <ArrowDown className="h-4 w-4" />
                                    </button>
                                    <button title="فقط نشان‌شده‌ها؛ نگه‌داشتن برای موارد مخفی" aria-label="فقط نشان‌شده‌ها" onPointerDown={beginHiddenPress} onPointerUp={endHiddenPress} onPointerCancel={endHiddenPress} onPointerLeave={endHiddenPress} onClick={toggleFavorites} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs transition-colors ${showHidden?'ring-1 ring-primary-400/50':favoriteOnly?'bg-amber-400/15 text-amber-200':'text-dark-400 hover:text-white'}`}><Star className={`h-4 w-4 ${favoriteOnly ? 'fill-current' : ''}`}/></button>
                                    {!readOnlyWorkspace && <button title="انتخاب گروهی" aria-label="انتخاب گروهی" onClick={toggleSelectionMode} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs transition-colors ${selectionMode ? 'bg-primary-600 text-white shadow' : 'text-dark-400 hover:text-white'}`}>
                                        <ListChecks className="h-4 w-4" />
                                    </button>}
                                    {!readOnlyWorkspace && (selectionMode || selectedItems.length > 0) && (
                                        <button onClick={toggleSelectAll} disabled={visibleItemCount === 0} title={allVisibleSelected ? 'لغو انتخاب همه' : 'انتخاب همه'} aria-label={allVisibleSelected ? 'لغو انتخاب همه' : 'انتخاب همه'} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs transition-colors disabled:opacity-40 ${allVisibleSelected ? 'bg-primary-600 text-white shadow' : 'text-dark-400 hover:text-white'}`}>
                                            {allVisibleSelected ? <CheckSquare className="h-4 w-4 text-primary-300" /> : <Square className="h-4 w-4" />}
                                        </button>
                                    )}
                                    </div>
                                    <div className="flex shrink-0 items-center rounded-xl border border-white/[.07] bg-dark-950/60 p-1">
                                    <button title="نمای کارتی بزرگ" aria-label="نمای کارتی بزرگ" onClick={() => setViewMode('grid')} className={`flex h-8 w-8 items-center justify-center rounded-lg ${viewMode === 'grid' ? 'bg-primary-600 text-white shadow' : 'text-dark-400 hover:text-white'}`}><Grid className="h-4 w-4" /></button>
                                    <button title="نمای کاشی متراکم" aria-label="نمای کاشی متراکم" onClick={() => setViewMode('dense')} className={`flex h-8 w-8 items-center justify-center rounded-lg ${viewMode === 'dense' ? 'bg-primary-600 text-white shadow' : 'text-dark-400 hover:text-white'}`}><LayoutGrid className="h-4 w-4" /></button>
                                    <button title="نمای لیستی" aria-label="نمای لیستی" onClick={() => setViewMode('list')} className={`flex h-8 w-8 items-center justify-center rounded-lg ${viewMode === 'list' ? 'bg-primary-600 text-white shadow' : 'text-dark-400 hover:text-white'}`}><List className="h-4 w-4" /></button>
                                    </div>
                                </div>
                            </div>
                            {showFilters && contentScope !== 'folders' && (
                                <div className="mt-3 border-t border-white/[0.06] pt-3">
                                    <div className="grid grid-cols-6 overflow-hidden rounded-xl border border-white/[.07] bg-dark-950/60 p-1">
                                        {([
                                            ['ویدیو', 'video', Film], ['موسیقی و صدا', 'audio', Music],
                                            ['عکس', 'image', ImageIcon], ['سند', 'document', FileText], ['متن و یادداشت', 'text', StickyNote], ['جعبه', 'pack', Boxes],
                                        ] as const).map(([label, type, Icon]) => (
                                            <button key={type} title={label} aria-label={label} onClick={() => toggleFileType(type)} className={`flex h-9 min-w-0 items-center justify-center rounded-lg transition-colors ${fileTypeFilter.includes(type) ? 'bg-primary-600 text-white shadow' : 'text-dark-400 hover:bg-white/[.05] hover:text-white'}`}>
                                                <Icon className="h-4 w-4" />
                                            </button>
                                        ))}
                                    </div>
                                    {fileTypeFilter.length > 0 && <button title="پاک‌کردن فیلترها" aria-label="پاک‌کردن فیلترها" onClick={() => toggleFileType(null)} className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-xl text-xs text-red-300 hover:bg-red-500/10"><X className="h-4 w-4"/> پاک‌کردن فیلترها</button>}
                                    {!showSaveFilter&&<button type="button" onClick={()=>setShowSaveFilter(true)} className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-xl border border-primary-400/15 bg-primary-500/[.07] text-xs text-primary-200 hover:bg-primary-500/15"><BookmarkPlus className="h-4 w-4"/> ساخت کشوی هوشمند از این فیلتر</button>}
                                    {showSaveFilter&&<div className="mt-2 flex items-center gap-2 border-t border-white/[.06] pt-2"><input autoFocus value={savedFilterName} onChange={event=>setSavedFilterName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')void saveCurrentFilter()}} className="input h-10 min-w-0 flex-1" placeholder="نام کشوی هوشمند" maxLength={40}/><button disabled={updateSavedFilters.isPending} onClick={()=>void saveCurrentFilter()} className="btn-primary h-10 shrink-0 px-3 text-xs">ساخت</button><button onClick={()=>{setShowSaveFilter(false);setSavedFilterName('')}} className="btn-icon h-10 w-10 shrink-0"><X className="h-4 w-4"/></button></div>}
                                </div>
                            )}
                            {showSort && (
                                <div className="mt-3 border-t border-white/[0.06] pt-3">
                                    <div className="mb-3 flex items-center justify-between gap-3">
                                        <p className="text-sm font-medium text-white">مرتب‌سازی</p>
                                        <button onClick={() => {setActiveSavedFilterId(null);setSortCriteria([{ field: 'created', direction: 'desc' }])}} className="shrink-0 text-xs text-dark-400 hover:text-white">حالت پیش‌فرض</button>
                                    </div>
                                    <div className="grid gap-1.5">
                                        {sortCriteria.map((item, index) => (
                                            <div key={item.field} className="flex min-w-0 items-center gap-1 rounded-xl border border-white/[0.08] bg-dark-800/60 p-1.5">
                                                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-500/15 text-primary-300"><ArrowDown className="h-3.5 w-3.5"/></span>
                                                <span className="min-w-0 flex-1 truncate text-xs sm:text-sm">{sortLabels[item.field]}</span>
                                                <button className="shrink-0 rounded-lg bg-dark-700 px-2 py-1.5 text-xs hover:bg-dark-600" onClick={() => updateSort(index, { ...item, direction: item.direction === 'asc' ? 'desc' : 'asc' })}>
                                                    {item.direction === 'asc' ? <><ArrowUp className="inline h-3.5 w-3.5" /> صعودی</> : <><ArrowDown className="inline h-3.5 w-3.5" /> نزولی</>}
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                    {availableSortFields.length > 0 && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                                        {availableSortFields.map(field => <button key={field} className="flex min-h-10 items-center justify-center rounded-xl border border-white/10 bg-dark-800 px-2 text-xs text-dark-300 hover:border-primary-500/30 hover:text-white" onClick={() => {setActiveSavedFilterId(null);setSortCriteria([{ field, direction: field==='created'||field==='updated'?'desc':'asc' }])}}>{sortLabels[field]}</button>)}
                                    </div>}
                                </div>
                            )}
                        </div>
                    )}
                    {activeSection === 'activity' && (
                        <div className="mx-auto mb-4 flex max-w-7xl justify-end">
                            <div className="flex items-center gap-1 rounded-xl border border-white/[0.06] bg-dark-900/50 p-1" aria-label="تغییر نمای فعالیت">
                                <button title="نمای کارتی بزرگ" aria-label="نمای کارتی بزرگ" onClick={() => setViewMode('grid')} className={`flex h-9 w-9 items-center justify-center rounded-full ${viewMode === 'grid' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:bg-white/[0.05] hover:text-white'}`}><Grid className="h-4 w-4" /></button>
                                <button title="نمای کاشی متراکم" aria-label="نمای کاشی متراکم" onClick={() => setViewMode('dense')} className={`flex h-9 w-9 items-center justify-center rounded-full ${viewMode === 'dense' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:bg-white/[0.05] hover:text-white'}`}><LayoutGrid className="h-4 w-4" /></button>
                                <button title="نمای لیستی" aria-label="نمای لیستی" onClick={() => setViewMode('list')} className={`flex h-9 w-9 items-center justify-center rounded-full ${viewMode === 'list' ? 'bg-primary-600 text-white' : 'text-dark-400 hover:bg-white/[0.05] hover:text-white'}`}><List className="h-4 w-4" /></button>
                            </div>
                        </div>
                    )}
                    {activeSection === 'activity' ? (
                        <div className="mx-auto max-w-7xl space-y-8 pb-20">
                            {isLoading && displayFiles?.length === 0 ? (
                                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                                    {[...Array(6)].map((_, i) => <div key={i} className="aspect-video animate-pulse rounded-xl bg-dark-800/50" />)}
                                </div>
                            ) : activityError ? (
                                <div className="flex flex-col items-center justify-center rounded-3xl border border-red-500/15 bg-red-500/[0.04] px-5 py-14 text-center">
                                    <div className="mb-4 text-4xl">🧭</div>
                                    <h3 className="text-lg font-bold text-white">فعالیت‌ها بارگذاری نشد</h3>
                                    <p className="mt-2 max-w-sm text-sm leading-7 text-dark-400">ارتباط با کمد برقرار نشد. دوباره تلاش کن تا ادامه پخش و فایل‌های تازه را بیاورم.</p>
                                    <button className="btn-primary mt-5" onClick={handleRefresh}>تلاش دوباره</button>
                                </div>
                            ) : displayFiles?.length === 0 ? (
                                <div className="flex flex-col items-center justify-center px-5 py-14 text-center">
                                    <div className="mb-4 text-5xl">⏱️</div>
                                    <h3 className="text-xl font-bold text-white">هنوز فعالیتی ثبت نشده</h3>
                                    <p className="mt-2 max-w-sm text-sm leading-7 text-dark-400">با باز کردن یک آهنگ یا ویدیو، ادامه پخشش اینجا می‌آید. فایل‌های تازه هم در همین صفحه دیده می‌شوند.</p>
                                </div>
                            ) : (
                                <>
                                    {continueWatchingFiles.length > 0 && (
                                        <section>
                                            <div className="mb-3 flex items-end justify-between gap-3">
                                                <div><h2 className="text-lg font-bold text-white">▶️ ادامه پخش</h2><p className="mt-1 text-xs text-dark-400">از همان جایی که رها کردی ادامه بده</p></div>
                                                <span className="text-xs text-dark-500">{continueWatchingFiles.length.toLocaleString('fa-IR')} مورد</span>
                                            </div>
                                            <div className={viewMode === 'list' ? 'flex flex-col gap-2' : viewMode === 'dense' ? 'grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8' : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'}>
                                                {continueWatchingFiles.map(file => <FileCard key={file.id} file={file} viewMode={viewMode} selected={false} selectionMode={false} onSelect={() => undefined} onPlay={() => handleFileOpen(file)} />)}
                                            </div>
                                        </section>
                                    )}
                                    {recentlyAddedFiles.length > 0 && (
                                        <section>
                                            <div className="mb-3 flex items-end justify-between gap-3">
                                                <div><h2 className="text-lg font-bold text-white">✨ تازه‌های کمد</h2><p className="mt-1 text-xs text-dark-400">فایل‌هایی که به‌تازگی اضافه شده‌اند</p></div>
                                                <span className="text-xs text-dark-500">{recentlyAddedFiles.length.toLocaleString('fa-IR')} مورد</span>
                                            </div>
                                            <div className={viewMode === 'list' ? 'flex flex-col gap-2' : viewMode === 'dense' ? 'grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8' : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'}>
                                                {recentlyAddedFiles.map(file => <FileCard key={file.id} file={file} viewMode={viewMode} selected={false} selectionMode={false} onSelect={() => undefined} onPlay={() => handleFileOpen(file)} />)}
                                            </div>
                                        </section>
                                    )}
                                </>
                            )}
                        </div>
                    ) : isLoading && !displayFiles ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 animate-fade-in">
                            {[...Array(10)].map((_, i) => (
                                <div key={i} className="aspect-video bg-dark-800/50 rounded-xl animate-pulse"></div>
                            ))}
                        </div>
                    ) : (
                        <>
                             {/* Unified View */}
                             {shownFolderCount + shownPackCount + shownFileCount > 0 ? (
                                <div className={viewMode === 'list' ? 'max-w-7xl mx-auto flex flex-col gap-2 pb-20' : viewMode === 'dense' ? 'max-w-7xl mx-auto grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-2 pb-20' : 'max-w-7xl mx-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 pb-20'}>
                                    {/* Folders */}
                                    {showFolders && visibleFolders?.map((folder) => (
                                        <FolderCard
                                            key={folder.id}
                                            folder={folder}
                                            viewMode={viewMode}
                                            selected={selectedFolderIds.has(folder.id)}
                                            selectionMode={selectionMode}
                                            onSelect={(multi) => { if (multi) setSelectionMode(true); selectFolder(folder.id, multi); }}
                                            onOpen={() => navigateToFolder(folder)}
                                            onFileDrop={handleFileDrop}
                                        />
                                    ))}

                                    {/* Mixed-media packs live beside folders. */}
                                    {showPacks && visiblePacks.map(pack => <PackCard key={`pack-${pack.id}`} pack={pack} viewMode={viewMode} selected={selectedPackIds.has(pack.id)} selectionMode={selectionMode} onSelect={()=>{setSelectionMode(true);setSelectedPackIds(current=>{const next=new Set(current);if(next.has(pack.id))next.delete(pack.id);else next.add(pack.id);return next})}} onOpen={()=>setOpenPackId(pack.id)}/>)}

                                    {/* Files */}
                                    {showFiles && displayFiles?.map((file) => (
                                        <FileCard
                                            key={file.id}
                                            file={file}
                                            viewMode={viewMode}
                                            selected={selectedFileIds.has(file.id)}
                                            selectionMode={selectionMode}
                                            onSelect={(multi) => { if (multi) setSelectionMode(true); selectFile(file.id, selectionMode || multi); }}
                                            onPlay={() => handleFileOpen(file)}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-center pb-20 animate-fade-in">
                                    <div className="w-24 h-24 rounded-3xl bg-dark-800/50 flex items-center justify-center border border-white/[0.04] mb-6 shadow-2xl">
                                        <ArrowUp className="w-10 h-10 text-dark-600 animate-bounce" />
                                    </div>
                                    <h3 className="text-xl font-bold text-white mb-2">
                                        {hiddenOnly ? 'گاوصندوق خالی است' : contentScope === 'folders' ? 'کشویی پیدا نشد' : 'چیزی پیدا نشد'}
                                    </h3>
                                    <p className="text-dark-400 max-w-xs">
                                        {hiddenOnly ? 'در حال حاضر فایل یا کشوی مخفی‌ای نداری.' : searchQuery ? 'عبارت جست‌وجو یا فیلترها را تغییر بده.' : 'فایل‌ها را برای ربات تلگرام بفرست تا به کمدت اضافه شوند.'}
                                    </p>
                                    {hiddenOnly&&<button onClick={closeVaultItems} className="btn-primary mt-5 flex items-center gap-2"><ChevronRight className="h-4 w-4"/>بازگشت به کمد</button>}
                                </div>
                            )}

                            {/* Selection Rectangle Overlay */}
                            {selectionBox?.active && (
                                <div
                                    className="absolute bg-primary-500/10 border border-primary-500/30 pointer-events-none rounded sm z-50 backdrop-blur-[1px]"
                                    style={{
                                        left: Math.min(selectionBox.x1, selectionBox.x2),
                                        top: Math.min(selectionBox.y1, selectionBox.y2),
                                        width: Math.abs(selectionBox.x1 - selectionBox.x2),
                                        height: Math.abs(selectionBox.y1 - selectionBox.y2),
                                    }}
                                />
                            )}
                        </>
                    )}

                    {/* Loading indicator for infinite scroll */}
                    {activeSection === 'files' && showFiles && isLoading && hasMore && (
                        <div className="flex justify-center py-4">
                            <div className="w-6 h-6 border-2 border-primary-500/30 border-t-primary-500 rounded-full animate-spin"></div>
                        </div>
                    )}

                    {/* No more files message */}
                    {activeSection === 'files' && showFiles && !hasMore && allFiles.length > 0 && (
                        <div className="text-center py-4 text-dark-400">
                            همه فایل‌ها نمایش داده شدند
                        </div>
                    )}
                    </>}
                </div>
            </main>

            <Toasts />

            {/* Modals */}
            {showNewFolder && (
                <NewFolderModal
                    parentId={currentFolderId}
                    onClose={() => setShowNewFolder(false)}
                />
            )}

                {moveItems && (
                    <MoveFileModal
                        items={moveItems}
                        onClose={() => setMoveItems(null)}
                    />
                )}

            {deleteConfirm && (
                <DeleteConfirmModal
                    type={deleteConfirm.type}
                    count={deleteConfirm.items.length}
                    name={deleteConfirm.items.length === 1
                        ? (deleteConfirm.type === 'file' ? (deleteConfirm.items[0] as TelegramFile).file_name : (deleteConfirm.items[0] as Folder).name)
                        : undefined
                    }
                    onConfirm={handleDeleteConfirm}
                    onClose={() => setDeleteConfirm(null)}
                />
            )}

            {/* Rename modals */}
            <RenameModal
                isOpen={!!renameFile}
                onClose={() => setRenameFile(null)}
                onRename={handleRenameFile}
                currentName={renameFile?.file_name || ''}
                itemType="file"
            />

            <RenameModal
                isOpen={!!renameFolder}
                onClose={() => setRenameFolder(null)}
                onRename={handleRenameFolder}
                currentName={renameFolder?.name || ''}
                itemType="folder"
            />

            <DescriptionModal
                isOpen={!!descriptionItem}
                itemType={descriptionItem?.type || 'file'}
                currentDescription={descriptionItem?.item.description || ''}
                initialPreview={descriptionItem?.mode === 'preview'}
                onClose={() => setDescriptionItem(null)}
                onSave={handleSaveDescription}
            />
            <BatchEditModal
                open={showBatchEdit}
                count={selectedFilesForActions.length}
                onClose={() => setShowBatchEdit(false)}
                onSave={handleBatchEdit}
            />
            {showCombineTexts&&<div className="fixed inset-0 z-[260] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={()=>setShowCombineTexts(false)}><section dir="rtl" className="w-full max-w-md rounded-t-3xl border border-white/10 bg-dark-900 p-5 text-right shadow-2xl sm:rounded-3xl" onClick={event=>event.stopPropagation()}><header className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-500/15 text-primary-200"><Combine className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="font-bold">ترکیب متن‌ها</h2><p className="mt-1 text-xs text-dark-400">{selectedTextFilesForActions.length.toLocaleString('fa-IR')} متن، به ترتیب نمایش فعلی</p></div><button className="btn-icon" onClick={()=>setShowCombineTexts(false)}><X className="h-5 w-5"/></button></header><label className="mt-4 block text-xs text-dark-400">نام فایل تازه<input value={combineTitle} onChange={event=>setCombineTitle(event.target.value)} className="input mt-1.5 w-full text-right" maxLength={180}/></label><div className="mt-4"><p className="mb-2 text-xs text-dark-400">جداکننده متن‌ها</p><div className="grid grid-cols-3 gap-1 rounded-2xl border border-white/[.07] bg-dark-950/40 p-1">{([{value:'line',label:'خط جداکننده'},{value:'blank',label:'فاصله خالی'},{value:'none',label:'بدون فاصله'}] as const).map(option=><button key={option.value} onClick={()=>setCombineSeparator(option.value)} className={`min-h-10 rounded-xl px-2 text-[11px] ${combineSeparator===option.value?'bg-primary-500 text-white':'text-dark-400'}`}>{option.label}</button>)}</div></div><label className="mt-4 flex min-h-12 items-center gap-3 rounded-2xl bg-white/[.035] px-3"><input type="checkbox" checked={combineIncludeNames} onChange={event=>setCombineIncludeNames(event.target.checked)} className="h-5 w-5 accent-primary-500"/><span className="text-sm">نام هر فایل بالای متنش نوشته شود</span></label><div className="mt-5 grid grid-cols-2 gap-2"><button disabled={combiningTexts} onClick={()=>void combineSelectedTexts()} className="btn-primary min-h-11 disabled:opacity-40">{combiningTexts?'در حال ساخت…':'ساخت فایل'}</button><button className="btn-secondary" onClick={()=>setShowCombineTexts(false)}>لغو</button></div></section></div>}
            <Suspense fallback={null}>
                {showCreatePack && <CreatePackModal fileIds={packFileIds.length?packFileIds:selectedFilesForActions.map(file=>file.id)} parentFolderId={effectiveFolderId} packs={packs} onClose={()=>{setShowCreatePack(false);setPackFileIds([])}} onCreated={pack=>{setShowCreatePack(false);setPackFileIds([]);cancelSelection();setOpenPackId(pack.id);addToast('جعبه به‌روز شد 📦','success')}}/>}
                {openPackId!==null&&<PackViewer packId={openPackId} initialFileId={restorePackFileId} onClose={()=>{setOpenPackId(null);setRestorePackFileId(null)}} onOpenFile={handleFileOpen}/>}
            </Suspense>
            {showVaultPrompt && <div className="fixed inset-0 z-[190] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={()=>setShowVaultPrompt(false)}><div className="w-full max-w-sm rounded-t-3xl border border-white/10 bg-dark-900 p-5 sm:rounded-3xl" onClick={event=>event.stopPropagation()}><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-500/15 text-primary-200"><EyeOff className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="font-bold">گاوصندوق</h2><p className="text-xs text-dark-400">موارد مخفی را کنار بقیهٔ فایل‌ها ببین.</p></div><button className="btn-icon" onClick={()=>setShowVaultPrompt(false)}><X className="h-5 w-5"/></button></div>{!sessionStorage.getItem('komod-vault-token')&&<input autoFocus type="password" value={vaultPassword} onChange={event=>setVaultPassword(event.target.value)} className="input mt-4 w-full" placeholder="رمز گاوصندوق"/>}<div className="mt-4 grid gap-2"><button disabled={unlockVault.isPending||(!sessionStorage.getItem('komod-vault-token')&&!vaultPassword)} onClick={()=>void showVaultItems()} className="btn-primary min-h-11 disabled:opacity-40">نمایش موارد مخفی</button>{showHidden&&<button onClick={closeVaultItems} className="min-h-10 rounded-xl text-sm text-red-300 hover:bg-red-500/10">بستن گاوصندوق</button>}</div></div></div>}
            {showAddMenu && createPortal(<div className="fixed inset-0 z-[260] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-5" onClick={() => setShowAddMenu(false)}><div className="max-h-[min(86vh,42rem)] w-full max-w-md overflow-y-auto rounded-t-3xl border border-white/10 bg-dark-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl" onClick={event => event.stopPropagation()}><div className="mx-auto mb-4 h-1 w-12 rounded-full bg-white/20 sm:hidden"/><div className="flex items-center justify-between"><div><h2 className="font-bold">افزودن به کمد</h2><p className="mt-1 text-xs text-dark-500">چه چیزی می‌خواهی اضافه کنی؟</p></div><button className="btn-icon" onClick={() => setShowAddMenu(false)}><X className="h-5 w-5"/></button></div><div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-1">{[{label:'آپلود فایل',icon:<Upload className="h-5 w-5"/>,action:()=>uploadInputRef.current?.click()},{label:'یادداشت متنی',icon:<StickyNote className="h-5 w-5"/>,action:()=>{setTextFolder(incomingFolderId);setShowTextComposer(true)}},{label:'ساخت کشو',icon:<FolderPlus className="h-5 w-5"/>,action:()=>setShowNewFolder(true)},{label:'ذخیره از لینک',icon:<Link2 className="h-5 w-5"/>,action:openImportLink},{label:'از گوگل درایو',icon:<Cloud className="h-5 w-5"/>,action:openImportDrive},{label:'ساخت صدا از متن',icon:<AudioLines className="h-5 w-5"/>,action:()=>openSpeechTools('tts')},{label:'استخراج متن از صدا',icon:<FileAudio className="h-5 w-5"/>,action:()=>openSpeechTools('stt')}].map(item=><button key={item.label} className="flex min-h-16 items-center gap-3 rounded-2xl border border-white/[.07] bg-dark-800/60 px-3 text-right text-sm transition hover:border-primary-400/20 hover:bg-primary-500/[.07] sm:min-h-14" onClick={()=>{setShowAddMenu(false);item.action()}}><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-300">{item.icon}</span><span>{item.label}</span></button>)}</div></div></div>, document.body)}
            {uploadProgress&&uploadPanelMode!=='hidden'&&(uploadPanelMode==='collapsed'?<button onClick={()=>setUploadPanelMode('open')} className="fixed bottom-24 left-3 z-[175] flex h-12 items-center gap-2 rounded-full border border-primary-500/25 bg-dark-900/95 px-3 text-xs shadow-2xl backdrop-blur-xl" title="نمایش جزئیات آپلود"><Upload className="h-4 w-4 animate-pulse text-primary-300"/><span>{uploadProgress.index.toLocaleString('fa-IR')}/{uploadProgress.total.toLocaleString('fa-IR')}</span><span dir="ltr" className="font-bold text-primary-200">{uploadProgress.phase==="processing"?"…":uploadProgress.percent+"%"}</span><ChevronUp className="h-3.5 w-3.5"/></button>:<div className="fixed bottom-24 left-4 right-4 z-[175] mx-auto max-w-md rounded-2xl border border-primary-500/25 bg-dark-900/95 p-3 shadow-2xl backdrop-blur-xl"><div className="flex items-center gap-3"><Upload className="h-5 w-5 text-primary-300"/><div className="min-w-0 flex-1"><div className="flex justify-between gap-2 text-xs"><span className="truncate">{uploadProgress.name}</span><span dir="ltr">{uploadProgress.index}/{uploadProgress.total} · {uploadProgress.phase==="processing"?"…":uploadProgress.percent+"%"}</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-dark-700"><div className="h-full rounded-full bg-primary-500 transition-[width]" style={{width:`${uploadProgress.percent}%`}}/></div><p className="mt-1 text-[10px] text-dark-500">{uploadProgress.phase==="processing"?"ارسال تمام شد؛ در حال ذخیره نهایی…":"در حال ارسال فایل جاری"}</p></div><button className="btn-icon h-8 w-8" onClick={()=>setUploadPanelMode('collapsed')} title="نمایش خیلی کوچک"><Minus className="h-4 w-4"/></button><button className="btn-icon h-8 w-8" onClick={()=>setUploadPanelMode('hidden')} title="بستن وضعیت"><Eye className="h-4 w-4"/></button><button onClick={() => uploadAbortRef.current?.abort()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-300 hover:bg-red-500/20" title="لغو آپلود"><X className="h-4 w-4"/></button></div></div>)}
            {showSendPicker&&<div className="fixed inset-0 z-[280] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={()=>setShowSendPicker(false)}><section dir="rtl" className="w-full max-w-md rounded-t-3xl border border-white/10 bg-dark-900 p-5 shadow-2xl sm:rounded-3xl" onClick={event=>event.stopPropagation()}><header className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-500/15 text-primary-200"><Send className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="font-bold">ارسال به تلگرام</h2><p className="mt-1 text-xs text-dark-400">{selectedFilesForActions.length.toLocaleString('fa-IR')} فایل و {selectedPacksForActions.length.toLocaleString('fa-IR')} جعبه انتخاب شده است.</p></div><button className="btn-icon" onClick={()=>setShowSendPicker(false)}><X className="h-5 w-5"/></button></header><DeliveryTargetPicker value={sendDestinationIds} onChange={setSendDestinationIds}/><div className="mt-5 grid grid-cols-2 gap-2"><button disabled={sendingToTelegram} onClick={()=>void sendSelectedToTelegram(sendDestinationIds)} className="btn-primary min-h-11 disabled:opacity-40">{sendingToTelegram?'در حال ارسال…':'ارسال'}</button><button className="btn-secondary" onClick={()=>setShowSendPicker(false)}>لغو</button></div></section></div>}
            {importJobs.length>0&&importPanelMode!=='hidden'&&(importPanelMode==='collapsed'?
                <button onClick={()=>setImportPanelMode('open')} className="fixed bottom-24 left-3 z-[174] flex h-12 items-center gap-2 rounded-full border border-white/10 bg-dark-900/95 px-3 text-xs shadow-2xl backdrop-blur-xl" title="نمایش صف لینک‌ها"><Link2 className="h-4 w-4 animate-pulse text-primary-300"/><span>{importJobs.filter(job=>!['done','error','cancelled'].includes(job.state)).length.toLocaleString('fa-IR')} فعال</span><ChevronUp className="h-3.5 w-3.5"/></button>:
                <div className="fixed bottom-24 left-3 z-[174] w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-white/10 bg-dark-900/95 shadow-2xl backdrop-blur-xl">
                    <div className="flex min-h-11 items-center gap-1 border-b border-white/[.06] px-2.5">
                        <Link2 className="h-4 w-4 shrink-0 text-primary-300"/><strong className="min-w-0 flex-1 truncate text-sm">صف انتقال به کمد</strong>
                        {importJobs.some(job=>['queued','downloading','saving','paused'].includes(job.state))&&<button className="btn-icon h-8 w-8 text-red-300" onClick={()=>void cancelAllImportJobs()} title="لغو همه موارد صف"><Square className="h-4 w-4"/></button>}
                        <button className="btn-icon h-8 w-8" onClick={()=>void clearFinishedImportJobs()} title="پاک‌کردن موارد پایان‌یافته"><Trash2 className="h-4 w-4"/></button>
                        <button className="btn-icon h-8 w-8" onClick={()=>setImportPanelMode('collapsed')} title="جمع‌کردن وضعیت"><ChevronDown className="h-4 w-4"/></button>
                        <button className="btn-icon h-8 w-8" onClick={()=>setImportPanelMode('hidden')} title="پنهان‌کردن وضعیت"><X className="h-4 w-4"/></button>
                    </div>
                    <div className="max-h-52 divide-y divide-white/[.05] overflow-y-auto px-2">{importJobs.map(job=><div key={job.id} className="py-2"><div className="flex items-center gap-2"><span className={`h-2 w-2 shrink-0 rounded-full ${job.state==='done'?'bg-emerald-400':job.state==='error'||job.state==='cancelled'?'bg-red-400':job.state==='paused'?'bg-amber-400':'animate-pulse bg-primary-400'}`}/><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><strong className="min-w-0 flex-1 truncate text-xs">{importSourceLabel(job)}</strong><span className="shrink-0 text-[10px] text-dark-500">{job.state==='queued'?'در صف':job.state==='downloading'?'در حال دریافت':job.state==='saving'?'در حال ذخیره':job.state==='paused'?'متوقف':job.state==='cancelled'?'لغو شد':job.state==='done'?'آماده شد':'ناموفق'}</span></div><div className="mt-1 flex items-center gap-2"><div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-dark-950"><div className={`h-full rounded-full transition-[width] ${job.state==='error'?'bg-red-500':'bg-primary-500'}`} style={{width:`${Math.max(2,job.progress||0)}%`}}/></div><span className="w-8 shrink-0 text-left text-[10px] font-bold text-primary-300">{(job.progress||0).toLocaleString('fa-IR')}٪</span></div><p className="mt-1 truncate text-[10px] text-dark-500">{job.message}</p></div>{job.source==='link'&&['error','cancelled'].includes(job.state)&&<button className="btn-icon h-8 w-8 text-primary-200" title="تلاش دوباره" onClick={()=>void controlImportJob(job.id,'retry')}><RefreshCw className="h-3.5 w-3.5"/></button>}{['queued','downloading','saving','paused'].includes(job.state)&&<button className="btn-icon h-8 w-8 text-red-300" onClick={()=>void controlImportJob(job.id,'cancel')} title="لغو"><X className="h-3.5 w-3.5"/></button>}</div></div>)}</div>
                </div>)}
            {showImportLink && <div className="fixed inset-0 z-[170] flex items-end justify-center overflow-hidden bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setShowImportLink(false)}><form className="max-h-[92dvh] w-full max-w-lg overflow-x-hidden overflow-y-auto overscroll-contain rounded-t-3xl border border-white/10 bg-dark-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl sm:p-5" onClick={event => event.stopPropagation()} onSubmit={submitImportLink}><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/15 text-primary-200"><Link2 className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="font-bold">ذخیره از لینک</h2><p className="text-xs text-dark-400">لینک یوتیوب، اینستاگرام یا یک پین عمومی را بفرست.</p></div><button type="button" className="btn-icon" onClick={() => setShowImportLink(false)}><X className="h-5 w-5"/></button></div><div className="mt-4"><textarea dir="auto" autoFocus rows={3} className="input w-full resize-none text-right" value={importUrl} onChange={event => setImportUrl(event.target.value)} placeholder="لینک‌هات رو اینجا وارد کن"/></div>{importUrl.trim() && <p className={`mt-2 text-xs ${importPlatform || importUrls.length > 1 ? 'text-emerald-300' : 'text-red-300'}`}>{importUrls.length > 1 ? `✓ ${importUrls.length.toLocaleString('fa-IR')} لینک برای افزودن دسته‌ای` : importPlatform === 'youtube' ? '✓ لینک یوتیوب شناسایی شد' : importPlatform === 'instagram' ? '✓ لینک اینستاگرام شناسایی شد' : importPlatform === 'pinterest' ? '✓ پین پینترست شناسایی شد' : 'لینک معتبر یوتیوب، اینستاگرام یا پینترست نیست'}</p>}<CustomSelect className="mt-3" placement="top" label="کشوی مقصد" value={importFolder === 'new' ? 'new' : String(importFolder ?? 'root')} onChange={value => setImportFolder(value === 'new' ? 'new' : value === 'root' ? null : Number(value))} options={[{value:'root',label:'🗃️ فایل‌های من'},...(currentFolderId !== null?[{value:String(currentFolderId),label:'📍 کشوی فعلی'}]:[]),...importFolderOptions.filter(option => option.value !== String(currentFolderId)),{value:'new',label:'➕ ساخت کشوی تازه…'}]}/>{importFolder === 'new' && <input className="input mt-3 w-full" value={importFolderName} onChange={event => setImportFolderName(event.target.value)} placeholder="نام کشوی تازه"/>}{(importPlatform === 'youtube' || importUrls.length > 1) && <CustomSelect className="mt-3" placement="top" label="خروجی" value={importQuality} onChange={setImportQuality} options={[{value:'audio',label:'🎧 صدا'},{value:'480',label:'🎬 480p'},{value:'720',label:'🎬 720p'},{value:'1080',label:'🎬 1080p'}]}/>}<CustomSelect className="mt-3" placement="top" label="بعد از آماده‌شدن" value={importDeliveryMode} onChange={setImportDeliveryMode} options={[{value:'library',label:'فقط ذخیره در کمد'},{value:'both',label:'ذخیره در کمد و ارسال در تلگرام'},{value:'telegram',label:'فقط ارسال در تلگرام'}]}/>{importDeliveryMode!=='library'&&<DeliveryTargetPicker value={importDestinationIds} onChange={setImportDestinationIds}/>}<div className="mt-5 flex gap-2"><button type="button" className="btn-secondary flex-1" onClick={() => setShowImportLink(false)}>لغو</button><button disabled={!importUrl.trim() || (!importPlatform && importUrls.length < 2) || importLinkMutation.isPending || (importFolder === 'new' && !importFolderName.trim())} className="btn-primary flex-1 disabled:opacity-50">{importLinkMutation.isPending ? 'در حال ثبت…' : 'افزودن به صف'}</button></div></form></div>}
            {showImportDrive && <div className="fixed inset-0 z-[170] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={()=>setShowImportDrive(false)}>
                <form className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-white/10 bg-dark-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:p-5" onClick={event=>event.stopPropagation()} onSubmit={submitDriveImport}>
                    <div className="flex items-center gap-3">
                        <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/15 text-primary-200"><Cloud className="h-5 w-5"/></span>
                        <div className="min-w-0 flex-1"><h2 className="font-bold">افزودن از گوگل درایو</h2><p className="mt-1 text-xs text-dark-400">فایل‌ها را با انتخاب‌گر گوگل یا لینک اضافه کن.</p></div>
                        <button type="button" className="btn-icon" onClick={()=>setShowImportDrive(false)}><X className="h-5 w-5"/></button>
                    </div>
                    {driveConnection?.connected&&<div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-emerald-400/15 bg-emerald-500/[.07] p-3">
                        <CheckSquare className="h-5 w-5 text-emerald-300"/>
                        <div className="min-w-0 flex-1">
                            <strong className="block text-sm">حساب گوگل متصل است</strong>
                            <select dir="ltr" aria-label="حساب گوگل فعال" className="mt-1 max-w-full rounded-lg border border-white/10 bg-dark-900 px-2 py-1 text-xs text-emerald-200 outline-none" value={`${driveConnection.email||''}|${driveConnection.mode||''}`} onChange={event=>{const [email,mode]=event.target.value.split('|');void switchGoogleDrive(email,mode as 'full'|'picker')}}>
                                {(driveConnection.accounts||[]).map(account=><option key={`${account.email}|${account.mode}`} value={`${account.email}|${account.mode}`}>{account.email} · {account.mode==='full'?'دسترسی کامل':'انتخاب‌گر'}</option>)}
                            </select>
                        </div>
                        <button type="button" className="btn-secondary px-3 py-2 text-xs" disabled={driveConnecting} onClick={()=>void connectGoogleDrive('picker')}>افزودن حساب</button>
                        <button type="button" className="btn-icon h-9 w-9" title="خروج از این حساب" onClick={()=>void disconnectGoogleDrive()}><X className="h-4 w-4"/></button>
                    </div>}
                    <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <div className="rounded-2xl border border-primary-400/15 bg-primary-500/[.06] p-4">
                            <strong className="text-sm">انتخاب فایل با Google Picker</strong>
                            <p className="mt-1 text-xs leading-6 text-dark-400">برای همه کاربران؛ فقط فایل‌هایی که خودت انتخاب می‌کنی در دسترس کمد قرار می‌گیرند.</p>
                            <button type="button" disabled={!driveConnection?.picker_configured||driveConnecting||driveLoading} onClick={()=>void openGoogleDrivePicker()} className="btn-primary mt-3 w-full disabled:opacity-40">{driveConnecting?'در حال بازکردن گوگل…':driveLoading?'در حال آماده‌سازی…':'انتخاب از گوگل درایو'}</button>
                            {driveConnection&&!driveConnection.picker_configured&&<p className="mt-2 text-xs text-amber-300">تنظیمات Google Picker روی سرور کامل نشده است.</p>}
                        </div>
                        <div className="rounded-2xl border border-white/[.08] bg-dark-950/35 p-4">
                            <strong className="text-sm">مرور کامل درایو</strong>
                            <p className="mt-1 text-xs leading-6 text-dark-400">ویژه حساب‌هایی که در فهرست تست گوگل تأیید شده‌اند.</p>
                            {driveConnection?.mode==='full'?<button type="button" onClick={()=>void toggleDriveBrowser()} className={`mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition ${driveBrowserVisible?'bg-white/[.06] text-dark-200 hover:bg-white/[.1]':'bg-primary-500/15 text-primary-100 hover:bg-primary-500/25'}`}>{driveBrowserVisible?<EyeOff className="h-4 w-4"/>:<Eye className="h-4 w-4"/>}{driveBrowserVisible?'پنهان‌کردن محتویات درایو':'نمایش محتویات درایو'}</button>:<button type="button" disabled={!driveConnection?.full_configured||driveConnecting} onClick={()=>void connectGoogleDrive('full')} className="btn-secondary mt-3 w-full disabled:opacity-40">اتصال کامل آزمایشی</button>}
                        </div>
                    </div>
                    {driveSelected.size>0&&<div className="mt-3 rounded-2xl border border-emerald-400/15 bg-emerald-500/[.06] p-3"><strong className="text-sm text-emerald-200">{driveSelected.size.toLocaleString('fa-IR')} فایل انتخاب شده</strong><div className="mt-2 flex flex-wrap gap-1">{Object.values(driveSelectedDetails).slice(0,8).map(item=><span key={item.id} dir="auto" className="max-w-40 truncate rounded-lg bg-white/[.06] px-2 py-1 text-[11px] text-dark-300">{item.name}</span>)}</div></div>}
                    {driveConnection?.mode==='full'&&driveBrowserVisible&&<div className="mt-4 rounded-2xl border border-white/[.07] bg-dark-950/20 p-2.5 sm:p-3">
                        <div className="flex items-center gap-1 text-xs text-dark-400"><div className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap">{drivePath.map((item,index)=><button type="button" key={item.id} onClick={()=>void loadDriveFolder(item.id,item.name)} className="rounded-lg px-2 py-1 hover:bg-white/[.05] hover:text-white">{index?'‹ ':''}{item.name}</button>)}</div><button type="button" disabled={driveLoading} onClick={()=>{const current=drivePath[drivePath.length-1];void loadDriveFolder(current?.id||'root',current?.name||'درایو من')}} className="btn-icon h-8 w-8 shrink-0" title="تازه‌سازی"><RefreshCw className={`h-3.5 w-3.5 ${driveLoading?'animate-spin':''}`}/></button></div>
                        <label className="relative mt-2 block"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-500"/><input value={driveQuery} onChange={event=>setDriveQuery(event.target.value)} className="input h-10 w-full !pr-10" placeholder="جست‌وجو در این پوشه"/></label>
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_auto]"><CustomSelect value={driveTypeFilter} onChange={value=>setDriveTypeFilter(value as DriveTypeFilter)} label="نوع فایل" options={(Object.keys(driveKindLabel) as DriveTypeFilter[]).map(value=>({value,label:driveKindLabel[value]}))}/><CustomSelect value={driveSort} onChange={value=>{setDriveSort(value as DriveSort);setDriveSortDirection(value==='name'?'asc':'desc')}} label="مرتب‌سازی" options={[{value:'name',label:'نام'},{value:'modified',label:'تاریخ تغییر'},{value:'size',label:'حجم'},{value:'type',label:'نوع فایل'}]}/><div className="col-span-2 flex h-10 items-center justify-end gap-1 sm:col-span-1"><button type="button" onClick={()=>setDriveSortDirection(value=>value==='asc'?'desc':'asc')} className="btn-icon h-10 w-10" title="تغییر جهت مرتب‌سازی"><ArrowDownUp className="h-4 w-4"/></button>{([['list',List],['grid',LayoutGrid],['dense',Grid]] as [DriveViewMode,typeof List][]).map(([mode,Icon])=><button type="button" key={mode} onClick={()=>{setDriveViewMode(mode);localStorage.setItem('komod-drive-view',mode)}} className={`flex h-10 w-10 items-center justify-center rounded-xl transition ${driveViewMode===mode?'bg-primary-500 text-white':'bg-white/[.035] text-dark-400 hover:text-white'}`} title={mode==='list'?'لیستی':mode==='grid'?'کارتی':'کاشی کوچک'}><Icon className="h-4 w-4"/></button>)}</div></div>
                        <div className={`mt-2 max-h-72 overflow-y-auto rounded-2xl border border-white/[.07] bg-dark-950/35 p-2 ${driveViewMode==='list'?'space-y-1':driveViewMode==='grid'?'grid grid-cols-2 gap-2 sm:grid-cols-3':'grid grid-cols-3 gap-1.5 sm:grid-cols-5'}`}>{driveLoading?<div className="col-span-full py-10 text-center text-sm text-dark-500">در حال خواندن درایو…</div>:visibleDriveEntries.map(item=>{const kind=driveEntryKind(item),folder=kind==='folder',selected=driveSelected.has(item.id),Icon=folder?FolderIcon:kind==='image'?ImageIcon:kind==='video'?Film:kind==='audio'?Music:FileText;return <button type="button" key={item.id} onClick={()=>folder?void loadDriveFolder(item.id,item.name):setDriveSelected(previous=>{const next=new Set(previous);if(next.has(item.id)){next.delete(item.id);setDriveSelectedDetails(details=>{const copy={...details};delete copy[item.id];return copy})}else{next.add(item.id);setDriveSelectedDetails(details=>({...details,[item.id]:item}))}return next})} className={`relative flex w-full min-w-0 max-w-full overflow-hidden rounded-xl text-right transition ${driveViewMode==='list'?'min-h-12 items-center gap-3 px-3':'min-h-24 flex-col items-center justify-center gap-2 p-2 text-center'} ${selected?'bg-primary-500/15 text-primary-100 ring-1 ring-primary-400/25':'hover:bg-white/[.045]'}`}><span className={`flex shrink-0 items-center justify-center rounded-xl ${driveViewMode==='list'?'h-8 w-8':'h-11 w-11'} ${folder?'bg-amber-500/10 text-amber-300':'bg-primary-500/10 text-primary-300'}`}><Icon className={driveViewMode==='list'?'h-4 w-4':'h-5 w-5'}/></span><span className="min-w-0 max-w-full flex-1 overflow-hidden"><strong dir="auto" title={item.name} className={`block max-w-full truncate ${driveViewMode==='dense'?'text-xs':'text-sm'}`}>{item.name}</strong>{driveViewMode!=='dense'&&<small className="mt-1 block max-w-full truncate text-[10px] text-dark-500">{driveKindLabel[kind]}{item.size?` · ${formatFileSize(Number(item.size))}`:''}</small>}</span>{selected&&!folder&&<CheckSquare className="absolute left-2 top-2 h-4 w-4 text-primary-300"/>}</button>})}{!driveLoading&&!visibleDriveEntries.length&&<div className="col-span-full py-10 text-center text-sm text-dark-500">موردی با این فیلتر پیدا نشد.</div>}</div>
                    </div>}
                    <div className="my-4 flex items-center gap-3 text-xs text-dark-500"><span className="h-px flex-1 bg-white/[.07]"/>یا لینک عمومی<span className="h-px flex-1 bg-white/[.07]"/></div>
                    <textarea dir="rtl" rows={3} className="input w-full resize-none text-right" value={driveUrl} onChange={event=>setDriveUrl(event.target.value)} placeholder="چند لینک گوگل درایو را پشت سر هم وارد کن"/>
                    <p className="mt-2 text-xs text-dark-500">لینک‌ها لازم نیست در خط‌های جدا باشند؛ برنامه خودش آن‌ها را تشخیص می‌دهد.</p>
                    <CustomSelect className="mt-3" placement="top" label="کشوی مقصد" value={String(driveFolder??'root')} onChange={value=>setDriveFolder(value==='root'?null:Number(value))} options={[{value:'root',label:'🗃️ فایل‌های من'},...(currentFolderId!==null?[{value:String(currentFolderId),label:'📍 کشوی فعلی'}]:[]),...importFolderOptions.filter(option=>option.value!==String(currentFolderId))]}/>
                    <label className="mt-3 flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border border-white/[.07] bg-white/[.025] px-3"><input type="checkbox" checked={driveSendToTelegram} onChange={event=>setDriveSendToTelegram(event.target.checked)} className="h-5 w-5 accent-primary-500"/><span className="text-sm">بعد از ذخیره، در تلگرام هم بفرست</span></label>
                    {driveSendToTelegram&&<DeliveryTargetPicker value={driveDestinationIds} onChange={setDriveDestinationIds}/>}
                    <div className="mt-5 flex gap-2"><button type="button" className="btn-secondary flex-1" onClick={()=>setShowImportDrive(false)}>لغو</button><button disabled={(!extractImportUrls(driveUrl).length&&!driveSelected.size)||driveSubmitting} className="btn-primary flex-1 disabled:opacity-50">{driveSubmitting?'در حال ثبت…':`افزودن ${driveSelected.size?driveSelected.size.toLocaleString('fa-IR'):''}`}</button></div>
                </form>
            </div>}            {showTextComposer && (
                <div className="fixed inset-0 z-[170] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setShowTextComposer(false)}>
                    <form className="w-full max-w-2xl rounded-t-3xl border border-white/10 bg-dark-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:p-5" onClick={event => event.stopPropagation()} onSubmit={handleCreateText}>
                        <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/15 text-primary-200"><StickyNote className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="font-bold">یادداشت تازه</h2><p className="text-xs text-dark-400">متن بلند یا مارک‌داون را مستقیم در کمد ذخیره کن.</p></div><button type="button" className="btn-icon" onClick={() => setShowTextComposer(false)}><X className="h-5 w-5"/></button></div>
                        {(!navigator.onLine||forceOffline)&&<p className="mt-4 rounded-xl border border-amber-400/20 bg-amber-500/[.08] px-3 py-2 text-xs leading-6 text-amber-200">این یادداشت روی همین دستگاه ذخیره می‌شود و بعد از اتصال، خودکار به کمد اضافه خواهد شد.</p>}
                        <input className="input mt-4 w-full" value={textFileName} onChange={event => setTextFileName(event.target.value)} placeholder="نام یادداشت" maxLength={240}/>
                        <CustomSelect className="mt-3" placement="top" label="کشوی مقصد" value={String(textFolder ?? 'root')} onChange={value=>setTextFolder(value==='root'?null:Number(value))} options={[{value:'root',label:'🗃️ فایل‌های من'},...importFolderOptions]}/>
                        <textarea autoFocus className="input mt-3 min-h-[45vh] w-full resize-y font-mono leading-7" value={textContent} onChange={event => setTextContent(event.target.value)} placeholder="متنت را اینجا بنویس…"/>
                        <div className="mt-4 flex gap-2"><button type="button" className="btn-secondary flex-1" onClick={() => setShowTextComposer(false)}>لغو</button><button disabled={!textContent.trim() || uploadFileMutation.isPending} className="btn-primary flex-1 disabled:opacity-50">{uploadFileMutation.isPending ? 'در حال ذخیره…' : (!navigator.onLine||forceOffline) ? 'ذخیره روی دستگاه' : 'ذخیره متن'}</button></div>
                    </form>
                </div>
            )}
        </div>
    );
}
