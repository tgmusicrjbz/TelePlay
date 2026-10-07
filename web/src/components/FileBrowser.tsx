/**
 * Main FileBrowser component - the core of the web interface
 */
import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { FolderPlus, Folder as FolderIcon, Grid, LayoutGrid, List, Search, ChevronRight, Home, Clipboard, ArrowUp, Film, Music, Image as ImageIcon, FileText, StickyNote, FolderInput, Trash2, Pencil, X, SlidersHorizontal, Boxes, ArrowDown, ChevronDown, ChevronUp, Plus, CheckSquare, Square, ListChecks, ListPlus, Upload, Star, RefreshCw, Link2, DownloadCloud, Download, Eye, EyeOff, Minus, Pause, Play, Tags, Cloud, CloudOff } from 'lucide-react';
import { api, useFiles, useFolders, useFolderTree, useUpdateFile, useUpdateFolder, useDeleteFolder, useDeleteFiles, useMoveFiles, TelegramFile, Folder, useActivityFeed, useDeleteFolders, useMoveFolders, canPreviewText, SortCriterion, SortField, serializeSort, useBatchUpdateFiles, BatchFileEdit, useUploadFile, useImportLink } from '../lib/api';
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
import PlaylistBrowser from './PlaylistBrowser';
import SettingsPage from './SettingsPage';
import DownloadsPage from './DownloadsPage';
import CustomSelect from './CustomSelect';
import { applyTheme, getStoredTheme } from '../lib/theme';

const sortLabels: Record<SortField, string> = {
    name: 'نام', type: 'نوع', size: 'حجم', duration: 'مدت',
    created: 'تاریخ آپلود', updated: 'تاریخ ویرایش', count: 'تعداد فایل‌های کشو',
};

