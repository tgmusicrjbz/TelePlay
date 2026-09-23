/**
 * AppState management using Zustand
 */
import { create } from 'zustand';
import { TelegramFile, Folder } from './api';

interface AppState {
    // Current navigation
    currentFolderId: number | null;
    setCurrentFolderId: (id: number | null) => void;

    // Breadcrumb path
    breadcrumbs: Array<{ id: number | null; name: string }>;
    setBreadcrumbs: (breadcrumbs: Array<{ id: number | null; name: string }>) => void;

    // Selection
    selectedFileIds: Set<number>;
    selectedFolderIds: Set<number>;
    selectFile: (id: number, multi?: boolean) => void;
    deselectFile: (id: number) => void;
    selectFolder: (id: number, multi?: boolean) => void;
    deselectFolder: (id: number) => void;
    clearSelection: () => void;
    selectAll: (fileIds: number[], folderIds?: number[]) => void;

    // View mode
    viewMode: 'grid' | 'list';
    setViewMode: (mode: 'grid' | 'list') => void;

    // Modals
    previewFile: TelegramFile | null;
    setPreviewFile: (file: TelegramFile | null) => void;

    renameFile: TelegramFile | null;
    setRenameFile: (file: TelegramFile | null) => void;

    renameFolder: Folder | null;
    setRenameFolder: (folder: Folder | null) => void;

    descriptionItem: { type: 'file'; item: TelegramFile } | { type: 'folder'; item: Folder } | null;
    setDescriptionItem: (item: { type: 'file'; item: TelegramFile } | { type: 'folder'; item: Folder } | null) => void;

    moveItems: { files: TelegramFile[], folders: Folder[] } | null;
    setMoveItems: (items: { files: TelegramFile[], folders: Folder[] } | null) => void;
    setMoveFiles: (files: TelegramFile[]) => void;

    showNewFolder: boolean;
    setShowNewFolder: (show: boolean) => void;

    deleteConfirm: { type: 'file' | 'folder' | 'multiple'; items: (TelegramFile | Folder)[] } | null;
    setDeleteConfirm: (item: { type: 'file' | 'folder' | 'multiple'; items: (TelegramFile | Folder)[] } | null) => void;

    // Clipboard
    clipboard: { mode: 'copy' | 'cut'; files: TelegramFile[]; folders: Folder[] } | null;
    setClipboard: (clipboard: { mode: 'copy' | 'cut'; files: TelegramFile[]; folders: Folder[] } | null) => void;

    // Player state
    isPlayerMinimized: boolean;
    setPlayerMinimized: (minimized: boolean) => void;
    playQueue: TelegramFile[];
    queueIndex: number;
    repeatMode: 'off' | 'all' | 'one';
    startQueue: (files: TelegramFile[], index?: number) => void;
    playQueueItem: (index: number) => void;
    playNext: () => boolean;
    playPrevious: () => boolean;
    shuffleQueue: () => void;
    setRepeatMode: (mode: 'off' | 'all' | 'one') => void;
    clearQueue: () => void;

    // Search
    searchQuery: string;
    setSearchQuery: (query: string) => void;

    // Filter
    fileTypeFilter: string[];
    setFileTypeFilter: (type: string | null) => void;

    // Context menu - only one can be open at a time, with position for fixed positioning
    activeContextMenu: { type: 'file'; item: TelegramFile; x: number; y: number } | { type: 'folder'; item: Folder; x: number; y: number } | null;
    setActiveContextMenu: (menu: { type: 'file'; item: TelegramFile; x: number; y: number } | { type: 'folder'; item: Folder; x: number; y: number } | null) => void;
    selectedFiles: TelegramFile[];
    setSelectedFiles: (files: TelegramFile[]) => void;

    // Navigation Section
    activeSection: 'files' | 'recent' | 'continue_watching' | 'playlists';
    setActiveSection: (section: 'files' | 'recent' | 'continue_watching' | 'playlists') => void;

    // Toast Notifications
    toasts: Array<{ id: string; message: string; type: 'success' | 'error' | 'info' }>;
    addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
    removeToast: (id: string) => void;

    // Drag Selection Box
    selectionBox: { x1: number; y1: number; x2: number; y2: number; active: boolean } | null;
    setSelectionBox: (box: { x1: number; y1: number; x2: number; y2: number; active: boolean } | null) => void;
}

