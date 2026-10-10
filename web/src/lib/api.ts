/**
 * API client and hooks for the Komod backend.
 */
import axios from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cachedCurrentUser } from './accounts';

const normalizeServerOrigin = (value?: string | null) => {
    const trimmed = String(value || '').trim().replace(/\/+$/, '');
    if (!trimmed) return window.location.origin;
    try {
        const url = new URL(trimmed);
        return url.protocol === 'https:' || (url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))
            ? url.origin
            : window.location.origin;
    } catch { return window.location.origin; }
};

export const getServerOrigin = () => normalizeServerOrigin(localStorage.getItem('komod-server-origin'));
export const resolveServerUrl = (value: string) => value.startsWith('/') ? `${getServerOrigin()}${value}` : value;

// Types
export interface User {
    id: number;
    telegram_id: number;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    created_at: string;
    last_active: string;
    display_name?: string | null;
    is_active?: boolean;
    is_admin?: boolean;
    login_username?: string | null;
}

export interface AuthSession { id: string; device_name: string; user_agent?: string | null; ip_address?: string | null; created_at: string; last_seen_at: string; current: boolean; }
export interface Workspace { user_id: number; telegram_id: number; name: string; username?: string | null; permission: 'owner' | 'read' | 'write'; folder_ids: number[]; file_ids: number[]; }
export interface AdminUser extends User { total_size: number; file_count: number; session_count: number; }
export interface AdminStats { active_users: number; total_users: number; total_files: number; total_size: number; }
export interface AccountPreferences { delete_storage_files: boolean; }
export interface TagDefinition { name: string; color: string; file_count?: number; }
export interface TagSettings { tags: TagDefinition[]; show_file_tags: boolean; display_limit: number; }
export interface VaultStatus { configured: boolean; }
export interface StorageChannel { configured: boolean; channel_id?: number | null; title?: string | null; }

export interface Folder {
    id: number;
    name: string;
    description: string | null;
    parent_id: number | null;
    user_id: number;
    created_at: string;
    updated_at: string;
    file_count: number;
    is_favorite?: boolean;
    is_pinned?: boolean;
    is_default?: boolean;
    is_hidden?: boolean;
    children?: Folder[];
}

export interface TelegramFile {
    id: number;
    user_id: number;
    folder_id: number | null;
    file_id: string;
    file_unique_id: string;
    file_name: string;
    description: string | null;
    file_size: number;
    mime_type: string | null;
    file_type: 'video' | 'audio' | 'document' | 'image' | 'text';
    duration: number | null;
    width: number | null;
    height: number | null;
    created_at: string;
    updated_at: string;
    stream_url: string;
    thumbnail_url: string | null;
    last_pos?: number;
    public_hash?: string;
    public_stream_url?: string;
    is_favorite?: boolean;
    is_pinned?: boolean;
    is_hidden?: boolean;
    tags?: string[];
}

export interface FileListResponse {
    files: TelegramFile[];
    total: number;
    page: number;
    per_page: number;
}

export interface ActivityFeed {
    continue_watching: TelegramFile[];
    recent: TelegramFile[];
    favorites: TelegramFile[];
}

export interface PlaylistItem {
    id: number;
    position: number;
    added_at: string;
    file: TelegramFile;
}

export interface PlaylistSummary {
    id: number;
    name: string;
    description: string | null;
    item_count: number;
    total_duration: number;
    cover_url: string | null;
    cover_file_id: number | null;
    cover_urls: string[];
    audio_count: number;
    video_count: number;
    preview_names: string[];
    position?: number;
    created_at: string;
    updated_at: string;
}

export interface Playlist extends PlaylistSummary {
    items: PlaylistItem[];
}

export type SortField = 'name' | 'type' | 'size' | 'duration' | 'created' | 'updated' | 'count';
export type SortDirection = 'asc' | 'desc';
export interface SortCriterion { field: SortField; direction: SortDirection; }
export const serializeSort = (criteria: SortCriterion[]): string =>
    criteria.map(({ field, direction }) => `${field}:${direction}`).join(',');

