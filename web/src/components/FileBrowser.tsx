/**
 * Main FileBrowser component - the core of the web interface
 */
import { useEffect, useCallback, useRef, useState } from 'react';
import { FolderPlus, Folder as FolderIcon, Grid, List, Search, ChevronRight, Home, Clipboard, ArrowUp, Film, Music, Image as ImageIcon, FileText, FolderInput, Trash2, Pencil, X, SlidersHorizontal, Boxes, ArrowDown, ChevronDown, ChevronUp, Plus, CheckSquare, Square, ListChecks, Upload } from 'lucide-react';
import { useFiles, useFolders, useUpdateFile, useUpdateFolder, useDeleteFolder, useDeleteFiles, useMoveFiles, TelegramFile, Folder, useActivityFeed, useDeleteFolders, useMoveFolders, canPreviewText, SortCriterion, SortField, serializeSort, useBatchUpdateFiles, BatchFileEdit, useUploadFile } from '../lib/api';
import { useAppStore } from '../lib/store';
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
import { applyTheme, getStoredTheme } from '../lib/theme';

const sortLabels: Record<SortField, string> = {
    name: 'نام', type: 'نوع', size: 'حجم', duration: 'مدت',
    created: 'تاریخ آپلود', updated: 'تاریخ ویرایش', count: 'تعداد فایل‌های کشو',
};