const extractImportUrls = (value: string) => {
    const starts = Array.from(value.matchAll(/https?:\/\//gi), match => match.index ?? -1).filter(index => index >= 0);
    return starts.map((start, index) => value.slice(start, starts[index + 1] ?? value.length)
        .split(/[\s<>()\[\]{}"']/, 1)[0]
        .replace(/[،,.;!?]+$/g, ''))
        .filter(Boolean);
};

export default function FileBrowser() {
    const readOnlyWorkspace = Boolean(localStorage.getItem('komod-active-workspace')) && localStorage.getItem('komod-active-workspace-permission') === 'read';
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

    // Pagination state
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [allFiles, setAllFiles] = useState<TelegramFile[]>([]);
    const [showSort, setShowSort] = useState(false);
    const [showFilters, setShowFilters] = useState(false);
    const [showBatchEdit, setShowBatchEdit] = useState(false);
    const [selectionMode, setSelectionMode] = useState(false);
    const [pullDistance, setPullDistance] = useState(0);
    const pullStartY = useRef<number | null>(null);
    const [favoriteOnly, setFavoriteOnly] = useState(false);
    const [showTextComposer, setShowTextComposer] = useState(false);
    const [showAddMenu, setShowAddMenu] = useState(false);
    const [showImportLink, setShowImportLink] = useState(false);
    const [importUrl, setImportUrl] = useState('');
    const [importFolder, setImportFolder] = useState<number | 'new' | null>(null);
    const [importFolderName, setImportFolderName] = useState('');
    const [importQuality, setImportQuality] = useState<'auto' | 'audio' | '480' | '720' | '1080'>('720');
    const [uploadProgress, setUploadProgress] = useState<{name:string; index:number; total:number; percent:number}|null>(null);
    const [uploadPanelMode, setUploadPanelMode] = useState<'open'|'collapsed'|'hidden'>('open');
    const [importJobs, setImportJobs] = useState<Array<{id:string; url:string; state:'queued'|'downloading'|'paused'|'cancelled'|'done'|'error'; message:string; saved:number}>>([]);
    const [importPanelMode, setImportPanelMode] = useState<'open'|'collapsed'|'hidden'>('open');
    const [forceOffline, setForceOffline] = useState(() => localStorage.getItem('komod-force-offline') === '1');
    const [showHidden, setShowHidden] = useState(false);
    const uploadAbortRef = useRef<AbortController | null>(null);
    const importUrls = useMemo(() => extractImportUrls(importUrl), [importUrl]);
    const importPlatform = useMemo<'youtube' | 'instagram' | null>(() => {
        if (importUrls.length !== 1) return null;
        try {
            const parsed = new URL(importUrls[0]);
            if (!['http:', 'https:'].includes(parsed.protocol)) return null;
            const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
            if (host === 'youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) return 'youtube';
            if (host === 'instagram.com' || host.endsWith('.instagram.com')) return 'instagram';
        } catch { /* incomplete URL */ }
        return null;
    }, [importUrls]);
    useEffect(() => {
        const syncConnectionMode = () => setForceOffline(localStorage.getItem('komod-force-offline') === '1');
        window.addEventListener('komod-connectivity-mode', syncConnectionMode);
        return () => window.removeEventListener('komod-connectivity-mode', syncConnectionMode);
    }, []);
    useEffect(() => {
        const lockVault = () => setShowHidden(false);
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
    const [contentScope, setContentScope] = useState<'all' | 'files' | 'folders'>('all');
    const [sortCriteria, setSortCriteria] = useState<SortCriterion[]>(() => {
        try { return JSON.parse(localStorage.getItem('komod-sort') || '') || [{ field: 'created', direction: 'desc' }]; }
        catch { return [{ field: 'created', direction: 'desc' }]; }
    });
    const sortValue = serializeSort(sortCriteria.filter(item => item.field !== 'count'));
    const folderSortValue = serializeSort(sortCriteria.filter(item => ['name', 'created', 'updated', 'count'].includes(item.field)));
    const [rootFilesMode, setRootFilesMode] = useState(() => localStorage.getItem('komod-root-files-mode') || 'folder');
    const [incomingFolderSetting, setIncomingFolderSetting] = useState(() => localStorage.getItem('komod-incoming-folder') || 'default');
    const { data: rootFolders } = useFolders(null, folderSortValue, false, showHidden);
    const { data: folderTree } = useFolderTree();
    const importFolderOptions = useMemo(() => {
        const result:{value:string;label:string}[]=[];
        const walk=(items:Folder[]|undefined,depth=0)=>items?.forEach(folder=>{result.push({value:String(folder.id),label:`${'— '.repeat(depth)}🗂️ ${folder.name}`});walk(folder.children,depth+1)});
        walk(folderTree);
        return result;
    },[folderTree]);
    const defaultFolder = rootFolders?.find(folder => folder.is_default);
    const effectiveFolderId = currentFolderId === null && rootFilesMode === 'files' && defaultFolder ? defaultFolder.id : currentFolderId;
    const incomingFolderId = currentFolderId ?? (incomingFolderSetting !== 'default' && Number.isFinite(Number(incomingFolderSetting)) ? Number(incomingFolderSetting) : defaultFolder?.id ?? null);

    useEffect(() => {
        const refreshMode = () => setRootFilesMode(localStorage.getItem('komod-root-files-mode') || 'folder');
        const refreshIncoming = () => setIncomingFolderSetting(localStorage.getItem('komod-incoming-folder') || 'default');
        window.addEventListener('komod-root-mode-changed', refreshMode);
        window.addEventListener('komod-incoming-folder-changed', refreshIncoming);
        return () => { window.removeEventListener('komod-root-mode-changed', refreshMode); window.removeEventListener('komod-incoming-folder-changed', refreshIncoming); };
    }, []);

    // Data Fetching
    const { data: filesList, isLoading: filesLoading, isFetching: filesFetching, refetch: refetchFiles } = useFiles(searchQuery.trim() ? undefined : effectiveFolderId, fileTypeFilter.join(',') || undefined, searchQuery || undefined, page, sortValue, favoriteOnly, false, showHidden);
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
        isLoading = filesLoading;
    }

    // Folder and file visibility is controlled from one shared content switcher.
    const { data: folders, isLoading: foldersLoading, refetch: refetchFolders } = useFolders(currentFolderId, folderSortValue, favoriteOnly, showHidden);
    const visibleFolders = folders?.filter(folder => {
        if (currentFolderId === null && rootFilesMode === 'files' && folder.is_default) return false;
        if (!searchQuery.trim()) return true;
        const query = searchQuery.trim().toLocaleLowerCase('fa');
        return folder.name.toLocaleLowerCase('fa').includes(query)
            || (folder.description || '').toLocaleLowerCase('fa').includes(query);
    });
    const showFolders = activeSection === 'files' && contentScope !== 'files';
    const showFiles = activeSection !== 'files' || contentScope !== 'folders';

    // Combined loading state
    isLoading = isLoading || (activeSection === 'files' && foldersLoading);
    
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
        if (params.get('share-target') !== '1') return;
        const shared = [params.get('url'), params.get('text')].filter(Boolean).join('\n');
        const urls = extractImportUrls(shared);
        if (urls.length) { setImportUrl(urls.join('\n')); setShowImportLink(true); }
        window.history.replaceState({}, '', window.location.pathname);
    }, []);

    useEffect(() => {
        const applyConnectionMode = () => {
            if (localStorage.getItem('komod-force-offline') === '1') setActiveSection('downloads');
        };
        applyConnectionMode();
        window.addEventListener('komod-connectivity-mode', applyConnectionMode);
        return () => window.removeEventListener('komod-connectivity-mode', applyConnectionMode);
    }, [setActiveSection]);

    useEffect(() => {
        if (activeSection !== 'files') {
            setSelectionMode(false);
            clearSelection();
        }
    }, [activeSection, clearSelection]);

    const handleWebUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const selected = Array.from(event.target.files || []);
        event.target.value = '';
        if (!selected.length) return;
        const controller = new AbortController();
        uploadAbortRef.current = controller;
        setUploadPanelMode('open');
        let uploaded = 0;
        try {
            for (const file of selected) {
                setUploadProgress({name:file.name,index:uploaded+1,total:selected.length,percent:0});
                await uploadFileMutation.mutateAsync({ file, folderId: incomingFolderId, signal: controller.signal, onProgress: percent => setUploadProgress({name:file.name,index:uploaded+1,total:selected.length,percent}) });
                uploaded += 1;
            }
            addToast(`${uploaded.toLocaleString('fa-IR')} فایل با موفقیت به کمد اضافه شد 📥`);
            handleRefresh();
        } catch (error:any) {
            if (controller.signal.aborted || error?.code === 'ERR_CANCELED') addToast(uploaded ? `${uploaded.toLocaleString('fa-IR')} فایل ذخیره شد و ادامهٔ آپلود لغو شد.` : 'آپلود لغو شد.', 'info');
            else addToast(uploaded ? `${uploaded.toLocaleString('fa-IR')} فایل ذخیره شد؛ ادامهٔ آپلود متوقف شد.` : 'آپلود فایل انجام نشد. کمی بعد دوباره تلاش کن.', 'error');
        } finally { uploadAbortRef.current = null; setUploadProgress(null); }
    };

    // handle refresh
    const handleRefresh = useCallback(() => {
        if (activeSection === 'files') {
            refetchFiles();
            refetchFolders();
        } else if (activeSection === 'activity') {
            refetchActivity();
        } else {
            window.location.reload();
        }
    }, [activeSection, refetchFiles, refetchFolders, refetchActivity]);

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
        if (file.file_type === 'video' || file.file_type === 'audio') {
            const queue = (displayFiles || []).filter(item => item.file_type === 'video' || item.file_type === 'audio');
            const index = queue.findIndex(item => item.id === file.id);
            startQueue(queue.length ? queue : [file], Math.max(0, index));
        } else if (file.file_type === 'image' || canPreviewText(file)) {
            setContentPreviewFile(file);
        }
    };

    const downloadSelectedFiles = async () => {
        addToast('دارم لینک‌های دانلود رو آماده می‌کنم…', 'info');
        for (const file of selectedFilesForActions) {
            try {
                const {data}=await api.post<TelegramFile>(`/files/${file.id}/share`);
                if(!data.public_stream_url) continue;
                const anchor=document.createElement('a');
                anchor.href=`${window.location.origin}${data.public_stream_url}${data.public_stream_url.includes('?')?'&':'?'}download=1`;
                anchor.download=file.file_name; document.body.appendChild(anchor); anchor.click(); anchor.remove();
                await new Promise(resolve=>setTimeout(resolve,250));
            } catch { /* continue with the remaining selected files */ }
        }
        addToast('دانلود فایل‌های انتخاب‌شده شروع شد.');
    };

    const openImportLink = () => { setImportFolder(incomingFolderId); setShowAddMenu(false); setShowImportLink(true); };
    const submitImportLink = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!importUrls.length) return;
        const classify = (raw:string) => { try { const host=new URL(raw).hostname.replace(/^www\./,''); return host==='youtu.be'||host==='youtube.com'||host.endsWith('.youtube.com')?'youtube':host==='instagram.com'||host.endsWith('.instagram.com')?'instagram':null; } catch{return null;} };
        if (importUrls.some(url => !classify(url))) { addToast('یکی از لینک‌ها معتبر نیست؛ فقط یوتیوب و اینستاگرام پذیرفته می‌شود.', 'error'); return; }
        try {
            let lastMessage='';
            const jobs:string[]=[];
            for (let index=0; index<importUrls.length; index++) {
                const url=importUrls[index], platform=classify(url);
                const result = await importLinkMutation.mutateAsync({ url, folder_id: importFolder === 'new' ? currentFolderId : importFolder, new_folder_name: importFolder === 'new' && index===0 ? importFolderName.trim() : undefined, quality: platform === 'instagram' ? 'auto' : importQuality });
                lastMessage=result.message;
                jobs.push(result.job_id);
                setImportJobs(previous => [...previous, {id:result.job_id,url,state:'queued',message:'در صف پردازش',saved:0}]);
                setImportPanelMode('open');
            }
            setShowImportLink(false); setImportUrl(''); setImportFolderName('');
            addToast(importUrls.length>1 ? `${importUrls.length.toLocaleString('fa-IR')} لینک به صف اضافه شد؛ وضعیت هرکدام را همین‌جا و در ربات می‌بینی.` : lastMessage);
            jobs.forEach(jobId => { void (async () => {
                for (let attempt=0; attempt<90; attempt++) {
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    try {
                        const {data}=await api.get<{state:'queued'|'downloading'|'paused'|'cancelled'|'done'|'error';message:string;saved:number}>(`/files/import-link/status/${jobId}`);
                        setImportJobs(previous => previous.map(job => job.id === jobId ? {...job,...data} : job));
                        if(data.state==='done'){ addToast(`${data.saved.toLocaleString('fa-IR')} فایل از لینک به کمد اضافه شد ✅`); handleRefresh(); window.setTimeout(()=>setImportJobs(previous=>previous.filter(job=>job.id!==jobId)),1800); return; }
                        if(data.state==='error'||data.state==='cancelled'){ if(data.state==='error') addToast(data.message,'error'); window.setTimeout(()=>setImportJobs(previous=>previous.filter(job=>job.id!==jobId)),1800); return; }
                    } catch { return; }
                }
            })(); });
        } catch (error: any) { addToast(error?.response?.data?.detail || 'ثبت لینک انجام نشد.', 'error'); }
    };

    const controlImportJob = async (jobId:string, action:'pause'|'cancel') => {
        try {
            const {data}=await api.post<{state:'queued'|'downloading'|'paused'|'cancelled'|'done'|'error';message:string;saved:number}>(`/files/import-link/status/${jobId}/${action}`);
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
            await queueOfflineText(fileName, textContent, incomingFolderId);
            setShowTextComposer(false); setTextFileName('یادداشت تازه'); setTextContent('');
            addToast('یادداشت روی دستگاه ذخیره شد؛ وقتی آنلاین بشی خودکار به کمد اضافه می‌شه 📝');
        };
        if (!navigator.onLine || localStorage.getItem('komod-force-offline') === '1') { await saveToOutbox(); return; }
        try {
            await uploadFileMutation.mutateAsync({ file: new File([textContent], fileName, { type: 'text/markdown;charset=utf-8' }), folderId: incomingFolderId });
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
    }, [currentFolderId, fileTypeFilter, favoriteOnly, searchQuery, activeSection, sortValue]);

    const selectedFilesForActions = displayFiles?.filter(file => selectedFileIds.has(file.id)) || [];
    const selectedPlayableFilesForActions = selectedFilesForActions.filter(file => file.file_type === 'audio' || file.file_type === 'video');
    const selectedFoldersForActions = folders?.filter(folder => selectedFolderIds.has(folder.id)) || [];
    const selectedItems = [...selectedFilesForActions, ...selectedFoldersForActions];
    const sectionTitle = activeSection === 'activity' ? 'فعالیت' : (breadcrumbs[breadcrumbs.length - 1]?.name || 'کمد من');
    const shownFolderCount = showFolders ? visibleFolders?.length || 0 : 0;
    const shownFileCount = showFiles ? displayFiles?.length || 0 : 0;
    const selectScope = (scope: 'all' | 'files' | 'folders') => {
        setContentScope(scope);
        if (scope === 'folders') setFileTypeFilter(null);
        clearSelection();
    };
    const toggleFileType = (type: string | null) => {
        if (type !== null) setContentScope('files');
        setFileTypeFilter(type);
        clearSelection();
    };
    const availableSortFields = (Object.keys(sortLabels) as SortField[]).filter(field => !sortCriteria.some(item => item.field === field));
    const updateSort = (index: number, next: SortCriterion) => setSortCriteria(sortCriteria.map((item, itemIndex) => itemIndex === index ? next : item));
    const moveSort = (index: number, offset: number) => {
        const target = index + offset;
        if (target < 0 || target >= sortCriteria.length) return;
        const next = [...sortCriteria];
        [next[index], next[target]] = [next[target], next[index]];
        setSortCriteria(next);
    };
    const removeSort = (index: number) => {
        const next = sortCriteria.filter((_, itemIndex) => itemIndex !== index);
        setSortCriteria(next.length ? next : [{ field: 'created', direction: 'desc' }]);
    };
    const visibleFileIds = showFiles ? displayFiles?.map(file => file.id) || [] : [];
    const visibleFolderIds = showFolders ? visibleFolders?.map(folder => folder.id) || [] : [];
    const visibleItemCount = visibleFileIds.length + visibleFolderIds.length;
    const allVisibleSelected = visibleItemCount > 0
        && visibleFileIds.every(id => selectedFileIds.has(id))
        && visibleFolderIds.every(id => selectedFolderIds.has(id));
    const toggleSelectAll = () => {
        if (allVisibleSelected) clearSelection();
        else selectAll(visibleFileIds, visibleFolderIds);
    };
    const cancelSelection = () => {
        clearSelection();
        setSelectionMode(false);
    };
    const toggleSelectionMode = () => {
        const nextMode = !selectionMode;
        clearSelection();
        setSelectionMode(nextMode);
    };

    return (
        <div dir="rtl" className="flex h-screen bg-dark-950 text-white selection:bg-primary-500/30 overflow-hidden">
            <Sidebar />
            
            <main className="relative flex min-w-0 flex-1 flex-col bg-gradient-to-br from-dark-950 to-dark-900 md:mr-24">
                {/* Header */}
                <header className="h-16 border-b border-white/[0.06] flex items-center justify-between px-4 sm:px-6 bg-dark-900/50 backdrop-blur-sm z-30 sticky top-0">
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
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full bg-dark-800/50 border border-white/[0.06] rounded-lg pr-9 pl-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary-500/50 focus:bg-dark-800 transition-all"
                            />
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
                        <button onClick={toggleConnectionMode} className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition ${forceOffline?'border-amber-400/25 bg-amber-500/10 text-amber-200':'border-emerald-400/20 bg-emerald-500/[.08] text-emerald-300'}`} title={forceOffline?'رفتن به حالت آنلاین':'رفتن به حالت آفلاین'} aria-label={forceOffline?'فعال‌کردن حالت آنلاین':'فعال‌کردن حالت آفلاین'}>{forceOffline?<CloudOff className="h-4 w-4"/>:<Cloud className="h-4 w-4"/>}</button>
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
                                <button onClick={() => setShowAddMenu(true)} className="btn-primary flex items-center gap-2 px-3 py-2 text-sm shadow-lg shadow-primary-500/20"><Plus className="h-4 w-4"/><span className="hidden sm:inline">افزودن به کمد</span></button>
                            </>
                        )}
                    </div>
                </header>

                {/* Content Area */}
                <div 
                    ref={containerRef}
                    className="relative flex-1 overflow-auto overscroll-y-contain p-4 pb-28 outline-none sm:p-6 md:pb-6 lg:p-8"
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
                    // Prevent default drag behaviors on container
                    onDragOver={(e) => e.preventDefault()}
                >
                    {pullEnabled && pullDistance > 0 && <div className="pointer-events-none fixed left-1/2 top-20 z-50 -translate-x-1/2 rounded-full border border-white/10 bg-dark-900/95 px-3 py-1.5 text-xs text-primary-200 shadow-xl backdrop-blur" style={{ transform: `translate(-50%, ${pullDistance / 3}px)` }}>{pullDistance >= 52 ? 'رها کن تا تازه بشه ✨' : 'برای تازه‌سازی پایین بکش'}</div>}
                    {!readOnlyWorkspace && (selectionMode || selectedItems.length > 0) && activeSection === 'files' && (
                        <div className="fixed inset-x-4 top-20 z-40 mx-auto flex min-h-14 w-auto max-w-7xl flex-nowrap items-center gap-1 overflow-x-auto rounded-2xl border border-primary-500/25 bg-dark-900/95 p-1.5 shadow-2xl backdrop-blur-xl sm:hidden">
                            <span className="shrink-0 px-2 text-xs font-semibold text-primary-200">{selectedItems.length ? `${selectedItems.length.toLocaleString('fa-IR')} انتخاب` : 'یک کارت را لمس کن'}</span>
                            {selectedItems.length === 1 && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-dark-200 hover:bg-white/10" aria-label="تغییر نام" title="تغییر نام" onClick={() => selectedFilesForActions[0] ? setRenameFile(selectedFilesForActions[0]) : setRenameFolder(selectedFoldersForActions[0])}><Pencil className="h-5 w-5" /></button>}
                            {selectedFilesForActions.length > 0 && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-dark-200 hover:bg-white/10" aria-label="تگ‌ها و ویرایش گروهی" title="افزودن، حذف یا جایگزینی تگ‌ها" onClick={() => setShowBatchEdit(true)}><Tags className="h-5 w-5" /></button>}
                            {selectedPlayableFilesForActions.length > 0 && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-emerald-300 hover:bg-emerald-500/10" aria-label="ساخت صف پخش موقت" title="پخش پشت‌سرهم فایل‌های انتخاب‌شده" onClick={() => { startQueue(selectedPlayableFilesForActions,0); cancelSelection(); addToast('صف پخش موقت ساخته شد.'); }}><Play className="h-5 w-5" /></button>}
                            {selectedPlayableFilesForActions.length > 0 && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary-500/10 text-primary-200 hover:bg-primary-500/20" aria-label="افزودن به پلی‌لیست" title="افزودن فایل‌های صدا و ویدیو به پلی‌لیست" onClick={() => setPlaylistFiles(selectedPlayableFilesForActions)}><ListPlus className="h-5 w-5" /></button>}
                            {selectedFilesForActions.length > 0 && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-primary-200 hover:bg-primary-500/10" aria-label="ذخیره آفلاین" title="افزودن همه به صف ذخیره آفلاین" onClick={() => { selectedFilesForActions.forEach(file => void saveFileOffline(file)); addToast(`${selectedFilesForActions.length.toLocaleString('fa-IR')} فایل به صف ذخیره آفلاین اضافه شد.`); }}><DownloadCloud className="h-5 w-5" /></button>}
                            {selectedFilesForActions.length > 0 && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-dark-200 hover:bg-white/10" aria-label="دانلود" title="دانلود فایل‌های انتخاب‌شده" onClick={() => void downloadSelectedFiles()}><Download className="h-5 w-5" /></button>}
                            <button disabled={!selectedItems.length} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-dark-200 hover:bg-white/10 disabled:opacity-30" aria-label="جابه‌جایی" title="جابه‌جایی" onClick={() => setMoveItems({ files: selectedFilesForActions, folders: selectedFoldersForActions })}><FolderInput className="h-5 w-5" /></button>
                            <button disabled={!selectedItems.length} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-red-300 hover:bg-red-500/10 disabled:opacity-30" aria-label="حذف" title="حذف" onClick={() => setDeleteConfirm({ type: selectedFoldersForActions.length && selectedFilesForActions.length ? 'multiple' : selectedFoldersForActions.length ? 'folder' : 'file', items: selectedItems })}><Trash2 className="h-5 w-5" /></button>
                            <button className="mr-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-dark-300 hover:bg-white/10" aria-label="پایان انتخاب گروهی" title="پایان انتخاب" onClick={cancelSelection}><X className="h-5 w-5" /></button>
                        </div>
                    )}
                    {activeSection === 'playlists' ? <PlaylistBrowser /> : activeSection === 'settings' ? <SettingsPage /> : activeSection === 'downloads' ? <DownloadsPage /> : <>
                    <div className="max-w-7xl mx-auto mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="flex min-w-0 items-center gap-3">
                            <h1 className="truncate text-2xl font-bold tracking-tight text-white sm:text-3xl">{sectionTitle}</h1>
                            {activeSection !== 'activity' && <span className="shrink-0 rounded-full border border-white/[0.07] bg-dark-800/70 px-2.5 py-1 text-xs text-dark-300">{(shownFolderCount + shownFileCount).toLocaleString('fa-IR')} مورد</span>}
                        </div>
                        {selectedItems.length > 0 ? (
                            <div className="fixed left-6 right-6 top-20 z-40 mx-auto hidden max-w-7xl flex-wrap items-center gap-1.5 rounded-2xl border border-primary-500/20 bg-dark-900/95 p-1.5 shadow-2xl backdrop-blur-xl sm:flex md:right-32 lg:left-8">
                                <span className="text-sm font-medium text-primary-200 px-2">{selectedItems.length.toLocaleString('fa-IR')} مورد انتخاب شده</span>
                                {selectedItems.length === 1 && <button className="btn-secondary shrink-0 text-sm flex items-center gap-2" onClick={() => selectedFilesForActions[0] ? setRenameFile(selectedFilesForActions[0]) : setRenameFolder(selectedFoldersForActions[0])}><Pencil className="w-4 h-4" /> تغییر نام</button>}
                                {selectedFilesForActions.length > 0 && <button className="btn-secondary shrink-0 text-sm flex items-center gap-2" onClick={() => setShowBatchEdit(true)}><Tags className="w-4 h-4" /> تگ‌ها و ویرایش</button>}
                                {selectedPlayableFilesForActions.length > 0 && <button className="btn-secondary shrink-0 text-sm flex items-center gap-2 text-emerald-200" onClick={() => { startQueue(selectedPlayableFilesForActions,0); cancelSelection(); addToast('صف پخش موقت ساخته شد.'); }}><Play className="w-4 h-4" /> پخش پشت‌سرهم</button>}
                                {selectedPlayableFilesForActions.length > 0 && <button className="btn-secondary shrink-0 text-sm flex items-center gap-2" onClick={() => setPlaylistFiles(selectedPlayableFilesForActions)}><ListPlus className="w-4 h-4" /> افزودن به پلی‌لیست</button>}
                                {selectedFilesForActions.length > 0 && <button className="btn-secondary shrink-0 text-sm flex items-center gap-2" onClick={() => { selectedFilesForActions.forEach(file => void saveFileOffline(file)); addToast(`${selectedFilesForActions.length.toLocaleString('fa-IR')} فایل به صف ذخیره آفلاین اضافه شد.`); }}><DownloadCloud className="w-4 h-4" /> ذخیره آفلاین</button>}
                                {selectedFilesForActions.length > 0 && <button className="btn-secondary shrink-0 text-sm flex items-center gap-2" onClick={() => void downloadSelectedFiles()}><Download className="w-4 h-4" /> دانلود</button>}
                                <button className="btn-secondary shrink-0 text-sm flex items-center gap-2" onClick={() => setMoveItems({ files: selectedFilesForActions, folders: selectedFoldersForActions })}><FolderInput className="w-4 h-4" /> جابه‌جایی</button>
                                <button className="btn-secondary shrink-0 text-sm flex items-center gap-2 text-red-300" onClick={() => setDeleteConfirm({ type: selectedFoldersForActions.length && selectedFilesForActions.length ? 'multiple' : selectedFoldersForActions.length ? 'folder' : 'file', items: selectedItems })}><Trash2 className="w-4 h-4" /> حذف</button>
                                <button className="btn-icon shrink-0" title="پایان انتخاب" onClick={cancelSelection}><X className="w-4 h-4" /></button>
                            </div>
                        ) : null}
                    </div>
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
                                    <button title="فقط نشان‌شده‌ها" aria-label="فقط نشان‌شده‌ها" onClick={() => { setFavoriteOnly(value => !value); setPage(1); setAllFiles([]); }} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs transition-colors ${favoriteOnly ? 'bg-amber-400/15 text-amber-200' : 'text-dark-400 hover:text-white'}`}><Star className={`h-4 w-4 ${favoriteOnly ? 'fill-current' : ''}`}/></button>
                                    <button title={showHidden?'بستن گاوصندوق':'نمایش موارد مخفی'} aria-label={showHidden?'بستن گاوصندوق':'نمایش موارد مخفی'} onClick={() => { if (showHidden) { setShowHidden(false); setPage(1); setAllFiles([]); return; } if (!sessionStorage.getItem('komod-vault-token')) { addToast('اول از تنظیمات امنیتی، گاوصندوق را باز کن.', 'error'); setActiveSection('settings'); return; } setShowHidden(true); setPage(1); setAllFiles([]); }} className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs transition-colors ${showHidden ? 'bg-amber-400/15 text-amber-200' : 'text-dark-400 hover:text-white'}`}>{showHidden?<Eye className="h-4 w-4"/>:<EyeOff className="h-4 w-4"/>}</button>
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
                                    <div className="grid grid-cols-5 overflow-hidden rounded-xl border border-white/[.07] bg-dark-950/60 p-1">
                                        {([
                                            ['ویدیو', 'video', Film], ['موسیقی و صدا', 'audio', Music],
                                            ['عکس', 'image', ImageIcon], ['سند', 'document', FileText], ['متن و یادداشت', 'text', StickyNote],
                                        ] as const).map(([label, type, Icon]) => (
                                            <button key={type} title={label} aria-label={label} onClick={() => toggleFileType(type)} className={`flex h-9 min-w-0 items-center justify-center rounded-lg transition-colors ${fileTypeFilter.includes(type) ? 'bg-primary-600 text-white shadow' : 'text-dark-400 hover:bg-white/[.05] hover:text-white'}`}>
                                                <Icon className="h-4 w-4" />
                                            </button>
                                        ))}
                                    </div>
                                    {fileTypeFilter.length > 0 && <button title="پاک‌کردن فیلترها" aria-label="پاک‌کردن فیلترها" onClick={() => toggleFileType(null)} className="mt-2 flex h-9 w-full items-center justify-center gap-2 rounded-xl text-xs text-red-300 hover:bg-red-500/10"><X className="h-4 w-4"/> پاک‌کردن فیلترها</button>}
                                </div>
                            )}
                            {showSort && (
                                <div className="mt-3 border-t border-white/[0.06] pt-3">
                                    <div className="mb-3 flex items-center justify-between gap-3">
                                        <p className="text-sm font-medium text-white">مرتب‌سازی چندمرحله‌ای ✨</p>
                                        <button onClick={() => setSortCriteria([{ field: 'created', direction: 'desc' }])} className="shrink-0 text-xs text-dark-400 hover:text-white">حالت پیش‌فرض</button>
                                    </div>
                                    <div className="grid gap-1.5">
                                        {sortCriteria.map((item, index) => (
                                            <div key={item.field} className="flex min-w-0 items-center gap-1 rounded-xl border border-white/[0.08] bg-dark-800/60 p-1.5">
                                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-500/15 text-xs text-primary-300">{(index + 1).toLocaleString('fa-IR')}</span>
                                                <span className="min-w-0 flex-1 truncate text-xs sm:text-sm">{sortLabels[item.field]}</span>
                                                <button className="shrink-0 rounded-lg bg-dark-700 px-2 py-1.5 text-xs hover:bg-dark-600" onClick={() => updateSort(index, { ...item, direction: item.direction === 'asc' ? 'desc' : 'asc' })}>
                                                    {item.direction === 'asc' ? <><ArrowUp className="inline h-3.5 w-3.5" /> صعودی</> : <><ArrowDown className="inline h-3.5 w-3.5" /> نزولی</>}
                                                </button>
                                                <button className="btn-icon shrink-0 p-1.5" disabled={index === 0} title="یک اولویت بالاتر" onClick={() => moveSort(index, -1)}><ChevronUp className="h-4 w-4" /></button><button className="btn-icon shrink-0 p-1.5" disabled={index === sortCriteria.length - 1} title="یک اولویت پایین‌تر" onClick={() => moveSort(index, 1)}><ChevronDown className="h-4 w-4" /></button><button className="btn-icon shrink-0 p-1.5 text-red-300" title="حذف این معیار" onClick={() => removeSort(index)}><X className="h-4 w-4" /></button>
                                            </div>
                                        ))}
                                    </div>
                                    {availableSortFields.length > 0 && <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
                                        {availableSortFields.map(field => <button key={field} className="flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-white/10 bg-dark-800 px-2 text-xs text-dark-300 hover:border-primary-500/30 hover:text-white" onClick={() => setSortCriteria([...sortCriteria, { field, direction: 'asc' }])}><Plus className="h-3.5 w-3.5" /> {sortLabels[field]}</button>)}
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
                             {shownFolderCount + shownFileCount > 0 ? (
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
                                        {contentScope === 'folders' ? 'کشویی پیدا نشد' : 'چیزی پیدا نشد'}
                                    </h3>
                                    <p className="text-dark-400 max-w-xs">
                                        {searchQuery ? 'عبارت جست‌وجو یا فیلترها را تغییر بده.' : 'فایل‌ها را برای ربات تلگرام بفرست تا به کمدت اضافه شوند.'}
                                    </p>
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
                onClose={() => setDescriptionItem(null)}
                onSave={handleSaveDescription}
            />
            <BatchEditModal
                open={showBatchEdit}
                count={selectedFilesForActions.length}
                onClose={() => setShowBatchEdit(false)}
                onSave={handleBatchEdit}
            />
            {showAddMenu && <div className="fixed inset-0 z-[165] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setShowAddMenu(false)}><div className="w-full max-w-md rounded-t-3xl border border-white/10 bg-dark-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:rounded-3xl" onClick={event => event.stopPropagation()}><div className="mx-auto mb-4 h-1 w-12 rounded-full bg-white/20 sm:hidden"/><div className="flex items-center justify-between"><h2 className="font-bold">➕ افزودن به کمد</h2><button className="btn-icon" onClick={() => setShowAddMenu(false)}><X className="h-5 w-5"/></button></div><div className="mt-4 grid grid-cols-2 gap-2"><button className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-white/[.07] bg-dark-800/60 text-sm" onClick={() => { setShowAddMenu(false); uploadInputRef.current?.click(); }}><Upload className="h-6 w-6 text-primary-300"/> آپلود فایل</button><button className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-white/[.07] bg-dark-800/60 text-sm" onClick={() => { setShowAddMenu(false); setShowTextComposer(true); }}><StickyNote className="h-6 w-6 text-primary-300"/> یادداشت متنی</button><button className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-white/[.07] bg-dark-800/60 text-sm" onClick={() => { setShowAddMenu(false); setShowNewFolder(true); }}><FolderPlus className="h-6 w-6 text-primary-300"/> ساخت کشو</button><button className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-2xl border border-white/[.07] bg-dark-800/60 text-sm" onClick={openImportLink}><Link2 className="h-6 w-6 text-primary-300"/> ذخیره از لینک</button></div></div></div>}
            {uploadProgress&&uploadPanelMode==='hidden'&&<button onClick={()=>setUploadPanelMode('open')} className="fixed bottom-24 left-4 z-[175] flex h-11 items-center gap-2 rounded-full border border-primary-500/25 bg-dark-900/95 px-3 text-xs text-primary-200 shadow-2xl backdrop-blur-xl" title="نمایش وضعیت آپلود"><Upload className="h-4 w-4"/><span>{uploadProgress.percent.toLocaleString('fa-IR')}٪</span><Eye className="h-3.5 w-3.5"/></button>}
            {uploadProgress&&uploadPanelMode!=='hidden'&&<div className="fixed bottom-24 left-4 right-4 z-[175] mx-auto max-w-md rounded-2xl border border-primary-500/25 bg-dark-900/95 p-3 shadow-2xl backdrop-blur-xl"><div className="flex items-center gap-3"><Upload className="h-5 w-5 text-primary-300"/><div className="min-w-0 flex-1"><div className="flex justify-between gap-2 text-xs"><span className="truncate">{uploadProgress.name}</span><span dir="ltr">{uploadProgress.index}/{uploadProgress.total} · {uploadProgress.percent}%</span></div>{uploadPanelMode==='open'&&<div className="mt-2 h-2 overflow-hidden rounded-full bg-dark-700"><div className="h-full rounded-full bg-primary-500 transition-[width]" style={{width:`${uploadProgress.percent}%`}}/></div>}</div><button className="btn-icon h-8 w-8" onClick={()=>setUploadPanelMode(uploadPanelMode==='collapsed'?'open':'collapsed')} title="کوچک کردن">{uploadPanelMode==='collapsed'?<ChevronUp className="h-4 w-4"/>:<Minus className="h-4 w-4"/>}</button><button className="btn-icon h-8 w-8" onClick={()=>setUploadPanelMode('hidden')} title="پنهان کردن"><Eye className="h-4 w-4"/></button><button onClick={() => uploadAbortRef.current?.abort()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-500/10 text-red-300 hover:bg-red-500/20" title="لغو آپلود" aria-label="لغو آپلود"><X className="h-4 w-4"/></button></div></div>}
            {importJobs.length>0&&importPanelMode==='hidden'&&<button onClick={()=>setImportPanelMode('open')} className="fixed bottom-24 left-4 z-[174] flex h-11 items-center gap-2 rounded-full border border-white/10 bg-dark-900/95 px-3 text-xs text-primary-200 shadow-2xl backdrop-blur-xl" title="نمایش وضعیت لینک‌ها"><Link2 className="h-4 w-4"/><span>{importJobs.filter(job=>!['done','error','cancelled'].includes(job.state)).length.toLocaleString('fa-IR')}</span><Eye className="h-3.5 w-3.5"/></button>}
            {importJobs.length>0&&importPanelMode!=='hidden'&&<div className="fixed bottom-24 left-4 right-4 z-[174] mx-auto max-w-md overflow-hidden rounded-2xl border border-white/10 bg-dark-900/95 shadow-2xl backdrop-blur-xl"><div className="flex h-11 items-center gap-2 border-b border-white/[.06] px-3"><Link2 className="h-4 w-4 text-primary-300"/><strong className="flex-1 text-sm">افزودن از لینک</strong><button className="btn-icon h-8 w-8" onClick={()=>setImportPanelMode(importPanelMode==='collapsed'?'open':'collapsed')} title="کوچک کردن">{importPanelMode==='collapsed'?<ChevronUp className="h-4 w-4"/>:<Minus className="h-4 w-4"/>}</button><button className="btn-icon h-8 w-8" onClick={()=>setImportPanelMode('hidden')} title="پنهان کردن"><X className="h-4 w-4"/></button></div>{importPanelMode==='collapsed'?<div className="px-3 py-2 text-xs text-dark-400">{importJobs.filter(job=>!['done','error','cancelled'].includes(job.state)).length.toLocaleString('fa-IR')} مورد فعال یا در صف</div>:<div className="max-h-48 space-y-1 overflow-y-auto p-2">{importJobs.map(job=><div key={job.id} className="rounded-xl bg-white/[.025] p-2.5"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 shrink-0 rounded-full ${job.state==='done'?'bg-emerald-400':job.state==='error'||job.state==='cancelled'?'bg-red-400':job.state==='paused'?'bg-amber-400':'animate-pulse bg-primary-400'}`}/><span dir="ltr" className="min-w-0 flex-1 truncate text-xs text-dark-300">{job.url}</span><span className="text-[10px] text-dark-500">{job.state==='queued'?'در صف':job.state==='downloading'?'در حال آماده‌سازی':job.state==='paused'?'متوقف':job.state==='cancelled'?'لغو شد':job.state==='done'?'آماده شد':'ناموفق'}</span>{['queued','downloading','paused'].includes(job.state)&&<><button className="btn-icon h-7 w-7" onClick={()=>void controlImportJob(job.id,'pause')} title={job.state==='paused'?'ادامه':'توقف موقت'}>{job.state==='paused'?<Play className="h-3.5 w-3.5"/>:<Pause className="h-3.5 w-3.5"/>}</button><button className="btn-icon h-7 w-7 text-red-300" onClick={()=>void controlImportJob(job.id,'cancel')} title="لغو"><X className="h-3.5 w-3.5"/></button></>}</div><p className="mt-1 truncate pr-4 text-[10px] text-dark-500">{job.message}</p></div>)}</div>}</div>}
            {showImportLink && <div className="fixed inset-0 z-[170] flex items-end justify-center overflow-hidden bg-black/70 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setShowImportLink(false)}><form className="max-h-[92dvh] w-full max-w-lg overflow-x-hidden overflow-y-auto overscroll-contain rounded-t-3xl border border-white/10 bg-dark-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:max-h-[calc(100dvh-2rem)] sm:rounded-3xl sm:p-5" onClick={event => event.stopPropagation()} onSubmit={submitImportLink}><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/15 text-primary-200"><Link2 className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="font-bold">ذخیره از لینک</h2><p className="text-xs text-dark-400">لینک یوتیوب یا اینستاگرام را بفرست.</p></div><button type="button" className="btn-icon" onClick={() => setShowImportLink(false)}><X className="h-5 w-5"/></button></div><div className="mt-4"><textarea dir="ltr" autoFocus rows={3} className="input w-full resize-none" value={importUrl} onChange={event => setImportUrl(event.target.value)} placeholder="هر لینک را در یک خط بگذار…"/></div>{importUrl.trim() && <p className={`mt-2 text-xs ${importPlatform || importUrls.length > 1 ? 'text-emerald-300' : 'text-red-300'}`}>{importUrls.length > 1 ? `✓ ${importUrls.length.toLocaleString('fa-IR')} لینک برای افزودن دسته‌ای` : importPlatform === 'youtube' ? '✓ لینک یوتیوب شناسایی شد' : importPlatform === 'instagram' ? '✓ لینک اینستاگرام شناسایی شد' : 'لینک معتبر یوتیوب یا اینستاگرام نیست'}</p>}<CustomSelect className="mt-3" placement="top" label="کشوی مقصد" value={importFolder === 'new' ? 'new' : String(importFolder ?? 'root')} onChange={value => setImportFolder(value === 'new' ? 'new' : value === 'root' ? null : Number(value))} options={[{value:'root',label:'🗃️ فایل‌های من'},...(currentFolderId !== null?[{value:String(currentFolderId),label:'📍 کشوی فعلی'}]:[]),...importFolderOptions.filter(option => option.value !== String(currentFolderId)),{value:'new',label:'➕ ساخت کشوی تازه…'}]}/>{importFolder === 'new' && <input className="input mt-3 w-full" value={importFolderName} onChange={event => setImportFolderName(event.target.value)} placeholder="نام کشوی تازه"/>}{(importPlatform === 'youtube' || importUrls.length > 1) && <CustomSelect className="mt-3" placement="top" label="خروجی" value={importQuality} onChange={setImportQuality} options={[{value:'audio',label:'🎧 صدا'},{value:'480',label:'🎬 480p'},{value:'720',label:'🎬 720p'},{value:'1080',label:'🎬 1080p'}]}/>}<div className="mt-5 flex gap-2"><button type="button" className="btn-secondary flex-1" onClick={() => setShowImportLink(false)}>لغو</button><button disabled={!importUrl.trim() || (!importPlatform && importUrls.length < 2) || importLinkMutation.isPending || (importFolder === 'new' && !importFolderName.trim())} className="btn-primary flex-1 disabled:opacity-50">{importLinkMutation.isPending ? 'در حال ثبت…' : 'افزودن به صف'}</button></div></form></div>}
            {showTextComposer && (
                <div className="fixed inset-0 z-[170] flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={() => setShowTextComposer(false)}>
                    <form className="w-full max-w-2xl rounded-t-3xl border border-white/10 bg-dark-900 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl sm:rounded-3xl sm:p-5" onClick={event => event.stopPropagation()} onSubmit={handleCreateText}>
                        <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-500/15 text-primary-200"><StickyNote className="h-5 w-5"/></span><div className="min-w-0 flex-1"><h2 className="font-bold">یادداشت تازه</h2><p className="text-xs text-dark-400">متن بلند یا مارک‌داون را مستقیم در کمد ذخیره کن.</p></div><button type="button" className="btn-icon" onClick={() => setShowTextComposer(false)}><X className="h-5 w-5"/></button></div>
                        <input className="input mt-4 w-full" value={textFileName} onChange={event => setTextFileName(event.target.value)} placeholder="نام یادداشت" maxLength={240}/>
                        <textarea autoFocus className="input mt-3 min-h-[45vh] w-full resize-y font-mono leading-7" value={textContent} onChange={event => setTextContent(event.target.value)} placeholder="متنت را اینجا بنویس…"/>
                        <div className="mt-4 flex gap-2"><button type="button" className="btn-secondary flex-1" onClick={() => setShowTextComposer(false)}>لغو</button><button disabled={!textContent.trim() || uploadFileMutation.isPending} className="btn-primary flex-1 disabled:opacity-50">{uploadFileMutation.isPending ? 'در حال ذخیره…' : 'ذخیره متن'}</button></div>
                    </form>
                </div>
            )}
        </div>
    );
}