export const canPreviewText = (file: TelegramFile): boolean =>
    file.file_type === 'text' || (file.file_type === 'document' && (
        file.mime_type?.startsWith('text/') ||
        ['application/json', 'application/xml'].includes(file.mime_type || '') ||
        /\.(txt|md|json|csv|log|xml|ya?ml)$/i.test(file.file_name)
    ));

export interface BotInfo {
    username: string;
    name?: string;
    server_version: string;
}

export interface LoginCodeResponse {
    code: string;
    expires_at: string;
}

export interface StorageStats {
    total_size: number;
    limit: number;
}

export interface AuthResponse {
    access_token: string;
    refresh_token: string;
    user: User;
}
export interface CredentialsStatus { enabled: boolean; username?: string | null; }

export function getKomodDeviceId(): string {
    const storageKey = 'komod-device-id';
    const existing = localStorage.getItem(storageKey);
    if (existing) return existing;
    const generated = typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(storageKey, generated);
    return generated;
}

// API client
export const api = axios.create({
    baseURL: `${getServerOrigin()}/api`,
    timeout: 15000,
});

const MEDIA_URL_KEYS = new Set(['stream_url', 'thumbnail_url', 'cover_url', 'public_stream_url']);
const resolveResponseMediaUrls = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(resolveResponseMediaUrls);
    if (!value || typeof value !== 'object') return value;
    const record = value as Record<string, unknown>;
    Object.entries(record).forEach(([key, item]) => {
        if (MEDIA_URL_KEYS.has(key) && typeof item === 'string') {
            const resolved = resolveServerUrl(item);
            const vaultToken = sessionStorage.getItem('komod-vault-token');
            record[key] = vaultToken && key !== 'public_stream_url' && !resolved.startsWith('blob:')
                ? `${resolved}${resolved.includes('?') ? '&' : '?'}vault_token=${encodeURIComponent(vaultToken)}`
                : resolved;
        }
        else if (key === 'cover_urls' && Array.isArray(item)) record[key] = item.map(url => typeof url === 'string' ? resolveServerUrl(url) : url);
        else resolveResponseMediaUrls(item);
    });
    return value;
};

