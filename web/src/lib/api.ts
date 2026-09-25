/**
 * API client and hooks for the Komod backend.
 */
import axios from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

// Types
export interface User {
    id: number;
    telegram_id: number;
    username: string | null;
    first_name: string | null;
    last_name: string | null;
    created_at: string;
    last_active: string;
}

export interface Folder {
    id: number;
    name: string;
    description: string | null;
    parent_id: number | null;
    user_id: number;
    created_at: string;
    updated_at: string;
    file_count: number;
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

export interface StorageStats {
    total_size: number;
    limit: number;
}

export interface StorageStats {
    total_size: number;
    limit: number;
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

// API client
export const api = axios.create({
    baseURL: '/api',
});

// Add auth token to requests
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('access_token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
});

// Queue for failed requests during token refresh
let isRefreshing = false;
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
    (response) => response,
    async (error) => {
        const originalRequest = error.config;

        if (error.response?.status === 401 && !originalRequest._retry) {
            if (originalRequest.url.includes('/auth/refresh')) {
                // Refresh token itself failed/expired - clear everything
                localStorage.removeItem('access_token');
                localStorage.removeItem('refresh_token');
                localStorage.removeItem('user');
                window.location.href = '/login';
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

                const { data } = await axios.post('/api/auth/refresh', {
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
                localStorage.removeItem('access_token');
                localStorage.removeItem('refresh_token');
                localStorage.removeItem('user');
                window.location.href = '/login';
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
    return useQuery({
        queryKey: ['currentUser'],
        queryFn: async () => {
            const { data } = await api.get<User>('/auth/me');
            return data;
        },
        retry: false,
    });
};

export const useLoginWithCode = () => {
    return useMutation({
        mutationFn: async (code: string) => {
            const { data } = await api.post<{ access_token: string; refresh_token: string }>('/auth/code', { code });
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
        staleTime: Infinity, // Bot info doesn't change during session
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

export const useFiles = (folderId?: number | null, fileType?: string, search?: string, page = 1, sort = '') => {
    return useQuery({
        queryKey: ['files', folderId, fileType, search, page, sort],
        queryFn: async () => {
            const params: Record<string, any> = {};
            if (folderId !== undefined) params.folder_id = folderId;
            if (fileType) params.file_type = fileType;
            if (search) params.search = search;
            params.page = page;
            params.per_page = 50; // Load 50 files per page
            if (sort) params.sort = sort;
            const { data } = await api.get<FileListResponse>('/files', { params });
            return data;
        },
        staleTime: 30000, // Keep data fresh for 30s to avoid over-fetching
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
        mutationFn: async ({ id, ...data }: { id: number; file_name?: string; description?: string; folder_id?: number | null; is_favorite?: boolean }) => {
            const { data: result } = await api.patch<TelegramFile>(`/files/${id}`, data);
            return result;
        },
        onSuccess: () => {
            // Invalidate both files and folders to ensure UI updates for moves
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
            await api.post('/files/batch-delete', ids as any); // Axios automatically handles array as JSON body
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['files'] });
             queryClient.invalidateQueries({ queryKey: ['folders'] }); // Files might be inside folders affecting counts
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

export const useFolders = (parentId?: number | null, sort = '') => {
    return useQuery({
        queryKey: ['folders', parentId, sort],
        queryFn: async () => {
            const params: Record<string, any> = {};
            if (parentId !== undefined) params.parent_id = parentId;
            if (sort) params.sort = sort;
            const { data } = await api.get<Folder[]>('/folders', { params });
            return data;
        },
        staleTime: 60000, // Folders change less often
    });
};

export const useFolderTree = () => {
    return useQuery({
        queryKey: ['folderTree'],
        queryFn: async () => {
            const { data } = await api.get<Folder[]>('/folders/tree');
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
        mutationFn: async ({ id, ...data }: { id: number; name?: string; description?: string; parent_id?: number | null }) => {
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
    return `${size.toLocaleString('fa-IR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} ${units[unitIndex]}`;
};

export const formatDuration = (seconds: number | null): string => {
    if (!seconds) return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
};

export const useUploadFile = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ file, folderId }: { file: globalThis.File; folderId: number | null }) => {
            const form = new FormData();
            form.append('upload', file, file.name);
            if (folderId !== null) form.append('folder_id', String(folderId));
            const { data } = await api.post<TelegramFile>('/files/upload', form);
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
