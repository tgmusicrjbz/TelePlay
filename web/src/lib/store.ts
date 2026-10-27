/**
 * AppState management using Zustand
 */
import { create } from 'zustand';
import { TelegramFile, Folder } from './api';

type QueueFile = TelegramFile & { _queueEntryId?: string };

let queueEntrySequence = 0;
function createQueueEntry(file: TelegramFile): QueueFile {
    const queueEntryId = globalThis.crypto?.randomUUID?.()
        || `${Date.now().toString(36)}-${(++queueEntrySequence).toString(36)}`;
    return { ...file, _queueEntryId: queueEntryId };
}

function normalizeQueueEntries(files: TelegramFile[]): QueueFile[] {
    return files.map((file) => file._queueEntryId ? file as QueueFile : createQueueEntry(file));
}

type SavedPlayerState = {
    version: 1;
    queue: TelegramFile[];
    queueIndex: number;
    current: TelegramFile | null;
    repeatMode: 'off' | 'all' | 'one';
};

function playerStorageKey() {
    let account = 'guest';
    try {
        const user = JSON.parse(localStorage.getItem('user') || '{}');
        account = String(user.telegram_id || user.id || account);
    } catch { /* use isolated guest state */ }
    const workspace = localStorage.getItem('komod-active-workspace') || 'own';
    return `komod-player-state:${account}:${workspace}`;
}

function restorableMedia(file: unknown): file is TelegramFile {
    if (!file || typeof file !== 'object') return false;
    const item = file as TelegramFile;
    return Number.isFinite(item.id) && ['audio', 'video'].includes(item.file_type) && !String(item.stream_url || '').startsWith('blob:');
}

function loadPlayerState(): SavedPlayerState {
    const empty: SavedPlayerState = { version: 1, queue: [], queueIndex: -1, current: null, repeatMode: 'off' };
    try {
        const raw = JSON.parse(localStorage.getItem(playerStorageKey()) || 'null') as Partial<SavedPlayerState> | null;
        if (!raw || raw.version !== 1) return empty;
        const queue = Array.isArray(raw.queue) ? normalizeQueueEntries(raw.queue.filter(restorableMedia).slice(0, 250)) : [];
        const requestedIndex = Number(raw.queueIndex);
        const queueIndex = queue.length ? Math.min(Math.max(Number.isInteger(requestedIndex) ? requestedIndex : 0, 0), queue.length - 1) : -1;
        // The current file must be the exact queue occurrence. This matters when
        // the same track appears more than once and one occurrence is reordered.
        const current = queue[queueIndex] || (restorableMedia(raw.current) ? createQueueEntry(raw.current) : null);
        const repeatMode = ['off', 'all', 'one'].includes(String(raw.repeatMode)) ? raw.repeatMode as SavedPlayerState['repeatMode'] : 'off';
        return { version: 1, queue, queueIndex, current, repeatMode };
    } catch {
        return empty;
    }
}