// Add auth token to requests
api.interceptors.request.use((config) => {
    config.headers['X-Komod-Device-ID'] = getKomodDeviceId();
    const token = localStorage.getItem('access_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    const vaultToken = sessionStorage.getItem('komod-vault-token');
    if (vaultToken) config.headers['X-Komod-Vault-Token'] = vaultToken;
    const workspace = localStorage.getItem('komod-active-workspace');
    if (workspace && !String(config.url || '').startsWith('/auth') && !String(config.url || '').startsWith('/accounts') && !String(config.url || '').startsWith('/admin')) {
        config.headers['X-Workspace-User'] = workspace;
    }
    const method = String(config.method || 'get').toLowerCase();
    if (workspace && localStorage.getItem('komod-active-workspace-permission') === 'read' && !['get', 'head', 'options'].includes(method)) {
        return Promise.reject(new Error('این کمد با دسترسی فقط مشاهده باز شده و امکان تغییر ندارد.'));
    }
    return config;
});

// Queue for failed requests during token refresh
let isRefreshing = false;
let consecutiveNetworkFailures = 0;
let failedQueue: Array<{
    resolve: (token: string) => void;
    reject: (error: any) => void;
}> = [];

const processQueue = (error: any, token: string | null = null) => {
    failedQueue.forEach((prom) => {
        if (error) {
            prom.reject(error);
        } else {
            prom.resolve(token!);
        }
    });

    failedQueue = [];
};

// Handle 401 and 429 errors
api.interceptors.response.use(
    (response) => {
        consecutiveNetworkFailures = 0;
        window.dispatchEvent(new Event('komod-server-reachable'));
        resolveResponseMediaUrls(response.data);
        return response;
    },
    async (error) => {
        const originalRequest = error.config;

        if (!error.response && error.code !== 'ERR_CANCELED') {
            consecutiveNetworkFailures += 1;
            // A single slow request, especially a large media transfer, does
            // not mean that the whole device is offline.
            if (!navigator.onLine || consecutiveNetworkFailures >= 3) {
                window.dispatchEvent(new Event('komod-server-unreachable'));
            }
        }

        if (error.response?.status === 401 && !originalRequest._retry) {
            if (originalRequest.url.includes('/auth/refresh')) {
                // Refresh token itself failed/expired - clear everything
                localStorage.removeItem('access_token');
                localStorage.removeItem('refresh_token');
                localStorage.removeItem('user');
                if (!window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/auth')) {
                    window.location.href = '/login';
                }
                return Promise.reject(error);
            }

            if (isRefreshing) {
                return new Promise(function (resolve, reject) {
                    failedQueue.push({ resolve, reject });
                })
                    .then((token) => {
                        originalRequest.headers['Authorization'] = 'Bearer ' + token;
                        return api(originalRequest);
                    })
                    .catch((err) => {
                        return Promise.reject(err);
                    });
            }

            originalRequest._retry = true;
            isRefreshing = true;

            try {
                const refreshToken = localStorage.getItem('refresh_token');
                if (!refreshToken) {
                    throw new Error('No refresh token available');
                }

                const { data } = await axios.post(`${getServerOrigin()}/api/auth/refresh`, {
                    refresh_token: refreshToken,
                });

                const { access_token, refresh_token } = data;

                localStorage.setItem('access_token', access_token);
                localStorage.setItem('refresh_token', refresh_token);

                api.defaults.headers.common['Authorization'] = 'Bearer ' + access_token;
                originalRequest.headers['Authorization'] = 'Bearer ' + access_token;

                processQueue(null, access_token);
                return api(originalRequest);
            } catch (err) {
                processQueue(err, null);
                const responseStatus = (err as { response?: { status?: number } })?.response?.status;
                if (!responseStatus || ![400, 401, 403].includes(responseStatus)) {
                    // A timeout/offline response must never sign the user out. Keep
                    // both tokens so the app can recover as soon as the network does.
                    return Promise.reject(err);
                }
                localStorage.removeItem('access_token');
                localStorage.removeItem('refresh_token');
                localStorage.removeItem('user');
                
                // فقط اگر در صفحه لاگین یا کال‌بک نیستیم ریدایرکت کن
                if (!window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/auth')) {
                    window.location.href = '/login';
                }
                
                return Promise.reject(err);
            } finally {
                isRefreshing = false;
            }
        } else if (error.response?.status === 429) {
            console.log('[API] 429 Too Many Requests - rate limited');
            error.message = 'Too many requests. Please wait a moment and try again.';
        }
        
        return Promise.reject(error);
    }
);

// ============== Auth Hooks ==============

export const useCurrentUser = () => {
    const cachedUser = cachedCurrentUser();
    return useQuery({
        queryKey: ['currentUser'],
        queryFn: async () => {
            const { data } = await api.get<User>('/auth/me', { timeout: 5000 });
            return data;
        },
        enabled: !!localStorage.getItem('access_token'),
        initialData: cachedUser,
        initialDataUpdatedAt: cachedUser ? 0 : undefined,
        retry: false,
    });
};

export const useLoginWithCode = () => {
    return useMutation({
        mutationFn: async (code: string) => {
            const { data } = await api.post<AuthResponse>('/auth/code', { code });
            return data;
        },
    });
};

export const useLogoutAll = () => {
    return useMutation({
        mutationFn: async () => {
            await api.post('/auth/logout-all');
        },
    });
};

export const useBotInfo = () => {
    return useQuery({
        queryKey: ['botInfo'],
        queryFn: async () => {
            const { data } = await api.get<BotInfo>('/auth/bot/info');
            return data;
        },
        staleTime: Infinity,
    });
};

export const useGenerateLoginCode = () => {
    return useMutation({
        mutationFn: async () => {
            const { data } = await api.post<LoginCodeResponse>('/auth/generate-code');
            return data;
        },
    });
};

export const useVerifyLoginCode = () => {
    return useMutation({
        mutationFn: async (code: string) => {
            const { data } = await api.post<AuthResponse>('/auth/verify-code', { code });
            return data;
        },
    });
};

// ============== Files Hooks ==============

export const useFiles = (folderId?: number | null, fileType?: string, search?: string, page = 1, sort = '', favoriteOnly = false, includePlaylistCovers = false, includeHidden = false, hiddenOnly = false) => {
    return useQuery({
        queryKey: ['files', folderId, fileType, search, page, sort, favoriteOnly, includePlaylistCovers, includeHidden, hiddenOnly],
        queryFn: async () => {
            const params: Record<string, any> = {};
            if (folderId !== undefined) params.folder_id = folderId;
            if (fileType) params.file_type = fileType;
            if (search) params.search = search;
            params.page = page;
            params.per_page = 50;
            if (sort) params.sort = sort;
            if (favoriteOnly) params.favorite_only = true;
            if (includePlaylistCovers) params.include_playlist_covers = true;
            if (includeHidden) params.include_hidden = true;
            if (hiddenOnly) params.hidden_only = true;
            const { data } = await api.get<FileListResponse>('/files', { params });
            return data;
        },
        staleTime: 30000,
    });
};

export const useFile = (fileId: number) => {
    return useQuery({
        queryKey: ['file', fileId],
        queryFn: async () => {
            const { data } = await api.get<TelegramFile>(`/files/${fileId}`);
            return data;
        },
        enabled: !!fileId,
    });
};

export const useUpdateFile = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, ...data }: { id: number; file_name?: string; description?: string; folder_id?: number | null; is_favorite?: boolean; is_pinned?: boolean; is_hidden?: boolean; tags?: string[] }) => {
            const { data: result } = await api.patch<TelegramFile>(`/files/${id}`, data);
            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['files'] });
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            queryClient.invalidateQueries({ queryKey: ['folderTree'] });
            queryClient.invalidateQueries({ queryKey: ['activity'] });
        },
    });
};