export const useAppStore = create<AppState>((set) => ({
    // Navigation
    currentFolderId: null,
    setCurrentFolderId: (id) => set({ currentFolderId: id }),

    // Breadcrumbs
    breadcrumbs: [{ id: null, name: 'کمد من' }],
    setBreadcrumbs: (breadcrumbs) => set({ breadcrumbs }),

    // Navigation Section
    activeSection: 'files',
    setActiveSection: (section) => set({ activeSection: section, currentFolderId: null, breadcrumbs: [{ id: null, name: section === 'files' ? 'کمد من' : section === 'recent' ? 'تازه اضافه‌شده‌ها' : section === 'playlists' ? 'پلی‌لیست‌ها' : 'ادامه پخش' }] }),

    // Selection
    selectedFileIds: new Set(),
    selectedFolderIds: new Set(),
    selectFile: (id, multi = false) => set((state) => {
        if (multi) {
            const newSet = new Set(state.selectedFileIds);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return { selectedFileIds: newSet };
        }
        return { selectedFileIds: new Set([id]), selectedFolderIds: new Set() };
    }),
    deselectFile: (id) => set((state) => {
        const newSet = new Set(state.selectedFileIds);
        newSet.delete(id);
        return { selectedFileIds: newSet };
    }),
    selectFolder: (id, multi = false) => set((state) => {
        if (multi) {
            const newSet = new Set(state.selectedFolderIds);
            if (newSet.has(id)) newSet.delete(id);
            else newSet.add(id);
            return { selectedFolderIds: newSet };
        }
        return { selectedFolderIds: new Set([id]), selectedFileIds: new Set() };
    }),
    deselectFolder: (id) => set((state) => {
        const newSet = new Set(state.selectedFolderIds);
        newSet.delete(id);
        return { selectedFolderIds: newSet };
    }),
    clearSelection: () => set({ selectedFileIds: new Set(), selectedFolderIds: new Set() }),
    selectAll: (fileIds, folderIds = []) => set({ 
        selectedFileIds: new Set(fileIds),
        selectedFolderIds: new Set(folderIds)
    }),

    // View mode
    viewMode: 'grid',
    setViewMode: (mode) => set({ viewMode: mode }),

    // Modals
    previewFile: null,
    setPreviewFile: (file) => set({ previewFile: file }),

    renameFile: null,
    setRenameFile: (file) => set({ renameFile: file }),

    renameFolder: null,
    setRenameFolder: (folder) => set({ renameFolder: folder }),

    descriptionItem: null,
    setDescriptionItem: (item) => set({ descriptionItem: item }),

    moveItems: null,
    setMoveItems: (items) => set({ moveItems: items }),
    setMoveFiles: (files) => set({ moveItems: { files, folders: [] } }),
    selectedFiles: [],
    setSelectedFiles: (files) => set({ selectedFiles: files }),

    showNewFolder: false,
    setShowNewFolder: (show) => set({ showNewFolder: show }),

    deleteConfirm: null,
    setDeleteConfirm: (item) => set({ deleteConfirm: item }),

    // Clipboard
    clipboard: null,
    setClipboard: (clipboard) => set({ clipboard }),

    // Player state
    isPlayerMinimized: false,
    setPlayerMinimized: (minimized) => set({ isPlayerMinimized: minimized }),
    playQueue: [],
    queueIndex: -1,
    repeatMode: 'off',
    startQueue: (files, index = 0) => set({ playQueue: files, queueIndex: index, previewFile: files[index] || null, isPlayerMinimized: false }),
    playQueueItem: (index) => set((state) => ({ queueIndex: index, previewFile: state.playQueue[index] || state.previewFile })),
    playNext: () => {
        let changed = false;
        set((state) => {
            if (!state.playQueue.length) return state;
            let next = state.queueIndex + 1;
            if (next >= state.playQueue.length) {
                if (state.repeatMode !== 'all') return state;
                next = 0;
            }
            changed = true;
            return { queueIndex: next, previewFile: state.playQueue[next] };
        });
        return changed;
    },
    playPrevious: () => {
        let changed = false;
        set((state) => {
            if (!state.playQueue.length) return state;
            let previous = state.queueIndex - 1;
            if (previous < 0) {
                if (state.repeatMode !== 'all') return state;
                previous = state.playQueue.length - 1;
            }
            changed = true;
            return { queueIndex: previous, previewFile: state.playQueue[previous] };
        });
        return changed;
    },
    shuffleQueue: () => set((state) => {
        if (state.playQueue.length < 2) return state;
        const current = state.playQueue[state.queueIndex];
        const rest = state.playQueue.filter((_, index) => index !== state.queueIndex);
        for (let index = rest.length - 1; index > 0; index--) {
            const randomIndex = Math.floor(Math.random() * (index + 1));
            [rest[index], rest[randomIndex]] = [rest[randomIndex], rest[index]];
        }
        return { playQueue: [current, ...rest], queueIndex: 0 };
    }),
    setRepeatMode: (repeatMode) => set({ repeatMode }),
    clearQueue: () => set({ playQueue: [], queueIndex: -1 }),

    // Search
    searchQuery: '',
    setSearchQuery: (query) => set({ searchQuery: query }),

    // Filter
    fileTypeFilter: [],
    setFileTypeFilter: (type) => set((state) => {
        if (type === null) return { fileTypeFilter: [] };
        return {
            fileTypeFilter: state.fileTypeFilter.includes(type)
                ? state.fileTypeFilter.filter((item) => item !== type)
                : [...state.fileTypeFilter, type],
        };
    }),

    // Context menu - only one can be open at a time
    activeContextMenu: null,
    setActiveContextMenu: (menu) => set({ activeContextMenu: menu }),

    // Toast Notifications
    toasts: [],
    addToast: (message, type = 'success') => set((state) => {
        const id = Math.random().toString(36).substring(2, 9);
        return { toasts: [...state.toasts, { id, message, type }] };
    }),
    removeToast: (id) => set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
    })),

    // Drag Selection Box
    selectionBox: null,
    setSelectionBox: (box) => set({ selectionBox: box }),
}));