const restoredPlayer = loadPlayerState();

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
    viewMode: 'grid' | 'dense' | 'list';
    setViewMode: (mode: 'grid' | 'dense' | 'list') => void;

    // Modals
    previewFile: TelegramFile | null;
    setPreviewFile: (file: TelegramFile | null) => void;
    contentPreviewFile: TelegramFile | null;
    setContentPreviewFile: (file: TelegramFile | null) => void;
    isContentPreviewMinimized: boolean;
    setContentPreviewMinimized: (minimized: boolean) => void;
    contentPreviewHistory: TelegramFile[];
    openLinkedContentFile: (file: TelegramFile) => void;
    goBackContentPreview: () => void;
    detailsFile: TelegramFile | null;
    setDetailsFile: (file: TelegramFile | null) => void;
    aiToolsFile: TelegramFile | null;
    setAIToolsFile: (file: TelegramFile | null) => void;

    renameFile: TelegramFile | null;
    setRenameFile: (file: TelegramFile | null) => void;

    renameFolder: Folder | null;
    setRenameFolder: (folder: Folder | null) => void;

    descriptionItem: { type: 'file'; item: TelegramFile; mode?: 'edit' | 'preview' } | { type: 'folder'; item: Folder; mode?: 'edit' | 'preview' } | null;
    setDescriptionItem: (item: { type: 'file'; item: TelegramFile; mode?: 'edit' | 'preview' } | { type: 'folder'; item: Folder; mode?: 'edit' | 'preview' } | null) => void;

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
    reverseQueue: () => void;
    removeQueueItem: (index: number) => void;
    moveQueueItem: (from: number, to: number) => void;
    appendQueueItems: (files: TelegramFile[]) => void;
    setRepeatMode: (mode: 'off' | 'all' | 'one') => void;
    clearQueue: () => void;

    // Search
    searchQuery: string;
    setSearchQuery: (query: string) => void;

    // Filter
    fileTypeFilter: string[];
    setFileTypeFilter: (type: string | null | string[]) => void;

    // Context menu - only one can be open at a time, with position for fixed positioning
    activeContextMenu: { type: 'file'; item: TelegramFile; x: number; y: number; packId?: number; packItemId?: number } | { type: 'folder'; item: Folder; x: number; y: number } | null;
    setActiveContextMenu: (menu: { type: 'file'; item: TelegramFile; x: number; y: number; packId?: number; packItemId?: number } | { type: 'folder'; item: Folder; x: number; y: number } | null) => void;
    selectedFiles: TelegramFile[];
    setSelectedFiles: (files: TelegramFile[]) => void;
    playlistFile: TelegramFile | null;
    setPlaylistFile: (file: TelegramFile | null) => void;
    playlistFiles: TelegramFile[];
    setPlaylistFiles: (files: TelegramFile[]) => void;

    // Navigation Section
    activeSection: 'files' | 'playlists' | 'activity' | 'downloads' | 'settings';
    setActiveSection: (section: 'files' | 'playlists' | 'activity' | 'downloads' | 'settings') => void;

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
    activeSection: window.location.pathname.startsWith('/playlist') ? 'playlists' : window.location.pathname.startsWith('/downloads') ? 'downloads' : 'files',
    setActiveSection: (section) => set({
        activeSection: section,
        currentFolderId: null,
        breadcrumbs: [{ id: null, name: section === 'files' ? 'کمد من' : section === 'playlists' ? 'پلی‌لیست‌ها' : section === 'activity' ? 'فعالیت' : section === 'downloads' ? 'دانلودها' : 'تنظیمات' }],
        searchQuery: '',
        fileTypeFilter: [],
        selectedFileIds: new Set(),
        selectedFolderIds: new Set(),
    }),

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
    previewFile: restoredPlayer.current,
    setPreviewFile: (file) => set({ previewFile: file }),
    contentPreviewFile: null,
    isContentPreviewMinimized: false,
    contentPreviewHistory: [],
    setContentPreviewFile: (file) => set(file ? { contentPreviewFile: file, isContentPreviewMinimized: false } : { contentPreviewFile: null, contentPreviewHistory: [], isContentPreviewMinimized: false }),
    setContentPreviewMinimized: (isContentPreviewMinimized) => set({isContentPreviewMinimized}),
    openLinkedContentFile: (file) => set((state) => ({
        contentPreviewFile: file,
        isContentPreviewMinimized: false,
        contentPreviewHistory: state.contentPreviewFile
            ? [...state.contentPreviewHistory, state.contentPreviewFile].slice(-20)
            : state.contentPreviewHistory,
    })),
    goBackContentPreview: () => set((state) => {
        const previous = state.contentPreviewHistory.at(-1);
        if (!previous) return state;
        return { contentPreviewFile: previous, contentPreviewHistory: state.contentPreviewHistory.slice(0, -1) };
    }),
    detailsFile: null,
    setDetailsFile: (file) => set({ detailsFile: file }),
    aiToolsFile: null,
    setAIToolsFile: (file) => set({ aiToolsFile: file }),

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
    playlistFile: null,
    setPlaylistFile: (file) => set({ playlistFile: file, playlistFiles: file ? [file] : [] }),
    playlistFiles: [],
    setPlaylistFiles: (files) => set({ playlistFiles: files, playlistFile: files[0] || null }),

    showNewFolder: false,
    setShowNewFolder: (show) => set({ showNewFolder: show }),

    deleteConfirm: null,
    setDeleteConfirm: (item) => set({ deleteConfirm: item }),

    // Clipboard
    clipboard: null,
    setClipboard: (clipboard) => set({ clipboard }),

    // Player state
    isPlayerMinimized: Boolean(restoredPlayer.current),
    setPlayerMinimized: (minimized) => set({ isPlayerMinimized: minimized }),
    playQueue: restoredPlayer.queue,
    queueIndex: restoredPlayer.queueIndex,
    repeatMode: restoredPlayer.repeatMode,
    startQueue: (files, index = 0) => set(() => {
        const queue = normalizeQueueEntries(files);
        const safeIndex = queue.length ? Math.min(Math.max(index, 0), queue.length - 1) : -1;
        return { playQueue: queue, queueIndex: safeIndex, previewFile: queue[safeIndex] || null, isPlayerMinimized: false };
    }),
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
    reverseQueue: () => set((state) => {
        if (state.playQueue.length < 2) return state;
        return { playQueue: [...state.playQueue].reverse(), queueIndex: state.playQueue.length - 1 - state.queueIndex };
    }),
    removeQueueItem: (index) => set((state) => {
        if (index < 0 || index >= state.playQueue.length || index === state.queueIndex) return state;
        const next = state.playQueue.filter((_, itemIndex) => itemIndex !== index);
        return { playQueue: next, queueIndex: index < state.queueIndex ? state.queueIndex - 1 : state.queueIndex };
    }),
    moveQueueItem: (from, to) => set((state) => {
        if (from < 0 || to < 0 || from >= state.playQueue.length || to >= state.playQueue.length || from === to) return state;
        const next = [...state.playQueue];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        let queueIndex = state.queueIndex;
        if (from === queueIndex) queueIndex = to;
        else if (from < queueIndex && to >= queueIndex) queueIndex -= 1;
        else if (from > queueIndex && to <= queueIndex) queueIndex += 1;
        return { playQueue: next, queueIndex };
    }),
    appendQueueItems: (files) => set((state) => {
        const existing = new Set(state.playQueue.map(item => item.id));
        const additions = files.filter(item => !existing.has(item.id) && ['audio','video'].includes(item.file_type));
        return additions.length ? {playQueue:[...state.playQueue,...additions.map(createQueueEntry)]} : state;
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
        if (Array.isArray(type)) return { fileTypeFilter: type.filter(Boolean) };
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
        if (state.toasts.some(toast => toast.message === message && toast.type === type)) return state;
        const id = Math.random().toString(36).substring(2, 9);
        return { toasts: [...state.toasts.slice(-1), { id, message, type }] };
    }),
    removeToast: (id) => set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
    })),

    // Drag Selection Box
    selectionBox: null,
    setSelectionBox: (box) => set({ selectionBox: box }),
}));

let lastSavedPlayerState = '';
useAppStore.subscribe((state) => {
    try {
        const queue = state.playQueue.filter(restorableMedia).slice(0, 250);
        const current = restorableMedia(state.previewFile) ? state.previewFile : null;
        const payload: SavedPlayerState = {
            version: 1,
            queue,
            queueIndex: queue.length ? Math.min(Math.max(state.queueIndex, 0), queue.length - 1) : -1,
            current,
            repeatMode: state.repeatMode,
        };
        const serialized = JSON.stringify(payload);
        if (serialized === lastSavedPlayerState) return;
        lastSavedPlayerState = serialized;
        if (!current && !queue.length) localStorage.removeItem(playerStorageKey());
        else localStorage.setItem(playerStorageKey(), serialized);
    } catch {
        // Playback must continue even when browser storage is unavailable/full.
    }
});