export const useDeleteFile = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/files/${id}`);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['files'] });
        },
    });
};

export const useDeleteFiles = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (ids: number[]) => {
            await api.post('/files/batch-delete', ids as any);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['files'] });
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            queryClient.invalidateQueries({ queryKey: ['storage'] });
        },
    });
};

export const useMoveFiles = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ ids, folderId }: { ids: number[]; folderId: number | null }) => {
            await api.post('/files/batch-move', { ids, folder_id: folderId });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['files'] });
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            queryClient.invalidateQueries({ queryKey: ['folderTree'] });
        },
    });
};

export const useRecentFiles = (limit = 20, sort = '') => {
    return useQuery<FileListResponse>({
        queryKey: ['files', 'recent', limit, sort],
        queryFn: async () => {
             const { data } = await api.get<FileListResponse>('/files/recent', { params: { limit, sort: sort || undefined } });
             return data;
        },
    });
};

export const useContinueWatching = (limit = 20, sort = '') => {
    return useQuery<FileListResponse>({
        queryKey: ['files', 'continue-watching', limit, sort],
        queryFn: async () => {
             const { data } = await api.get<FileListResponse>('/files/continue-watching', { params: { limit, sort: sort || undefined } });
             return data;
        },
    });
};

export const useActivityFeed = (enabled = true, limit = 50) => {
    return useQuery<ActivityFeed>({
        queryKey: ['activity', limit],
        queryFn: async () => {
            try {
                const { data } = await api.get<ActivityFeed>('/files/activity', { params: { limit } });
                return data;
            } catch {
                const [recent, watching] = await Promise.all([
                    api.get<FileListResponse>('/files/recent', { params: { limit } }),
                    api.get<FileListResponse>('/files/continue-watching', { params: { limit } }),
                ]);
                return { recent: recent.data.files, continue_watching: watching.data.files, favorites: [] };
            }
        },
        enabled,
        staleTime: 15000,
    });
};

export const useStorageStats = () => {
    return useQuery<StorageStats>({
        queryKey: ['storage'],
        queryFn: async () => {
             const { data } = await api.get<StorageStats>('/files/storage');
             return data;
        },
        staleTime: 60000,
    });
};

export const useUpdateProgress = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ fileId, position, duration }: { fileId: number; position: number; duration?: number }) => {
            await api.post(`/files/${fileId}/progress`, { position, duration });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['activity'] });
        },
    });
};

// ============== Folders Hooks ==============

export const useMoveFolders = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ ids, folderId }: { ids: number[]; folderId: number | null }) => {
            await api.post('/folders/batch-move', { ids, folder_id: folderId });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            queryClient.invalidateQueries({ queryKey: ['folderTree'] });
        },
    });
};

export const useFolders = (parentId?: number | null, sort = '', favoriteOnly = false, includeHidden = false) => {
    return useQuery({
        queryKey: ['folders', parentId, sort, favoriteOnly, includeHidden],
        queryFn: async () => {
            const params: Record<string, any> = {};
            if (parentId !== undefined) params.parent_id = parentId;
            if (sort) params.sort = sort;
            if (favoriteOnly) params.favorite_only = true;
            if (includeHidden) params.include_hidden = true;
            const { data } = await api.get<Folder[]>('/folders', { params });
            return data;
        },
        staleTime: 60000,
    });
};

export const useFolderTree = (includeHidden = false) => {
    return useQuery({
        queryKey: ['folderTree', includeHidden],
        queryFn: async () => {
            const { data } = await api.get<Folder[]>('/folders/tree', { params: includeHidden ? { include_hidden: true } : undefined });
            return data;
        },
        staleTime: 60000,
    });
};

export const useCreateFolder = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (data: { name: string; description?: string; parent_id?: number | null }) => {
            const { data: result } = await api.post<Folder>('/folders', data);
            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            queryClient.invalidateQueries({ queryKey: ['folderTree'] });
        },
    });
};

export const useUpdateFolder = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, ...data }: { id: number; name?: string; description?: string; parent_id?: number | null; is_favorite?: boolean; is_pinned?: boolean; is_hidden?: boolean }) => {
            const { data: result } = await api.patch<Folder>(`/folders/${id}`, data);
            return result;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            queryClient.invalidateQueries({ queryKey: ['folderTree'] });
        },
    });
};

export const useDeleteFolder = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, deleteContents }: { id: number; deleteContents: boolean }) => {
            const params = { delete_contents: deleteContents };
            await api.delete(`/folders/${id}`, { params });
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            queryClient.invalidateQueries({ queryKey: ['folderTree'] });
            queryClient.invalidateQueries({ queryKey: ['files'] });
        },
    });
};

export const useDeleteFolders = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ ids, deleteContents }: { ids: number[]; deleteContents: boolean }) => {
            await api.post('/folders/batch-delete', ids, { params: { delete_contents: deleteContents } });
        },
        onSuccess: () => {
             queryClient.invalidateQueries({ queryKey: ['folders'] });
             queryClient.invalidateQueries({ queryKey: ['folderTree'] });
             queryClient.invalidateQueries({ queryKey: ['files'] });
             queryClient.invalidateQueries({ queryKey: ['storage'] });
        },
    });
};

// ============== Utilities ==============

export const formatFileSize = (bytes: number): string => {
    const units = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت', 'ترابایت'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    return `${size.toLocaleString('fa-IR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}\u00a0${units[unitIndex]}`;
};

export const formatDuration = (seconds: number | null): string => {
    if (!seconds) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`.replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`.replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]);
};

