import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../lib/store';
import { TelegramFile, Folder, api, canPreviewText, sendFilesToTelegram, useUpdateFile, useUpdateFolder, useUploadFile } from '../lib/api';
import { Play, Download, DownloadCloud, Link, Edit, FolderInput, Trash2, Globe, ShieldOff, HardDriveDownload, Eye, EyeOff, AlignLeft, ListPlus, Heart, Info, Pin, Tags, ChevronDown, ChevronUp, X, AudioLines, Send, Palette, Image as ImageIcon } from 'lucide-react';
import { saveFileOffline } from '../lib/offline';

export default function GlobalContextMenu() {
    const { activeContextMenu, setActiveContextMenu, setPreviewFile, setContentPreviewFile, setDetailsFile, setMoveItems, setMoveFiles, setDeleteConfirm, setRenameFile, setRenameFolder, setDescriptionItem, selectedFileIds, selectedFiles, setPlaylistFile, setActiveSection, addToast } = useAppStore();
    const updateFile = useUpdateFile();
    const updateFolder = useUpdateFolder();
    const uploadFile = useUploadFile();
    const menuRef = useRef<HTMLDivElement>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [showMore, setShowMore] = useState(false);
    const [showFolderAppearance, setShowFolderAppearance] = useState(false);
    const [showShareSettings, setShowShareSettings] = useState(false);
    const [shareExpiry, setShareExpiry] = useState<number | null>(168);
    const [sharePassword, setSharePassword] = useState('');
    const [shareAllowDownload, setShareAllowDownload] = useState(true);
    const [shareViewLimit, setShareViewLimit] = useState('');
    const [sharing, setSharing] = useState(false);

    useEffect(() => { setShowMore(false); setShowFolderAppearance(false); setShowShareSettings(false); }, [activeContextMenu?.type, activeContextMenu?.item.id]);

    // Close menu on escape
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                setActiveContextMenu(null);
            }
        };
        if (activeContextMenu) {
            document.addEventListener('keydown', handleEscape);
        }
        return () => document.removeEventListener('keydown', handleEscape);
    }, [activeContextMenu, setActiveContextMenu]);

    if (!activeContextMenu) return null;
    const readOnlyWorkspace = Boolean(localStorage.getItem('komod-active-workspace')) && localStorage.getItem('komod-active-workspace-permission') === 'read';

    const { x, y } = activeContextMenu;
    const isMultiSelect = selectedFileIds.size > 1 && activeContextMenu.type === 'file' && selectedFileIds.has(activeContextMenu.item.id);

    // Adjust position to keep within viewport
    const getMenuPosition = () => {
        const menuWidth = 340;
        const padding = 10;
        const menuHeight = Math.min(window.innerHeight * 0.76, 560);

        let posX = x;
        let posY = y;

        if (posX + menuWidth > window.innerWidth - padding) {
            posX = window.innerWidth - menuWidth - padding;
        }
        posY = Math.min(Math.max(padding, posY), Math.max(padding, window.innerHeight - menuHeight - padding));

        return { left: posX, top: posY };
    };

    const position = getMenuPosition();
    const isMobile = window.innerWidth < 640;

    const handleAction = (action: () => void) => {
        action();
        setActiveContextMenu(null);
    };

    const handleCopy = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setActiveContextMenu(null);
            addToast('پیوند کپی شد.');
            setTimeout(() => setCopiedId(null), 2000);
        } catch (err) {
            console.error('کپی‌کردن انجام نشد:', err);
            addToast('کپی‌کردن انجام نشد.', 'error');
        }
    };

    // --- File Actions ---
    const handlePlay = (file: TelegramFile) => {
        setPreviewFile(file);
    };

    const publicPageUrl = (file: TelegramFile) => file.public_hash
        ? `${window.location.origin}/s/${file.public_hash}`
        : '';

    const handleShare = async (file: TelegramFile) => {
        setSharing(true);
        try {
            const limit = Number.parseInt(shareViewLimit, 10);
            const { data } = await api.post<TelegramFile>(`/files/${file.id}/share`, {
                expires_in_hours: shareExpiry,
                password: sharePassword.trim() || null,
                allow_download: shareAllowDownload,
                view_limit: Number.isFinite(limit) && limit > 0 ? limit : null,
            });
            if (activeContextMenu?.type === 'file') setActiveContextMenu({ ...activeContextMenu, item: data });
            setShowShareSettings(false);
            const url = publicPageUrl(data);
            if (url) await navigator.clipboard.writeText(url).catch(() => undefined);
            addToast('پیوند عمومی ساخته شد.');
        } catch (error) {
            console.error('Failed to share file:', error);
            addToast('ساخت پیوند انجام نشد.', 'error');
        } finally { setSharing(false); }
    };

    const handleRevokeShare = async (file: TelegramFile) => {
        setActiveContextMenu(null);
        addToast('در حال لغو پیوند…', 'info');
        try {
            await api.delete<TelegramFile>(`/files/${file.id}/share`);
            addToast('پیوند عمومی لغو شد.');
        } catch (error) {
            console.error('Failed to revoke share:', error);
            addToast('لغو پیوند انجام نشد.', 'error');
        }
    };

    const ensurePublicLink = async (file: TelegramFile): Promise<string> => {
        if (file.public_stream_url) {
            return `${window.location.protocol}//${window.location.host}${file.public_stream_url}`;
        }
        try {
            const { data } = await api.post<TelegramFile>(`/files/${file.id}/share`);
            if (data.public_stream_url) {
                if (activeContextMenu && activeContextMenu.type === 'file') {
                    setActiveContextMenu({ ...activeContextMenu, item: data });
                }
                return `${window.location.protocol}//${window.location.host}${data.public_stream_url}`;
            }
        } catch (err) {
            console.error('Failed to create public link:', err);
        }
        const token = localStorage.getItem('access_token');
        const downloadUrl = `${api.defaults.baseURL}/stream/${file.id}?token=${token}`;
        return downloadUrl.startsWith('http')
            ? downloadUrl
            : `${window.location.protocol}//${window.location.host}${downloadUrl}`;
    };

    const handleDownload = async (file: TelegramFile) => {
        try {
            const url = await ensurePublicLink(file);
            const downloadUrl = url + (url.includes('?') ? '&' : '?') + 'download=1';
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = file.file_name;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (err) {
            console.error('Failed to download:', err);
        }
    };

    const handleOfflineSave = (file: TelegramFile) => {
        setActiveContextMenu(null);
        addToast('به صف ذخیره آفلاین اضافه شد…', 'info');
        void saveFileOffline(file).then(
            () => addToast('فایل برای پخش آفلاین ذخیره شد 📥'),
            error => addToast(error instanceof Error ? error.message : 'ذخیره آفلاین انجام نشد', 'error'),
        );
    };

    const handleTextToSpeech = async (file: TelegramFile) => {
        setActiveContextMenu(null);
        addToast('متن در حال آماده‌سازی است…', 'info');
        try {
            const { data } = await api.get<{content:string}>(`/files/${file.id}/text`);
            const title = file.file_name.replace(/\.(txt|md|markdown|json|csv|log|xml|ya?ml)$/i, '').trim() || 'صدای ساخته‌شده';
            await api.post('/tts/jobs', { text: data.content, title });
            addToast('متن به صف ساخت صدا اضافه شد.');
        } catch (error: any) {
            addToast(error?.response?.data?.detail || 'تبدیل متن به صدا شروع نشد.', 'error');
        }
    };
    const handleSpeechToText = (file:TelegramFile) => {
        localStorage.setItem('komod-stt-source-file',String(file.id));
        localStorage.setItem('komod-stt-source-title',`رونویسی ${file.file_name.replace(/\.[^.]+$/,'')}`);
        localStorage.setItem('komod-settings-target','tts');
        localStorage.setItem('komod-speech-mode','stt');
        setActiveContextMenu(null);
        setActiveSection('settings');
        window.history.pushState({},'', '/');
    };
    const handleSendToTelegram = async (files:TelegramFile[]) => {
        setActiveContextMenu(null);
        addToast('در حال ارسال به تلگرام…', 'info');
        try {
            const result = await sendFilesToTelegram(files.map(item=>item.id));
            addToast(result.failed.length ? `${result.sent.toLocaleString('fa-IR')} فایل فرستاده شد؛ بعضی موارد ناموفق بود.` : `${result.sent.toLocaleString('fa-IR')} فایل به تلگرام فرستاده شد.`);
        } catch (error:any) { addToast(error?.response?.data?.detail||'ارسال به تلگرام انجام نشد.','error'); }
    };

    const file = activeContextMenu.type === 'file' ? activeContextMenu.item as TelegramFile : null;
    const folder = activeContextMenu.type === 'folder' ? activeContextMenu.item as Folder : null;
    const previewable = Boolean(file && (file.file_type === 'image' || canPreviewText(file)));
    const playable = Boolean(file && (file.file_type === 'video' || file.file_type === 'audio'));
    const previewLabel = file?.file_type === 'image' ? 'نمایش عکس' : 'پیش‌نمایش';

    return <>
        <div className={`fixed inset-0 z-[99998] ${isMobile ? 'bg-black/60 backdrop-blur-sm' : ''}`} onClick={event => { event.stopPropagation(); setActiveContextMenu(null); }}/>
        <div ref={menuRef} dir="rtl" className={`fixed z-[99999] flex max-h-[76dvh] flex-col overflow-hidden border border-white/[.09] bg-dark-900/95 text-right shadow-2xl backdrop-blur-xl ${isMobile ? 'inset-x-0 bottom-0 rounded-t-[2rem] pb-[env(safe-area-inset-bottom)] animate-slide-up' : 'w-[340px] rounded-2xl animate-scale-in'}`} style={isMobile ? undefined : {left:position.left,top:position.top,transformOrigin:'top left'}} onClick={event=>event.stopPropagation()} onContextMenu={event=>event.preventDefault()}>
            <header className="flex shrink-0 items-center gap-3 border-b border-white/[.07] px-4 py-3">
                {isMobile&&<span className="absolute left-1/2 top-2 h-1 w-10 -translate-x-1/2 rounded-full bg-white/20"/>}
                <div className="min-w-0 flex-1 pt-1"><p className="text-[10px] text-dark-500">{file?'گزینه‌های فایل':'گزینه‌های کشو'}</p><strong dir="auto" className="block truncate text-sm">{file?.file_name||folder?.name}</strong></div>
                <button className="btn-icon h-9 w-9" aria-label="بستن منو" onClick={()=>setActiveContextMenu(null)}><X className="h-4 w-4"/></button>
            </header>
            <div className="min-h-0 overflow-y-auto p-3">
                {isMultiSelect ? <div className="space-y-3"><p className="rounded-xl bg-primary-500/10 px-3 py-2 text-sm text-primary-200">{selectedFileIds.size.toLocaleString('fa-IR')} فایل انتخاب شده</p><div className="grid grid-cols-2 gap-2"><ActionTile icon={<Send/>} label="ارسال به تلگرام" onClick={()=>void handleSendToTelegram(selectedFiles)}/>{!readOnlyWorkspace&&<><ActionTile icon={<FolderInput/>} label="جابه‌جایی" onClick={()=>handleAction(()=>setMoveFiles(selectedFiles))}/><ActionTile danger icon={<Trash2/>} label="حذف" onClick={()=>handleAction(()=>setDeleteConfirm({type:'file',items:Array.from(selectedFileIds).map(id=>({id} as any))}))}/></>}</div></div> : file ? <>
                    <div className="grid grid-cols-2 gap-2">
                        {playable&&<ActionTile icon={<Play/>} label="پخش" onClick={()=>handleAction(()=>handlePlay(file))}/>}
                        {previewable&&<ActionTile icon={<Eye/>} label={previewLabel} onClick={()=>handleAction(()=>setContentPreviewFile(file))}/>}
                        {!readOnlyWorkspace&&canPreviewText(file)&&<ActionTile icon={<AudioLines/>} label="تبدیل به صوت" onClick={()=>void handleTextToSpeech(file)}/>}
                        {!readOnlyWorkspace&&playable&&<ActionTile icon={<AudioLines/>} label="تبدیل صدا به متن" onClick={()=>handleSpeechToText(file)}/>}
                        <ActionTile icon={<DownloadCloud/>} label="ذخیره آفلاین" onClick={()=>handleOfflineSave(file)}/>
                        <ActionTile icon={<Send/>} label="ارسال به تلگرام" onClick={()=>void handleSendToTelegram([file])}/>
                        {!readOnlyWorkspace&&<><ActionTile icon={<FolderInput/>} label="جابه‌جایی" onClick={()=>handleAction(()=>setMoveItems({files:[file],folders:[]}))}/><ActionTile icon={<Heart className={file.is_favorite?'fill-current text-pink-400':''}/>} label={file.is_favorite?'برداشتن نشان':'نشان کردن'} onClick={async()=>{setActiveContextMenu(null);await updateFile.mutateAsync({id:file.id,is_favorite:!file.is_favorite});addToast(file.is_favorite?'نشان برداشته شد.':'فایل نشان شد ⭐');}}/><ActionTile icon={<Pin className={file.is_pinned?'fill-current text-primary-300':''}/>} label={file.is_pinned?'برداشتن پین':'پین بالای کمد'} onClick={async()=>{setActiveContextMenu(null);await updateFile.mutateAsync({id:file.id,is_pinned:!file.is_pinned});addToast(file.is_pinned?'پین برداشته شد.':'فایل پین شد 📌');}}/><ActionTile icon={<Edit/>} label="تغییر نام" onClick={()=>handleAction(()=>setRenameFile(file))}/></>}
                    </div>
                    <button className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/[.07] bg-white/[.035] text-sm text-dark-300 transition hover:bg-white/[.07]" onClick={()=>setShowMore(value=>!value)}>{showMore?<ChevronUp className="h-4 w-4"/>:<ChevronDown className="h-4 w-4"/>}{showMore?'بستن گزینه‌های بیشتر':'گزینه‌های بیشتر'}</button>
                    {showMore&&<div className="mt-3 space-y-3 border-t border-white/[.07] pt-3">
                            <div className="grid grid-cols-2 gap-2">
                                <ActionTile icon={<Download/>} label="دانلود" onClick={()=>{void handleDownload(file);setActiveContextMenu(null);}}/>
                                <ActionTile icon={<Info/>} label="جزئیات فایل" onClick={()=>handleAction(()=>setDetailsFile(file))}/>
                                {!readOnlyWorkspace&&<>
                                    {playable&&<ActionTile icon={<ListPlus/>} label="افزودن به پلی‌لیست" onClick={()=>handleAction(()=>setPlaylistFile(file))}/>}
                                    <ActionTile icon={<AlignLeft/>} label={file.description?'ویرایش توضیحات':'افزودن توضیحات'} onClick={()=>handleAction(()=>setDescriptionItem({type:'file',item:file}))}/>
                                    <ActionTile icon={<Tags/>} label="ویرایش تگ‌ها" onClick={()=>handleAction(()=>setDetailsFile(file))}/>
                                    <ActionTile icon={file.is_hidden?<Eye/>:<EyeOff/>} label={file.is_hidden?'خروج از گاوصندوق':'مخفی کردن'} onClick={async()=>{setActiveContextMenu(null);try{await updateFile.mutateAsync({id:file.id,is_hidden:!file.is_hidden});addToast(file.is_hidden?'فایل از گاوصندوق بیرون آمد.':'فایل مخفی شد 🔒');}catch(error:any){addToast(error?.response?.data?.detail||'ابتدا برای گاوصندوق رمز تعیین کن.','error');}}}/>
                                </>}
                            </div>
                            {!readOnlyWorkspace&&<><div className="rounded-2xl border border-white/[.07] bg-dark-950/40 p-2"><p className="mb-2 px-1 text-[10px] font-medium text-dark-500">پیوندها</p><div className="grid grid-cols-2 gap-2">
                                <ActionTile icon={<Link/>} label={copiedId==='stream'?'کپی شد':'پیوند پخش'} onClick={async()=>{setActiveContextMenu(null);addToast('در حال آماده‌سازی پیوند…','info');handleCopy(await ensurePublicLink(file),'stream');}}/>
                                <ActionTile icon={<HardDriveDownload/>} label={copiedId==='download'?'کپی شد':'پیوند دانلود'} onClick={async()=>{setActiveContextMenu(null);addToast('در حال آماده‌سازی پیوند…','info');const url=await ensurePublicLink(file);handleCopy(url+(url.includes('?')?'&':'?')+'download=1','download');}}/>
                                {file.public_stream_url?<>
                                    <ActionTile icon={<Globe className="text-emerald-400"/>} label="پیوند عمومی" onClick={()=>handleCopy(publicPageUrl(file),'public')}/>
                                    <ActionTile icon={<ShieldOff/>} label="لغو پیوند عمومی" onClick={()=>handleRevokeShare(file)}/>
                                    <ActionTile icon={<ShieldOff className="text-primary-300"/>} label="تنظیم دوباره" onClick={()=>setShowShareSettings(true)}/>
                                </>:<ActionTile icon={<Globe/>} label="ساخت پیوند عمومی" onClick={()=>setShowShareSettings(true)}/>}
                            </div>
                            {showShareSettings&&<div className="mt-3 rounded-2xl border border-primary-400/15 bg-primary-500/[.06] p-3">
                                <p className="mb-2 text-xs font-bold text-primary-100">تنظیم پیوند امن</p>
                                <div className="grid grid-cols-4 gap-1.5">{[[24,'۱ روز'],[168,'۱ هفته'],[720,'۱ ماه'],[null,'همیشگی']].map(([hours,label])=><button key={String(hours)} onClick={()=>setShareExpiry(hours as number|null)} className={`rounded-xl px-1 py-2 text-[10px] ${shareExpiry===hours?'bg-primary-500 text-white':'bg-dark-800 text-dark-300'}`}>{label}</button>)}</div>
                                <div className="mt-2 grid grid-cols-2 gap-2"><input value={sharePassword} onChange={event=>setSharePassword(event.target.value)} className="input min-w-0 text-right text-xs" placeholder="رمز (اختیاری)"/><input inputMode="numeric" value={shareViewLimit} onChange={event=>setShareViewLimit(event.target.value.replace(/\D/g,''))} className="input min-w-0 text-right text-xs" placeholder="سقف مشاهده"/></div>
                                <label className="mt-2 flex cursor-pointer items-center gap-2 rounded-xl bg-dark-800/70 px-3 py-2 text-xs"><input type="checkbox" checked={shareAllowDownload} onChange={event=>setShareAllowDownload(event.target.checked)} className="accent-primary-500"/><span>اجازه دانلود فایل</span></label>
                                <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={()=>setShowShareSettings(false)} className="btn-secondary min-h-10 text-xs">انصراف</button><button disabled={sharing} onClick={()=>void handleShare(file)} className="btn-primary min-h-10 text-xs disabled:opacity-50">{sharing?'در حال ساخت…':'ساخت و کپی'}</button></div>
                            </div>}
                            </div>
                            <button className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-red-500/10 text-sm text-red-300 hover:bg-red-500/15" onClick={()=>handleAction(()=>setDeleteConfirm({type:'file',items:[file]}))}><Trash2 className="h-4 w-4"/>حذف فایل</button>
                            </>}
                        </div>}
                    {readOnlyWorkspace&&<p className="mt-3 rounded-xl bg-amber-500/[.08] px-3 py-2 text-xs text-amber-200">این کمد با دسترسی فقط مشاهده باز شده است.</p>}
                </> : folder ? <>
                    {readOnlyWorkspace?<p className="rounded-xl bg-amber-500/[.08] px-3 py-3 text-sm text-amber-200">این کمد با دسترسی فقط مشاهده باز شده است.</p>:<>
                        <div className="grid grid-cols-2 gap-2">
                            <ActionTile icon={<Heart className={folder.is_favorite?'fill-current text-pink-400':''}/>} label={folder.is_favorite?'برداشتن نشان':'نشان کردن'} onClick={async()=>{setActiveContextMenu(null);await updateFolder.mutateAsync({id:folder.id,is_favorite:!folder.is_favorite});addToast(folder.is_favorite?'نشان برداشته شد.':'کشو نشان شد ⭐');}}/>
                            <ActionTile icon={<Pin className={folder.is_pinned?'fill-current text-primary-300':''}/>} label={folder.is_pinned?'برداشتن پین':'پین بالای کمد'} onClick={async()=>{setActiveContextMenu(null);await updateFolder.mutateAsync({id:folder.id,is_pinned:!folder.is_pinned});addToast(folder.is_pinned?'پین برداشته شد.':'کشو پین شد 📌');}}/>
                            <ActionTile icon={<Edit/>} label="تغییر نام" onClick={()=>handleAction(()=>setRenameFolder(folder))}/>
                            <ActionTile icon={<FolderInput/>} label="جابه‌جایی" onClick={()=>handleAction(()=>setMoveItems({files:[],folders:[folder]}))}/>
                        </div>
                        <button className="mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-white/[.07] bg-white/[.035] text-sm text-dark-300" onClick={()=>setShowMore(value=>!value)}>{showMore?<ChevronUp className="h-4 w-4"/>:<ChevronDown className="h-4 w-4"/>}{showMore?'بستن گزینه‌های بیشتر':'گزینه‌های بیشتر'}</button>
                        {showMore&&<div className="mt-3 border-t border-white/[.07] pt-3"><div className="grid grid-cols-2 gap-2"><ActionTile icon={<Palette/>} label="ظاهر کشو" onClick={()=>setShowFolderAppearance(value=>!value)}/><ActionTile icon={<AlignLeft/>} label={folder.description?'ویرایش توضیحات':'افزودن توضیحات'} onClick={()=>handleAction(()=>setDescriptionItem({type:'folder',item:folder}))}/><ActionTile icon={folder.is_hidden?<Eye/>:<EyeOff/>} label={folder.is_hidden?'خروج از گاوصندوق':'مخفی کردن'} onClick={async()=>{setActiveContextMenu(null);try{await updateFolder.mutateAsync({id:folder.id,is_hidden:!folder.is_hidden});addToast(folder.is_hidden?'کشو از گاوصندوق بیرون آمد.':'کشو مخفی شد 🔒');}catch(error:any){addToast(error?.response?.data?.detail||'ابتدا برای گاوصندوق رمز تعیین کن.','error');}}}/><ActionTile danger icon={<Trash2/>} label="حذف کشو" onClick={()=>handleAction(()=>setDeleteConfirm({type:'folder',items:[folder]}))}/></div>{showFolderAppearance&&<FolderAppearanceEditor folder={folder} pending={updateFolder.isPending||uploadFile.isPending} onUpdate={async data=>{await updateFolder.mutateAsync({id:folder.id,...data});addToast('ظاهر کشو ذخیره شد.');}} onUpload={async file=>{const uploaded=await uploadFile.mutateAsync({file,folderId:null});await updateFolder.mutateAsync({id:folder.id,cover_file_id:uploaded.id});addToast('کاور کشو عوض شد.');}}/>}</div>}
                    </>}
                </> : null}
            </div>
        </div>
    </>;
}