export default function FileBrowser() {
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
        addToast,
        setSelectedFiles,
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
    const [contentScope, setContentScope] = useState<'all' | 'files' | 'folders'>('all');
    const [sortCriteria, setSortCriteria] = useState<SortCriterion[]>(() => {
        try { return JSON.parse(localStorage.getItem('komod-sort') || '') || [{ field: 'created', direction: 'desc' }]; }
        catch { return [{ field: 'created', direction: 'desc' }]; }
    });
    const sortValue = serializeSort(sortCriteria.filter(item => item.field !== 'count'));
    const folderSortValue = serializeSort(sortCriteria.filter(item => ['name', 'created', 'updated', 'count'].includes(item.field)));

    // Data Fetching
    const { data: filesList, isLoading: filesLoading, refetch: refetchFiles } = useFiles(currentFolderId, fileTypeFilter.join(',') || undefined, searchQuery || undefined, page, sortValue);
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
    const { data: folders, isLoading: foldersLoading, refetch: refetchFolders } = useFolders(currentFolderId, folderSortValue);
    const visibleFolders = folders?.filter(folder => {
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

    const containerRef = useRef<HTMLDivElement>(null);
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const selectionStart = useRef({ x: 0, y: 0 });
    const pullStartY = useRef<number | null>(null);
    const [pullDistance, setPullDistance] = useState(0);

    useEffect(() => applyTheme(getStoredTheme()), []);

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
        let uploaded = 0;
        try {
            for (const file of selected) {
                await uploadFileMutation.mutateAsync({ file, folderId: currentFolderId });
                uploaded += 1;
            }
            addToast(`${uploaded.toLocaleString('fa-IR')} فایل با موفقیت به کمد اضافه شد 📥`);
            handleRefresh();
        } catch {
            addToast(uploaded ? `${uploaded.toLocaleString('fa-IR')} فایل ذخیره شد؛ ادامهٔ آپلود متوقف شد.` : 'آپلود فایل انجام نشد. اتصال ربات و کانال ذخیره‌سازی را بررسی کن.', 'error');
        }
    };

    // handle refresh
    const handleRefresh = useCallback(() => {
        if (activeSection === 'files') {
            refetchFiles();
            refetchFolders();
        } else if (activeSection === 'activity') {
            refetchActivity();
        }
    }, [activeSection, refetchFiles, refetchFolders, refetchActivity]);

    const handlePullStart = (event: React.TouchEvent<HTMLDivElement>) => {
        if (containerRef.current?.scrollTop === 0) pullStartY.current = event.touches[0]?.clientY ?? null;
    };
    const handlePullMove = (event: React.TouchEvent<HTMLDivElement>) => {
        if (pullStartY.current === null || containerRef.current?.scrollTop !== 0) return;
        setPullDistance(Math.min(88, Math.max(0, (event.touches[0].clientY - pullStartY.current) * 0.45)));
    };
    const handlePullEnd = () => {
        if (pullDistance >= 56) handleRefresh();
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
            setPreviewFile(file);
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
    }, [currentFolderId, fileTypeFilter, searchQuery, activeSection, sortValue]);

    const selectedFilesForActions = displayFiles?.filter(file => selectedFileIds.has(file.id)) || [];
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
                        {(activeSection === 'files' || activeSection === 'activity') && <div className="relative w-full max-w-xs md:w-64">
                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
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
                    <div className="flex items-center gap-2 sm:gap-3">
                         {(activeSection === 'files' || activeSection === 'activity') && <div className="hidden sm:flex items-center gap-1 bg-dark-800/50 rounded-lg p-0.5 border border-white/[0.06]">
                             <button
                                 onClick={() => setViewMode('grid')}
                                 className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-primary-600 text-white shadow-sm' : 'text-dark-400 hover:text-white hover:bg-white/[0.05]'}`}
                             >
                                 <Grid className="w-4 h-4" />
                             </button>
                             <button
                                 onClick={() => setViewMode('list')}
                                 className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-primary-600 text-white shadow-sm' : 'text-dark-400 hover:text-white hover:bg-white/[0.05]'}`}
                             >
                                 <List className="w-4 h-4" />
                             </button>
                         </div>}


                        {clipboard && (clipboard.files.length > 0 || clipboard.folders.length > 0) && (
                            <button
                                onClick={handlePaste}
                                className="mr-2 btn-secondary py-1.5 px-3 text-xs flex items-center gap-2 bg-primary-500/10 text-primary-300 border-primary-500/20 hover:bg-primary-500/20"
                            >
                                <Clipboard className="w-3.5 h-3.5" />
                                انتقال به اینجا ({clipboard.files.length + clipboard.folders.length})
                            </button>
                        )}

                        {activeSection === 'files' && (
                            <>
                                <input ref={uploadInputRef} type="file" multiple className="hidden" onChange={handleWebUpload} />
                                <button onClick={() => uploadInputRef.current?.click()} disabled={uploadFileMutation.isPending} className="mr-2 btn-secondary py-1.5 px-3 text-sm flex items-center gap-2 disabled:opacity-50" title="آپلود فایل از دستگاه">
                                    <Upload className={`w-4 h-4 ${uploadFileMutation.isPending ? 'animate-bounce' : ''}`} />
                                    <span className="hidden sm:inline">{uploadFileMutation.isPending ? 'در حال آپلود…' : 'آپلود'}</span>
                                </button>
                                <button
                                    onClick={() => setShowNewFolder(true)}
                                    className="btn-primary py-1.5 px-3 text-sm flex items-center gap-2 shadow-lg shadow-primary-500/20"
                                >
                                    <FolderPlus className="w-4 h-4" />
                                    <span className="hidden sm:inline">کشوی تازه</span>
                                </button>
                            </>
                        )}
                    </div>
                </header>

                {/* Content Area */}
                <div 
                    ref={containerRef}
                    className="relative flex-1 overflow-auto p-4 pb-28 outline-none sm:p-6 md:pb-6 lg:p-8"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                    onTouchStart={handlePullStart}
                    onTouchMove={handlePullMove}
                    onTouchEnd={handlePullEnd}
                    tabIndex={0}
                    // Prevent default drag behaviors on container
                    onDragOver={(e) => e.preventDefault()}
                >
                    {pullDistance > 0 && <div className="pointer-events-none absolute inset-x-0 top-2 z-20 flex justify-center" style={{ transform: `translateY(${pullDistance - 40}px)`, opacity: pullDistance / 56 }}><div className="rounded-full border border-white/10 bg-dark-800/90 px-3 py-1.5 text-xs text-dark-200 shadow-xl">{pullDistance >= 56 ? 'رها کن تا تازه بشه ✨' : 'برای تازه‌سازی بکش پایین'}</div></div>}
                    {(selectionMode || selectedItems.length > 0) && activeSection === 'files' && (
                        <div className="no-scrollbar sticky top-0 z-20 mx-auto mb-3 flex min-h-14 max-w-7xl flex-nowrap items-center gap-1 overflow-x-auto rounded-2xl border border-primary-500/25 bg-dark-900/95 p-1.5 shadow-2xl backdrop-blur-xl sm:hidden">
                            <span className="shrink-0 px-2 text-xs font-semibold text-primary-200">{selectedItems.length ? `${selectedItems.length.toLocaleString('fa-IR')} انتخاب` : 'یک کارت را لمس کن'}</span>
                            {selectedItems.length === 1 && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-dark-200 hover:bg-white/10" aria-label="تغییر نام" title="تغییر نام" onClick={() => selectedFilesForActions[0] ? setRenameFile(selectedFilesForActions[0]) : setRenameFolder(selectedFoldersForActions[0])}><Pencil className="h-5 w-5" /></button>}
                            {selectedFilesForActions.length > 0 && <button className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-dark-200 hover:bg-white/10" aria-label="ویرایش گروهی" title="ویرایش گروهی" onClick={() => setShowBatchEdit(true)}><SlidersHorizontal className="h-5 w-5" /></button>}
                            <button disabled={!selectedItems.length} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-dark-200 hover:bg-white/10 disabled:opacity-30" aria-label="جابه‌جایی" title="جابه‌جایی" onClick={() => setMoveItems({ files: selectedFilesForActions, folders: selectedFoldersForActions })}><FolderInput className="h-5 w-5" /></button>
                            <button disabled={!selectedItems.length} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-red-300 hover:bg-red-500/10 disabled:opacity-30" aria-label="حذف" title="حذف" onClick={() => setDeleteConfirm({ type: selectedFoldersForActions.length && selectedFilesForActions.length ? 'multiple' : selectedFoldersForActions.length ? 'folder' : 'file', items: selectedItems })}><Trash2 className="h-5 w-5" /></button>
                            <button className="mr-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-dark-300 hover:bg-white/10" aria-label="پایان انتخاب گروهی" title="پایان انتخاب" onClick={cancelSelection}><X className="h-5 w-5" /></button>
                        </div>
                    )}
                    {activeSection === 'playlists' ? <PlaylistBrowser /> : activeSection === 'settings' ? <SettingsPage /> : <>
                    <div className="max-w-7xl mx-auto mb-6 sm:mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                        <div>
                            <p className="text-xs font-semibold text-primary-300 mb-2">🗄️ کمد شخصی تو</p>
                            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">{sectionTitle}</h1>
                            <p className="text-sm text-dark-400 mt-2">
                                {activeSection === 'activity'
                                    ? 'فایل‌های نیمه‌کاره و تازه‌های کمد یک‌جا جمع شده‌اند.'
                                    : `${shownFolderCount.toLocaleString('fa-IR')} کشو و ${shownFileCount.toLocaleString('fa-IR')} فایل نمایش داده می‌شود`}
                            </p>
                        </div>
                        {selectedItems.length > 0 ? (
                            <div className="no-scrollbar hidden max-w-full flex-nowrap items-center gap-1.5 overflow-x-auto rounded-2xl border border-primary-500/20 bg-primary-500/10 p-1.5 sm:flex">
                                <span className="text-sm font-medium text-primary-200 px-2">{selectedItems.length.toLocaleString('fa-IR')} مورد انتخاب شده</span>
                                {selectedItems.length === 1 && <button className="btn-secondary shrink-0 text-sm flex items-center gap-2" onClick={() => selectedFilesForActions[0] ? setRenameFile(selectedFilesForActions[0]) : setRenameFolder(selectedFoldersForActions[0])}><Pencil className="w-4 h-4" /> تغییر نام</button>}
                                {selectedFilesForActions.length > 0 && <button className="btn-secondary shrink-0 text-sm flex items-center gap-2" onClick={() => setShowBatchEdit(true)}><SlidersHorizontal className="w-4 h-4" /> ویرایش گروهی</button>}
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
                                <div className="no-scrollbar flex items-center gap-2 overflow-x-auto py-1">
                                    <button title="فیلتر نوع فایل" onClick={() => { setShowFilters(value => !value); setShowSort(false); }} disabled={contentScope === 'folders'} className={`flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-white/10 bg-dark-900/70 px-3 text-xs text-dark-200 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${fileTypeFilter.length ? 'border-primary-500/40 text-primary-200' : ''}`}>
                                        <SlidersHorizontal className="h-4 w-4" />
                                        <span className="truncate">نوع فایل</span>
                                        {fileTypeFilter.length > 0 && <span className="rounded-full bg-primary-500 px-1.5 text-[10px] text-white">{fileTypeFilter.length.toLocaleString('fa-IR')}</span>}
                                    </button>
                                    <button title="مرتب‌سازی" onClick={() => { setShowSort(value => !value); setShowFilters(false); }} className={`flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-white/10 bg-dark-900/70 px-3 text-xs text-dark-200 transition-colors ${showSort ? 'border-primary-500/40 text-primary-200' : ''}`}>
                                        <ArrowDown className="h-4 w-4" /> <span className="truncate">مرتب‌سازی</span>
                                    </button>
                                    <button title="انتخاب چند فایل یا کشو" onClick={toggleSelectionMode} className={`flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-white/10 bg-dark-900/70 px-3 text-xs text-dark-200 transition-colors ${selectionMode ? 'border-primary-500/40 bg-primary-500/10 text-primary-200' : ''}`}>
                                        <ListChecks className="h-4 w-4" /> <span className="truncate">{selectionMode ? 'پایان انتخاب' : 'انتخاب گروهی'}</span>
                                    </button>
                                    {(selectionMode || selectedItems.length > 0) && (
                                        <button onClick={toggleSelectAll} disabled={visibleItemCount === 0} className="flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full border border-white/10 bg-dark-900/70 px-3 text-xs text-dark-200 disabled:opacity-40">
                                            {allVisibleSelected ? <CheckSquare className="h-4 w-4 text-primary-300" /> : <Square className="h-4 w-4" />}
                                            {allVisibleSelected ? 'لغو انتخاب همه' : 'انتخاب همه'}
                                        </button>
                                    )}
                                </div>
                            </div>
                            {showFilters && contentScope !== 'folders' && (
                                <div className="mt-3 border-t border-white/[0.06] pt-3">
                                    <div className="flex flex-wrap gap-2">
                                        {([
                                            ['ویدیو', 'video', Film], ['موسیقی و صوت', 'audio', Music],
                                            ['عکس', 'image', ImageIcon], ['سند', 'document', FileText], ['متن و یادداشت', 'text', FileText],
                                        ] as const).map(([label, type, Icon]) => (
                                            <button key={type} onClick={() => toggleFileType(type)} className={`flex items-center gap-2 rounded-full border px-3 py-2 text-xs font-medium transition-colors ${fileTypeFilter.includes(type) ? 'border-primary-500 bg-primary-600 text-white' : 'border-white/10 bg-dark-800 text-dark-300 hover:border-white/20 hover:text-white'}`}>
                                                <Icon className="h-4 w-4" /> {label}
                                            </button>
                                        ))}
                                        {fileTypeFilter.length > 0 && <button onClick={() => toggleFileType(null)} className="rounded-full px-3 py-2 text-xs text-red-300 hover:bg-red-500/10">پاک‌کردن فیلترها</button>}
                                    </div>
                                </div>
                            )}
                            {showSort && (
                                <div className="mt-3 border-t border-white/[0.06] pt-3">
                                    <div className="mb-3 flex items-center justify-between gap-3">
                                        <p className="text-sm font-medium text-white">مرتب‌سازی چندمرحله‌ای ✨</p>
                                        <button onClick={() => setSortCriteria([{ field: 'created', direction: 'desc' }])} className="shrink-0 text-xs text-dark-400 hover:text-white">حالت پیش‌فرض</button>
                                    </div>
                                    <div className="space-y-2">
                                        {sortCriteria.map((item, index) => (
                                            <div key={item.field} className="flex flex-wrap items-center gap-2 rounded-xl border border-white/[0.08] bg-dark-800/60 p-2">
                                                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary-500/15 text-xs text-primary-300">{(index + 1).toLocaleString('fa-IR')}</span>
                                                <span className="min-w-24 flex-1 text-sm">{sortLabels[item.field]}</span>
                                                <button className="rounded-lg bg-dark-700 px-2.5 py-1.5 text-xs hover:bg-dark-600" onClick={() => updateSort(index, { ...item, direction: item.direction === 'asc' ? 'desc' : 'asc' })}>
                                                    {item.direction === 'asc' ? <><ArrowUp className="inline h-3.5 w-3.5" /> صعودی</> : <><ArrowDown className="inline h-3.5 w-3.5" /> نزولی</>}
                                                </button>
                                                <button className="btn-icon p-1.5" disabled={index === 0} title="یک اولویت بالاتر" onClick={() => moveSort(index, -1)}><ChevronUp className="h-4 w-4" /></button>
                                                <button className="btn-icon p-1.5" disabled={index === sortCriteria.length - 1} title="یک اولویت پایین‌تر" onClick={() => moveSort(index, 1)}><ChevronDown className="h-4 w-4" /></button>
                                                <button className="btn-icon p-1.5 text-red-300" title="حذف این معیار" onClick={() => removeSort(index)}><X className="h-4 w-4" /></button>
                                            </div>
                                        ))}
                                    </div>
                                    {availableSortFields.length > 0 && <div className="mt-3 flex flex-wrap gap-2">
                                        {availableSortFields.map(field => <button key={field} className="flex items-center gap-1.5 rounded-full border border-white/10 bg-dark-800 px-3 py-2 text-xs text-dark-300 hover:border-primary-500/30 hover:text-white" onClick={() => setSortCriteria([...sortCriteria, { field, direction: 'asc' }])}><Plus className="h-3.5 w-3.5" /> {sortLabels[field]}</button>)}
                                    </div>}
                                </div>
                            )}
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
                                            <div className={viewMode === 'grid' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'flex flex-col gap-2'}>
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
                                            <div className={viewMode === 'grid' ? 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'flex flex-col gap-2'}>
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
                                <div className={viewMode === 'grid'
                                    ? 'max-w-7xl mx-auto grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 pb-20'
                                    : 'max-w-7xl mx-auto flex flex-col gap-2 pb-20'
                                }>
                                    {/* Folders */}
                                    {showFolders && visibleFolders?.map((folder) => (
                                        <FolderCard
                                            key={folder.id}
                                            folder={folder}
                                            viewMode={viewMode}
                                            selected={selectedFolderIds.has(folder.id)}
                                            selectionMode={selectionMode}
                                            onSelect={(multi) => selectFolder(folder.id, multi)}
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
                                            onSelect={(multi) => selectFile(file.id, selectionMode || multi)}
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
        </div>
    );
}