export const useUploadFile = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ file, folderId, onProgress, signal }: { file: globalThis.File; folderId: number | null; onProgress?: (percent: number) => void; signal?: AbortSignal }) => {
            const form = new FormData();
            form.append('upload', file, file.name);
            if (folderId !== null) form.append('folder_id', String(folderId));
            const { data } = await api.post<TelegramFile>('/files/upload', form, {
                signal,
                onUploadProgress: event => onProgress?.(Math.min(100, Math.round((event.loaded / Math.max(1, event.total || file.size)) * 100))),
            });
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['files'] });
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            queryClient.invalidateQueries({ queryKey: ['storage'] });
            queryClient.invalidateQueries({ queryKey: ['activity'] });
        },
    });
};

// ============== Playlist Hooks ==============

export const usePlaylists = () => useQuery<PlaylistSummary[]>({
    queryKey: ['playlists'],
    queryFn: async () => (await api.get<PlaylistSummary[]>('/playlists')).data,
});

export const useReorderPlaylistCatalog = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (playlistIds: number[]) => (await api.put<PlaylistSummary[]>('/playlists/reorder/catalog', { playlist_ids: playlistIds })).data,
        onMutate: async (playlistIds) => {
            await queryClient.cancelQueries({ queryKey: ['playlists'] });
            const previous = queryClient.getQueryData<PlaylistSummary[]>(['playlists']);
            if (previous) {
                const byId = new Map(previous.map(item => [item.id, item]));
                const ordered = playlistIds.map((id, index) => ({ ...byId.get(id)!, position: index })).filter(Boolean);
                const missing = previous.filter(item => !playlistIds.includes(item.id));
                queryClient.setQueryData(['playlists'], [...ordered, ...missing]);
            }
            return { previous };
        },
        onError: (_error, _ids, context) => {
            if (context?.previous) queryClient.setQueryData(['playlists'], context.previous);
        },
        onSuccess: data => queryClient.setQueryData(['playlists'], data),
    });
};