function FolderAppearanceEditor({folder,pending,onUpdate,onUpload}:{folder:Folder;pending:boolean;onUpdate:(data:{color?:string|null;icon?:string|null;cover_file_id?:number|null})=>Promise<void>;onUpload:(file:File)=>Promise<void>}){
    const icons=['📁','🗂️','🎵','🎬','📚','💼','⭐','🔒'];
    const colors=['#8B5CF6','#EC4899','#F59E0B','#10B981','#06B6D4','#3B82F6','#EF4444'];
    const [customIcon,setCustomIcon]=useState(folder.icon||'');
    useEffect(()=>setCustomIcon(folder.icon||''),[folder.id,folder.icon]);
    return <div className="mt-3 space-y-3 rounded-2xl border border-white/[.07] bg-dark-950/55 p-3"><p className="text-xs font-medium text-dark-300">آیکون و رنگ کشو</p><div className="grid grid-cols-8 gap-1.5">{icons.map(icon=><button key={icon} disabled={pending} onClick={()=>{setCustomIcon(icon);void onUpdate({icon})}} className={`flex aspect-square items-center justify-center rounded-xl border text-lg ${folder.icon===icon?'border-primary-400 bg-primary-500/15':'border-white/[.06] bg-white/[.03]'}`}>{icon}</button>)}</div><div className="flex items-center gap-2"><input value={customIcon} onChange={event=>setCustomIcon(Array.from(event.target.value).slice(0,4).join(''))} className="input h-10 min-w-0 flex-1 text-center text-lg" inputMode="text" placeholder="ایموجی دلخواه از صفحه‌کلید" aria-label="ایموجی دلخواه کشو"/><button disabled={pending||!customIcon.trim()} onClick={()=>void onUpdate({icon:customIcon.trim()})} className="h-10 shrink-0 rounded-xl bg-primary-500/15 px-3 text-xs text-primary-200 disabled:opacity-40">ثبت</button></div><p className="text-[10px] leading-5 text-dark-500">کادر بالا را لمس کن و ایموجی دلخواهت را از صفحه‌کلید گوشی انتخاب کن.</p><div className="flex flex-wrap items-center gap-2">{colors.map(color=><button key={color} disabled={pending} aria-label={`رنگ ${color}`} onClick={()=>void onUpdate({color})} className={`h-8 w-8 rounded-full border-2 ${folder.color===color?'border-white ring-2 ring-primary-400/40':'border-white/20'}`} style={{backgroundColor:color}}/>)}<input dir="ltr" type="color" value={folder.color||'#8B5CF6'} disabled={pending} onChange={event=>void onUpdate({color:event.target.value})} className="h-8 w-10 cursor-pointer rounded-lg border-0 bg-transparent p-0" title="رنگ دلخواه"/></div><div className="grid grid-cols-2 gap-2"><label className="flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-primary-500/10 text-xs text-primary-200"><ImageIcon className="h-4 w-4"/>انتخاب کاور<input type="file" accept="image/*" className="hidden" disabled={pending} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void onUpload(file)}}/></label><button disabled={pending||!folder.cover_file_id} onClick={()=>void onUpdate({cover_file_id:null})} className="min-h-11 rounded-xl bg-white/[.04] text-xs text-dark-300 disabled:opacity-40">حذف کاور</button></div><button disabled={pending} onClick={()=>{setCustomIcon('');void onUpdate({icon:null,color:null,cover_file_id:null})}} className="w-full text-center text-[11px] text-dark-500 hover:text-white">بازگشت به ظاهر پیش‌فرض</button></div>;
}

function ActionTile({icon,label,onClick,danger=false}:{icon:React.ReactElement;label:string;onClick:()=>void|Promise<void>;danger?:boolean}){
    return <button onClick={()=>void onClick()} className={`flex min-h-14 min-w-0 items-center gap-2 rounded-2xl border px-3 py-2 text-right text-xs transition active:scale-[.98] ${danger?'border-red-500/15 bg-red-500/[.07] text-red-300 hover:bg-red-500/12':'border-white/[.06] bg-white/[.035] text-dark-200 hover:border-primary-400/20 hover:bg-primary-500/[.07]'}`}><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${danger?'bg-red-500/10':'bg-primary-500/10 text-primary-300'} [&>svg]:h-4 [&>svg]:w-4`}>{icon}</span><span className="min-w-0 leading-5">{label}</span></button>;
}