export const useLogoutOthers = () => {
    const queryClient = useQueryClient();
    return useMutation({ mutationFn: async () => (await api.post<{revoked:number}>('/auth/logout-others')).data, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }) });
};

export const usePasswordLogin = () => useMutation({
    mutationFn: async (payload: { username: string; password: string }) => (await api.post<AuthResponse>('/auth/password/login', payload)).data,
});

export const useCredentials = () => useQuery({
    queryKey: ['credentials'],
    queryFn: async () => (await api.get<CredentialsStatus>('/auth/credentials')).data,
});

export const useUpdateCredentials = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (payload: { username: string; current_password?: string; new_password?: string }) => (await api.put<AuthResponse>('/auth/credentials', payload)).data,
        onSuccess: data => {
            localStorage.setItem('access_token', data.access_token);
            localStorage.setItem('refresh_token', data.refresh_token);
            localStorage.setItem('user', JSON.stringify(data.user));
            queryClient.setQueryData(['currentUser'], data.user);
            queryClient.invalidateQueries({ queryKey: ['credentials'] });
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
        },
    });
};

export const useImportLink = () => useMutation({
    mutationFn: async (payload: { url: string; folder_id?: number | null; new_folder_name?: string; quality?: 'auto' | 'audio' | '480' | '720' | '1080' }) =>
        (await api.post<{ message: string; queue_position: number; job_id: string }>('/files/import-link', payload)).data,
});

export const usePlaylist = (id: number | null) => useQuery<Playlist>({
    queryKey: ['playlists', id],
    queryFn: async () => (await api.get<Playlist>(`/playlists/${id}`)).data,
    enabled: id !== null,
});

const usePlaylistMutation = <TVariables>(request: (variables: TVariables) => Promise<Playlist>) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: request,
        onSuccess: (playlist: Playlist) => {
            queryClient.setQueryData(['playlists', playlist.id], playlist);
            queryClient.invalidateQueries({ queryKey: ['playlists'] });
            queryClient.invalidateQueries({ queryKey: ['files'] });
            queryClient.invalidateQueries({ queryKey: ['activity'] });
        },
    });
};

export const useCreatePlaylist = () => usePlaylistMutation(async (payload: { name: string; description?: string }) =>
    (await api.post<Playlist>('/playlists', payload)).data
);

export const useUpdatePlaylist = () => usePlaylistMutation(async ({ id, ...payload }: { id: number; name?: string; description?: string; cover_file_id?: number | null }) =>
    (await api.patch<Playlist>(`/playlists/${id}`, payload)).data
);

export const useAddPlaylistItems = () => usePlaylistMutation(async ({ id, fileIds, allowDuplicates = false }: { id: number; fileIds: number[]; allowDuplicates?: boolean }) =>
    (await api.post<Playlist>(`/playlists/${id}/items`, { file_ids: fileIds, allow_duplicates: allowDuplicates })).data
);

export const useRemovePlaylistItem = () => usePlaylistMutation(async ({ id, itemId }: { id: number; itemId: number }) =>
    (await api.delete<Playlist>(`/playlists/${id}/items/item/${itemId}`)).data
);

export const useReorderPlaylist = () => usePlaylistMutation(async ({ id, itemIds }: { id: number; itemIds: number[] }) =>
    (await api.put<Playlist>(`/playlists/${id}/reorder`, { item_ids: itemIds })).data
);

export const useShufflePlaylist = () => usePlaylistMutation(async (id: number) =>
    (await api.post<Playlist>(`/playlists/${id}/shuffle`)).data
);

export const useDeletePlaylist = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => { await api.delete(`/playlists/${id}`); return id; },
        onSuccess: (id) => {
            queryClient.removeQueries({ queryKey: ['playlists', id] });
            queryClient.invalidateQueries({ queryKey: ['playlists'] });
        },
    });
};

export interface BatchFileEdit {
    ids: number[];
    description_mode?: 'set' | 'append' | 'clear';
    description?: string;
    rename_mode?: 'prefix' | 'suffix' | 'replace';
    rename_value?: string;
    rename_search?: string;
    tags_add?: string[];
    tags_remove?: string[];
    tags_replace?: string[];
    is_hidden?: boolean;
}

export const useBatchUpdateFiles = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (payload: BatchFileEdit) => {
            const { data } = await api.post<{ message: string; updated: number }>('/files/batch-update', payload);
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['files'] });
            queryClient.invalidateQueries({ queryKey: ['folders'] });
        },
    });
};

export const formatPersianDate = (value: string): string => {
    const normalized = /Z$|[+-]\d{2}:\d{2}$/.test(value) ? value : `${value}Z`;
    return new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
        timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(normalized));
};

export const getFileIcon = (fileType: string): string => {
    switch (fileType) {
        case 'video': return '🎬';
        case 'audio': return '🎵';
        case 'image': return '🖼️';
        case 'document': return '📄';
        default: return '📎';
    }
};

const cacheTagSettings = (settings: TagSettings) => {
    localStorage.setItem('komod-tag-settings', JSON.stringify(settings));
    window.dispatchEvent(new Event('komod-tag-settings-changed'));
    return settings;
};

export const useTagSettings = () => useQuery<TagSettings>({
    queryKey: ['tag-settings'],
    queryFn: async () => cacheTagSettings((await api.get<TagSettings>('/accounts/tags')).data),
});

export const useUpdateTagSettings = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (payload: Omit<TagSettings, 'tags'> & { tags: Array<{name:string;color:string}> }) =>
            cacheTagSettings((await api.put<TagSettings>('/accounts/tags', payload)).data),
        onSuccess: data => queryClient.setQueryData(['tag-settings'], data),
    });
};

export const useSessions = () => useQuery({ queryKey: ['sessions'], queryFn: async () => (await api.get<AuthSession[]>('/auth/sessions')).data });
export const useRevokeSession = () => {
    const queryClient = useQueryClient();
    return useMutation({ mutationFn: async (id: string) => api.delete(`/auth/sessions/${id}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }) });
};
export const useWorkspaces = () => useQuery({ queryKey: ['workspaces'], queryFn: async () => {
    const spaces = (await api.get<Workspace[]>('/accounts/workspaces')).data;
    const active = Number(localStorage.getItem('komod-active-workspace') || 0);
    const selected = spaces.find(space => space.user_id === active);
    if (selected) localStorage.setItem('komod-active-workspace-permission', selected.permission);
    else localStorage.removeItem('komod-active-workspace-permission');
    return spaces;
} });
export const useWorkspaceGrants = () => useQuery({ queryKey: ['workspaceGrants'], queryFn: async () => (await api.get<Workspace[]>('/accounts/grants')).data });
export const useGrantWorkspace = () => {
    const queryClient = useQueryClient();
    return useMutation({ mutationFn: async (payload: { telegram_id?: number; identifier?: string; permission: 'read' | 'write'; folder_ids?: number[]; file_ids?: number[] }) => (await api.post<Workspace>('/accounts/grants', payload)).data, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspaceGrants'] }) });
};
export const useRevokeWorkspace = () => {
    const queryClient = useQueryClient();
    return useMutation({ mutationFn: async (id: number) => api.delete(`/accounts/grants/${id}`), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspaceGrants'] }) });
};
export const useAdminUsers = (enabled: boolean) => useQuery({ queryKey: ['adminUsers'], queryFn: async () => (await api.get<AdminUser[]>('/admin/users')).data, enabled, retry: 2, staleTime: 30_000 });
export const useAdminStats = (enabled: boolean) => useQuery({ queryKey: ['adminStats'], queryFn: async () => (await api.get<AdminStats>('/admin/stats')).data, enabled, retry: 2, staleTime: 30_000 });
export const useAccountPreferences = () => useQuery({ queryKey: ['accountPreferences'], queryFn: async () => (await api.get<AccountPreferences>('/accounts/preferences')).data });
export const useVaultStatus = () => useQuery({ queryKey: ['vaultStatus'], queryFn: async () => (await api.get<VaultStatus>('/accounts/vault')).data });
export const useSetVaultPassword = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (password: string) => (await api.put<{token:string}>('/accounts/vault', { password })).data,
        onSuccess: data => { sessionStorage.setItem('komod-vault-token', data.token); queryClient.invalidateQueries({queryKey:['vaultStatus']}); },
    });
};
export const useUnlockVault = () => useMutation({
    mutationFn: async (password: string) => (await api.post<{token:string}>('/accounts/vault/unlock', { password })).data,
    onSuccess: data => sessionStorage.setItem('komod-vault-token', data.token),
});
export const useUpdateAccountPreferences = () => {
    const queryClient = useQueryClient();
    return useMutation({ mutationFn: async (payload: AccountPreferences) => (await api.put<AccountPreferences>('/accounts/preferences', payload)).data, onSuccess: data => queryClient.setQueryData(['accountPreferences'], data) });
};
export const useStorageChannel = () => useQuery({ queryKey: ['storageChannel'], queryFn: async () => (await api.get<StorageChannel>('/accounts/storage-channel')).data });
export const useSetStorageChannel = () => { const queryClient=useQueryClient(); return useMutation({ mutationFn: async (channel_id:number)=>(await api.put<StorageChannel>('/accounts/storage-channel',{channel_id})).data, onSuccess:()=>queryClient.invalidateQueries({queryKey:['storageChannel']}) }); };
export const useResetStorageChannel = () => { const queryClient=useQueryClient(); return useMutation({ mutationFn: async()=>api.delete('/accounts/storage-channel'), onSuccess:()=>queryClient.invalidateQueries({queryKey:['storageChannel']}) }); };
export const useUpdateAdminUser = () => {
    const queryClient = useQueryClient();
    return useMutation({ mutationFn: async ({ id, ...payload }: { id: number; display_name?: string; is_active?: boolean }) => (await api.patch<AdminUser>(`/admin/users/${id}`, payload)).data, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['adminUsers'] }) });
};
export const useAddAdminUser = () => {
    const queryClient = useQueryClient();
    return useMutation({ mutationFn: async (payload: { telegram_id:number; display_name?:string }) => (await api.post<AdminUser>('/admin/users', payload)).data, onSuccess: () => { queryClient.invalidateQueries({queryKey:['adminUsers']}); queryClient.invalidateQueries({queryKey:['adminStats']}); } });
};
export const useRemoveAdminUser = () => {
    const queryClient = useQueryClient();
    return useMutation({ mutationFn: async (id:number) => api.delete(`/admin/users/${id}`), onSuccess: () => { queryClient.invalidateQueries({queryKey:['adminUsers']}); queryClient.invalidateQueries({queryKey:['adminStats']}); } });
};
