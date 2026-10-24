/**
 * API client and hooks for the Komod backend.
 */
import axios from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cachedCurrentUser, clearCurrentAccountSession, updateCurrentAccountTokens } from './accounts';
import { queueOfflineMutation, shouldQueueOffline } from './offlineMutations';
import { isEffectivelyOnline, markServerReachable, markServerUnreachable } from './connectivity';

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

// A saved reverse-proxy address belongs to the production app. Never let it
// hijack requests while developing on localhost: Vite must proxy those calls
// to the local API instance.
const runningLocally = () => ['localhost', '127.0.0.1'].includes(window.location.hostname);
export const getServerOrigin = () => runningLocally()
    ? window.location.origin
    : normalizeServerOrigin(localStorage.getItem('komod-server-origin'));
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
export interface AdminUser extends User { total_size: number; file_count: number; session_count: number; tts_daily_limit:number; tts_max_chars:number; tts_used_today:number; tts_total_jobs:number; tts_total_chars:number; stt_daily_limit:number; stt_max_seconds:number; stt_used_today:number; stt_total_jobs:number; stt_total_seconds:number; }
export interface AdminStats { active_users: number; total_users: number; total_files: number; total_size: number; tts_jobs_today:number; tts_total_jobs:number; tts_total_chars:number; stt_jobs_today:number; stt_total_jobs:number; stt_total_seconds:number; }
export interface ServiceHealthItem { key:string; label:string; status:'healthy'|'warning'|'error'|'disabled'; message:string; queued:number; active:number; latency_ms?:number|null; }
export interface StuckJob { id:string; kind:string; title:string; state:string; progress:number; updated_at:string; }
export interface AdminHealth { checked_at:string; overall:'healthy'|'warning'|'error'; services:ServiceHealthItem[]; stuck_jobs:StuckJob[]; }
export interface AdminErrorLog { id:number; error_id:string; method:string; path:string; message:string; resolved:boolean; created_at:string; }
export interface AccountPreferences { delete_storage_files: boolean; youtube_caption_template: string; instagram_caption_template: string; }
export interface TagDefinition { name: string; color: string; category?: string; file_count?: number; }
export interface TagSettings { tags: TagDefinition[]; excluded_tags: string[]; show_file_tags: boolean; display_limit: number; }
export interface SavedFilter {
    id: string;
    name: string;
    query: string;
    file_types: Array<'video'|'audio'|'image'|'document'|'text'>;
    favorite_only: boolean;
    sort: string;
}
export interface VaultStatus { configured: boolean; }
export interface StorageChannelItem { channel_id:number; title?:string|null; active:boolean; }
export interface StorageChannel { configured: boolean; channel_id?: number | null; title?: string | null; channels:StorageChannelItem[]; }
export interface TTSVoice { value: string; label: string; description: string; gender: 'female'|'male'; pitch: 'low'|'medium'|'high'; }
export interface TTSModelOption { value:string; label:string; description:string; profile:'quality'|'economy'; }
export interface AIModelOption { value:string; label:string; description:string; }
export interface TTSSettings { voice: string; style: string; speed: number; model: string; stt_model:string; stt_mode:'verbatim'|'smart'; text_model:string; auto_expression: boolean; gender: 'all'|'female'|'male'; pitch: 'all'|'medium'|'low'|'high'; use_case: 'general'|'audiobook'|'podcast'|'story'|'education'|'news'|'advertising'|'accessibility'; folder_id: number|null; available: boolean; personal_key_count?: number; voices: TTSVoice[]; models:TTSModelOption[]; stt_models:AIModelOption[]; text_models:AIModelOption[]; }
export interface GeminiKeySummary { count:number; masked:string[]; }
export interface GeminiKeyHealth { masked:string; status:'healthy'|'limited'|'denied'|'unreachable'|'error'; message:string; }
export interface FileMetadataSuggestion { title:string; description:string; tags:string[]; }
export interface SmartSearchExpansion { query:string; terms:string[]; }
export interface RelatedFilesResult { files:TelegramFile[]; terms:string[]; }
export interface FileInsights { summary:string; key_points:string[]; topics:string[]; }
export interface FolderSuggestion { folder_id:number; name:string; path:string; reason:string; confidence:number; }
export interface FileQuestionTurn { role:'user'|'assistant'; content:string; }
export interface TTSJobStatus { id: string; state: 'queued'|'paused'|'synthesizing'|'merging'|'uploading'|'done'|'error'|'cancelled'; message: string; progress: number; chunks_total: number; chunks_done: number; title: string; model?:string; file_id?: number; stream_url?: string; created_at: string; finished_at?: string; }
export interface STTJobStatus { id:string; source_file_id:number; title:string; output_mode?:'temporary'|'save'; model?:string; state:'queued'|'downloading'|'transcribing'|'saving'|'done'|'error'|'cancelled'; message:string; progress:number; content?:string; file_id?:number; created_at:string; finished_at?:string; }

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
    color?: string | null;
    icon?: string | null;
    cover_file_id?: number | null;
    cover_url?: string | null;
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
    public_expires_at?: string | null;
    public_allow_download?: boolean;
    public_view_limit?: number | null;
    public_view_count?: number;
    public_password_protected?: boolean;
    _queueEntryId?: string;
    is_favorite?: boolean;
    is_pinned?: boolean;
    is_hidden?: boolean;
    is_shortcut?: boolean;
    audio_stream_url?: string | null;
    audio_variant_size?: number | null;
    compatible_video_stream_url?: string | null;
    compatible_video_size?: number | null;
    tags?: string[];
}

export interface FileListResponse {
    files: TelegramFile[];
    total: number;
    page: number;
    per_page: number;
    search_mode?: 'exact' | 'fuzzy';
    suggestions?: string[];
}
export interface PlayerState { files: TelegramFile[]; current_index: number; repeat_mode: 'off'|'all'|'one'; position: number; updated_at?: string|null; }

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

export interface PackItem {
    id: number;
    position: number;
    caption: string | null;
    added_at: string;
    file: TelegramFile;
}

export interface PackSummary {
    id: number;
    name: string;
    description: string | null;
    parent_folder_id: number | null;
    item_count: number;
    cover_file_id: number | null;
    cover_position_x: number;
    cover_position_y: number;
    hide_member_files: boolean;
    cover_url: string | null;
    cover_urls: string[];
    preview_names: string[];
    type_counts: Record<string, number>;
    position: number;
    created_at: string;
    updated_at: string;
}

export interface Pack extends PackSummary { items: PackItem[]; }

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
    total_files: number;
    by_type: Array<{ type: TelegramFile['file_type']; count: number; size: number }>;
    limit: number;
}

export interface AuthResponse {
    access_token: string;
    refresh_token: string;
    user: User;
}
export interface CredentialsStatus { enabled: boolean; username?: string | null; two_factor_enabled: boolean; recovery_available: boolean; }
export interface TwoFactorSetup { secret:string; provisioning_uri:string; setup_token:string; }

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
    if (workspace && !String(config.url || '').startsWith('/auth') && !String(config.url || '').startsWith('/accounts') && !String(config.url || '').startsWith('/admin') && !String(config.url || '').startsWith('/files/public-shares')) {
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
        markServerReachable();
        window.dispatchEvent(new Event('komod-server-reachable'));
        resolveResponseMediaUrls(response.data);
        return response;
    },
    async (error) => {
        const originalRequest = error.config;

        const errorId = String(error.response?.data?.error_id || '').trim();
        if (errorId && error.response?.status >= 500) {
            const detail = String(error.response.data.detail || 'یک خطای پیش‌بینی‌نشده رخ داد.');
            if (!detail.includes(errorId)) error.response.data.detail = `${detail} کد پیگیری: ${errorId}`;
        }

        if (!error.response && error.code !== 'ERR_CANCELED') {
            consecutiveNetworkFailures += 1;
            // A single slow request, especially a large media transfer, does
            // not mean that the whole device is offline.
            if (!navigator.onLine || consecutiveNetworkFailures >= 3) {
                markServerUnreachable();
                window.dispatchEvent(new Event('komod-server-unreachable'));
            }
        }

        if (error.response?.status === 401 && !originalRequest._retry) {
            if (originalRequest.url.includes('/auth/refresh')) {
                // Refresh token itself failed/expired - clear everything
                clearCurrentAccountSession();
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
                updateCurrentAccountTokens(access_token, refresh_token);

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
                clearCurrentAccountSession();
                
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

async function runOrQueueMetadataMutation<T>(
    request:()=>Promise<T>,
    queued:Parameters<typeof queueOfflineMutation>[0],
    fallback:()=>T,
):Promise<T>{
    if(localStorage.getItem('komod-active-workspace-permission')==='read')throw new Error('این کمد فقط قابل مشاهده است.');
    if(!isEffectivelyOnline()){
        queueOfflineMutation(queued);return fallback();
    }
    try{return await request()}catch(error){if(!shouldQueueOffline(error))throw error;queueOfflineMutation(queued);return fallback()}
}
const offlineTempIds=new WeakMap<object,number>();
const offlineTempId=(value:object)=>{let id=offlineTempIds.get(value);if(!id){id=-Date.now();offlineTempIds.set(value,id)}return id};

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
        retry: (failureCount, error: any) => {
            const status = error?.response?.status;
            return failureCount < 2 && (!status || status === 429 || status >= 500);
        },
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
    const cacheKey = libraryFileCacheKey(folderId,fileType,search,page,sort,favoriteOnly,includePlaylistCovers,includeHidden,hiddenOnly);
    const cacheable = page === 1 && !search;
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
            if(offlineRequested()) return (cacheable?readJsonCache<FileListResponse>(cacheKey):undefined) || {files:[],total:0,page,per_page:50,pages:0};
            const { data } = await api.get<FileListResponse>('/files', { params });
            if(cacheable)writeJsonCache(cacheKey,data);
            return data;
        },
        initialData: () => cacheable?readJsonCache<FileListResponse>(cacheKey):undefined,
        initialDataUpdatedAt: 0,
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
            const cached=queryClient.getQueryData<TelegramFile>(['file',id]);
            return runOrQueueMetadataMutation(
                async()=>(await api.patch<TelegramFile>(`/files/${id}`,data)).data,
                {entity:data.tags!==undefined?'tag':'folder',method:'patch',url:`/files/${id}`,payload:data,baseUpdatedAt:cached?.updated_at},
                ()=>({...cached,id,...data,updated_at:new Date().toISOString()} as TelegramFile),
            );
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['files'] });
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            queryClient.invalidateQueries({ queryKey: ['folderTree'] });
            queryClient.invalidateQueries({ queryKey: ['activity'] });
            queryClient.invalidateQueries({ queryKey: ['tag-settings'] });
        },
    });
};

const removeFilesFromCachedPack = (pack: Pack | undefined, ids: Set<number>) => {
    if (!pack) return pack;
    const items = pack.items.filter(item => !ids.has(item.file.id));
    const typeCounts = items.reduce<Record<string, number>>((counts, item) => {
        counts[item.file.file_type] = (counts[item.file.file_type] || 0) + 1;
        return counts;
    }, {});
    return {
        ...pack,
        items,
        item_count: items.length,
        preview_names: items.slice(0, 2).map(item => item.file.file_name),
        type_counts: typeCounts,
        cover_file_id: pack.cover_file_id && ids.has(pack.cover_file_id) ? null : pack.cover_file_id,
    };
};

export const useSuggestFileMetadata = () => useMutation({
    mutationFn: async (id:number) => (await api.post<FileMetadataSuggestion>(`/files/${id}/ai-metadata`)).data,
});

export const useExpandSmartSearch = () => useMutation({
    mutationFn: async (query:string) => (await api.post<SmartSearchExpansion>('/files/search/expand',{query})).data,
});

export const useRelatedFiles = () => useMutation({
    mutationFn: async (id:number) => (await api.post<RelatedFilesResult>(`/files/${id}/related`)).data,
});

export const useFileInsights = () => useMutation({
    mutationFn: async (id:number) => (await api.post<FileInsights>(`/files/${id}/ai-insights`)).data,
});

export const useSuggestFileFolders = () => useMutation({
    mutationFn: async (id:number) => (await api.post<{suggestions:FolderSuggestion[]}>(`/files/${id}/ai-folder-suggestions`)).data,
});

export const useAskFileQuestion = () => useMutation({
    mutationFn: async ({id,question,history}:{id:number;question:string;history:FileQuestionTurn[]}) => (await api.post<{answer:string}>(`/files/${id}/ask`,{question,history})).data,
});

export const useDeleteFile = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => {
            await api.delete(`/files/${id}`);
            return id;
        },
        onSuccess: id => {
            queryClient.setQueriesData<Pack>({ queryKey: ['packs', 'detail'] }, pack => removeFilesFromCachedPack(pack, new Set([id])));
            queryClient.invalidateQueries({ queryKey: ['files'] });
            queryClient.invalidateQueries({ queryKey: ['packs'] });
        },
    });
};

export const useDeleteFiles = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (ids: number[]) => {
            await api.post('/files/batch-delete', ids as any);
            return ids;
        },
        onSuccess: ids => {
            queryClient.setQueriesData<Pack>({ queryKey: ['packs', 'detail'] }, pack => removeFilesFromCachedPack(pack, new Set(ids)));
            queryClient.invalidateQueries({ queryKey: ['files'] });
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            queryClient.invalidateQueries({ queryKey: ['storage'] });
            queryClient.invalidateQueries({ queryKey: ['packs'] });
        },
    });
};

export const useMoveFiles = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ ids, folderId }: { ids: number[]; folderId: number | null }) => {
            await runOrQueueMetadataMutation(async()=>{await api.post('/files/batch-move',{ids,folder_id:folderId})},{entity:'folder',method:'post',url:'/files/batch-move',payload:{ids,folder_id:folderId}},()=>undefined);
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
            await runOrQueueMetadataMutation(async()=>{await api.post('/folders/batch-move',{ids,folder_id:folderId})},{entity:'folder',method:'post',url:'/folders/batch-move',payload:{ids,folder_id:folderId}},()=>undefined);
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            queryClient.invalidateQueries({ queryKey: ['folderTree'] });
        },
    });
};

export const useFolders = (parentId?: number | null, sort = '', favoriteOnly = false, includeHidden = false) => {
    const cacheKey=libraryFolderCacheKey(parentId,sort,favoriteOnly,includeHidden);
    return useQuery({
        queryKey: ['folders', parentId, sort, favoriteOnly, includeHidden],
        queryFn: async () => {
            const params: Record<string, any> = {};
            if (parentId !== undefined) params.parent_id = parentId;
            if (sort) params.sort = sort;
            if (favoriteOnly) params.favorite_only = true;
            if (includeHidden) params.include_hidden = true;
            if(offlineRequested()) return readJsonCache<Folder[]>(cacheKey)||[];
            const { data } = await api.get<Folder[]>('/folders', { params });
            writeJsonCache(cacheKey,data);
            return data;
        },
        initialData:()=>readJsonCache<Folder[]>(cacheKey),
        initialDataUpdatedAt:0,
        staleTime: 60000,
    });
};

export const useFolderTree = (includeHidden = false) => {
    const cacheKey=libraryFolderTreeCacheKey(includeHidden);
    return useQuery({
        queryKey: ['folderTree', includeHidden],
        queryFn: async () => {
            if(offlineRequested()) return readJsonCache<Folder[]>(cacheKey)||[];
            const { data } = await api.get<Folder[]>('/folders/tree', { params: includeHidden ? { include_hidden: true } : undefined });
            writeJsonCache(cacheKey,data);
            return data;
        },
        initialData:()=>readJsonCache<Folder[]>(cacheKey),
        initialDataUpdatedAt:0,
        staleTime: 60000,
    });
};

export const useCreateFolder = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (data: { name: string; description?: string; parent_id?: number | null }) => {
            const tempId=-Date.now();const now=new Date().toISOString();
            return runOrQueueMetadataMutation(async()=>(await api.post<Folder>('/folders',data)).data,{entity:'folder',method:'post',url:'/folders',payload:data,tempId},()=>({id:tempId,name:data.name,description:data.description||null,parent_id:data.parent_id??null,user_id:cachedCurrentUser()?.id||0,created_at:now,updated_at:now,file_count:0,children:[]}));
        },
        onSuccess: (folder) => {
            queryClient.setQueriesData<Folder[]>({predicate:query=>query.queryKey[0]==='folders'&&query.queryKey[1]===folder.parent_id},current=>current&&!current.some(item=>item.id===folder.id)?[folder,...current]:current);
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            queryClient.invalidateQueries({ queryKey: ['folderTree'] });
        },
    });
};

export const useUpdateFolder = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({ id, ...data }: { id: number; name?: string; description?: string; parent_id?: number | null; is_favorite?: boolean; is_pinned?: boolean; is_hidden?: boolean; color?: string | null; icon?: string | null; cover_file_id?: number | null }) => {
            const cached=queryClient.getQueriesData<Folder[]>({queryKey:['folders']}).flatMap(([,items])=>items||[]).find(item=>item.id===id);
            return runOrQueueMetadataMutation(async()=>(await api.patch<Folder>(`/folders/${id}`,data)).data,{entity:'folder',method:'patch',url:`/folders/${id}`,payload:data,baseUpdatedAt:cached?.updated_at},()=>({...cached,id,...data,updated_at:new Date().toISOString()} as Folder));
        },
        onSuccess: (folder) => {
            queryClient.setQueriesData<Folder[]>({queryKey:['folders']},current=>current?.map(item=>item.id===folder.id?folder:item));
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
            const cached=queryClient.getQueriesData<Folder[]>({queryKey:['folders']}).flatMap(([,items])=>items||[]).find(item=>item.id===id);
            await runOrQueueMetadataMutation(async()=>{await api.delete(`/folders/${id}`,{params});return id},{entity:'folder',method:'delete',url:`/folders/${id}?delete_contents=${deleteContents}`,baseUpdatedAt:cached?.updated_at},()=>id);
            return id;
        },
        onSuccess: (id) => {
            queryClient.setQueriesData<Folder[]>({queryKey:['folders']},current=>current?.filter(item=>item.id!==id));
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
            await runOrQueueMetadataMutation(async()=>{await api.post('/folders/batch-delete',ids,{params:{delete_contents:deleteContents}})},{entity:'folder',method:'post',url:`/folders/batch-delete?delete_contents=${deleteContents}`,payload:ids},()=>undefined);
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

// ============== Mixed-media Pack Hooks ==============

const packCacheScope = () => localStorage.getItem('komod-active-workspace') || cachedCurrentUser()?.id || 'guest';
const packCacheKey = (parentFolderId:number|null,allFolders:boolean) => `komod-packs:${packCacheScope()}:${allFolders?'all':parentFolderId??'root'}`;
const readPackCache = (key:string):PackSummary[]|undefined => { try { const raw=localStorage.getItem(key); return raw?JSON.parse(raw) as PackSummary[]:undefined } catch { return undefined } };
export const usePacks = (parentFolderId: number | null, allFolders = false) => {
    const cacheKey=packCacheKey(parentFolderId,allFolders);
    return useQuery<PackSummary[]>({
        queryKey: ['packs', allFolders ? 'all' : parentFolderId],
        initialData:()=>readPackCache(cacheKey),
        staleTime:30_000,
        queryFn: async () => {
            const cached=readPackCache(cacheKey);
            if(!isEffectivelyOnline())return cached||[];
            try { const data=(await api.get<PackSummary[]>('/packs',{params:{parent_folder_id:parentFolderId??undefined,all_folders:allFolders||undefined}})).data;try{localStorage.setItem(cacheKey,JSON.stringify(data))}catch{/* storage unavailable */}return data }
            catch(error){if(cached)return cached;throw error}
        },
    });
};

export const usePack = (id: number | null) => useQuery<Pack>({
    queryKey: ['packs', 'detail', id],
    queryFn: async () => (await api.get<Pack>(`/packs/${id}`)).data,
    enabled: id !== null,
});

const usePackMutation = <TVariables>(request: (variables: TVariables) => Promise<Pack>) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: request,
        onSuccess: (pack: Pack) => {
            queryClient.setQueryData(['packs', 'detail', pack.id], pack);
            queryClient.setQueriesData<PackSummary[]>({
                predicate: query => query.queryKey[0] === 'packs' && query.queryKey[1] !== 'detail',
            }, current => current?.map(item => item.id === pack.id ? { ...item, ...pack } : item));
            queryClient.invalidateQueries({ queryKey: ['packs'] });
            queryClient.invalidateQueries({ queryKey: ['files'] });
        },
    });
};

export const useCreatePack = () => usePackMutation(async (payload: { name: string; description?: string; parent_folder_id: number | null; hide_member_files?: boolean; file_ids: number[] }) =>
    (await api.post<Pack>('/packs', payload, { timeout: 60_000 })).data);
export const useUpdatePack = () => usePackMutation(async ({ id, ...payload }: { id: number; name?: string; description?: string; parent_folder_id?: number | null; cover_file_id?: number | null; cover_position_x?:number; cover_position_y?:number; hide_member_files?: boolean }) =>
    (await api.patch<Pack>(`/packs/${id}`, payload)).data);
export const useAddPackItems = () => usePackMutation(async ({ id, fileIds }: { id: number; fileIds: number[] }) =>
    (await api.post<Pack>(`/packs/${id}/items`, { file_ids: fileIds }, { timeout: 60_000 })).data);
export const useRemovePackItem = () => usePackMutation(async ({ id, itemId }: { id: number; itemId: number }) =>
    (await api.delete<Pack>(`/packs/${id}/items/${itemId}`, { timeout: 30_000 })).data);
export const useReorderPack = () => usePackMutation(async ({ id, itemIds }: { id: number; itemIds: number[] }) =>
    (await api.put<Pack>(`/packs/${id}/reorder`, { item_ids: itemIds })).data);
export const useDeletePack = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => { await api.delete(`/packs/${id}`); return id; },
        onSuccess: id => {
            queryClient.removeQueries({ queryKey: ['packs', 'detail', id] });
            queryClient.invalidateQueries({ queryKey: ['packs'] });
        },
    });
};

// ============== Playlist Hooks ==============

const playlistCacheScope = () => {
    const owner = localStorage.getItem('komod-active-workspace') || cachedCurrentUser()?.id || 'guest';
    return String(owner);
};
const libraryFileCacheKey = (folderId?:number|null,fileType?:string,search?:string,page=1,sort='',favoriteOnly=false,includePlaylistCovers=false,includeHidden=false,hiddenOnly=false) =>
    `komod-files:${playlistCacheScope()}:${folderId===undefined?'all':folderId===null?'root':folderId}:${fileType||'-'}:${search||'-'}:${page}:${sort||'-'}:${Number(favoriteOnly)}${Number(includePlaylistCovers)}${Number(includeHidden)}${Number(hiddenOnly)}`;
const libraryFolderCacheKey = (parentId?:number|null,sort='',favoriteOnly=false,includeHidden=false) =>
    `komod-folders:${playlistCacheScope()}:${parentId===undefined?'all':parentId===null?'root':parentId}:${sort||'-'}:${Number(favoriteOnly)}${Number(includeHidden)}`;
const libraryFolderTreeCacheKey = (includeHidden=false) => `komod-folder-tree:${playlistCacheScope()}:${Number(includeHidden)}`;
const playlistCatalogCacheKey = () => `komod-playlists:${playlistCacheScope()}`;
const playlistDetailCacheKey = (id: number) => `komod-playlist:${playlistCacheScope()}:${id}`;
const readJsonCache = <T>(key: string): T | undefined => {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) as T : undefined;
    } catch { return undefined; }
};
const writeJsonCache = (key: string, value: unknown) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Storage may be full or disabled. */ }
};
const cachePlaylistCatalog = (playlists: PlaylistSummary[]) => writeJsonCache(playlistCatalogCacheKey(), playlists);
const cachePlaylist = (playlist: Playlist) => {
    writeJsonCache(playlistDetailCacheKey(playlist.id), playlist);
    const catalog = readJsonCache<PlaylistSummary[]>(playlistCatalogCacheKey()) || [];
    const summary: PlaylistSummary = playlist;
    cachePlaylistCatalog(catalog.some(item => item.id === playlist.id)
        ? catalog.map(item => item.id === playlist.id ? summary : item)
        : [summary, ...catalog]);
};
const offlineRequested = () => !isEffectivelyOnline();

export const usePlaylists = () => useQuery<PlaylistSummary[]>({
    queryKey: ['playlists'],
    queryFn: async () => {
        const cached = readJsonCache<PlaylistSummary[]>(playlistCatalogCacheKey());
        if (offlineRequested()) return cached || [];
        try {
            const data = (await api.get<PlaylistSummary[]>('/playlists')).data;
            cachePlaylistCatalog(data);
            return data;
        } catch (error) {
            if (cached) return cached;
            throw error;
        }
    },
    initialData: () => readJsonCache<PlaylistSummary[]>(playlistCatalogCacheKey()),
    initialDataUpdatedAt: 0,
});

export const useReorderPlaylistCatalog = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (playlistIds: number[]) => runOrQueueMetadataMutation(
            async()=>(await api.put<PlaylistSummary[]>('/playlists/reorder/catalog',{playlist_ids:playlistIds})).data,
            {entity:'playlist',method:'put',url:'/playlists/reorder/catalog',payload:{playlist_ids:playlistIds}},
            ()=>{const current=queryClient.getQueryData<PlaylistSummary[]>(['playlists'])||[];const byId=new Map(current.map(item=>[item.id,item]));return playlistIds.map((id,index)=>({...byId.get(id)!,position:index})).filter(Boolean)},
        ),
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
        onSuccess: data => { queryClient.setQueryData(['playlists'], data); cachePlaylistCatalog(data); },
    });
};

export const useLogoutOthers = () => {
    const queryClient = useQueryClient();
    return useMutation({ mutationFn: async () => (await api.post<{revoked:number}>('/auth/logout-others')).data, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }) });
};

export const usePasswordLogin = () => useMutation({
    mutationFn: async (payload: { username: string; password: string; otp?:string }) => (await api.post<AuthResponse>('/auth/password/login', payload)).data,
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

export const useSetupTwoFactor = () => useMutation({
    mutationFn: async () => (await api.post<TwoFactorSetup>('/auth/2fa/setup')).data,
});

export const useEnableTwoFactor = () => {
    const queryClient=useQueryClient();
    return useMutation({mutationFn:async(payload:{setup_token:string;code:string;current_password?:string})=>(await api.post('/auth/2fa/enable',payload)).data,onSuccess:()=>queryClient.invalidateQueries({queryKey:['credentials']})});
};

export const useDisableTwoFactor = () => {
    const queryClient=useQueryClient();
    return useMutation({mutationFn:async(payload:{code?:string;current_password?:string})=>(await api.post('/auth/2fa/disable',payload)).data,onSuccess:()=>queryClient.invalidateQueries({queryKey:['credentials']})});
};

export const useImportLink = () => useMutation({
    mutationFn: async (payload: { url: string; folder_id?: number | null; new_folder_name?: string; quality?: 'auto' | 'audio' | '480' | '720' | '1080'; save_to_library?:boolean; send_to_telegram?:boolean; destination_ids?:number[] }) =>
        (await api.post<{ message: string; queue_position: number; job_id: string }>('/files/import-link', payload)).data,
});

export const usePlaylist = (id: number | null) => useQuery<Playlist>({
    queryKey: ['playlists', id],
    queryFn: async () => {
        if (id === null) throw new Error('پلی‌لیست انتخاب نشده است.');
        const cached = readJsonCache<Playlist>(playlistDetailCacheKey(id));
        if (offlineRequested()) {
            if (cached) return cached;
            throw new Error('این پلی‌لیست هنوز برای استفاده آفلاین آماده نشده است.');
        }
        try {
            const data = (await api.get<Playlist>(`/playlists/${id}`)).data;
            cachePlaylist(data);
            return data;
        } catch (error) {
            if (cached) return cached;
            throw error;
        }
    },
    enabled: id !== null,
    initialData: () => id === null ? undefined : readJsonCache<Playlist>(playlistDetailCacheKey(id)),
    initialDataUpdatedAt: 0,
});

const usePlaylistMutation = <TVariables>(request: (variables: TVariables) => Promise<Playlist>, queued:(variables:TVariables,current?:Playlist)=>Parameters<typeof queueOfflineMutation>[0], fallback:(variables:TVariables,current?:Playlist)=>Playlist) => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async(variables:TVariables)=>{
            const id=Number((variables as any)?.id);const current=Number.isFinite(id)?queryClient.getQueryData<Playlist>(['playlists',id]):undefined;
            return runOrQueueMetadataMutation(()=>request(variables),queued(variables,current),()=>fallback(variables,current));
        },
        onSuccess: (playlist: Playlist) => {
            cachePlaylist(playlist);
            queryClient.setQueryData(['playlists', playlist.id], playlist);
            queryClient.setQueryData<PlaylistSummary[]>(['playlists'],current=>current?.some(item=>item.id===playlist.id)?current.map(item=>item.id===playlist.id?playlist:item):[playlist,...(current||[])]);
            queryClient.invalidateQueries({ queryKey: ['playlists'] });
            queryClient.invalidateQueries({ queryKey: ['files'] });
            queryClient.invalidateQueries({ queryKey: ['activity'] });
        },
    });
};

export const useCreatePlaylist = () => usePlaylistMutation(async (payload: { name: string; description?: string }) =>
    (await api.post<Playlist>('/playlists', payload)).data,
    payload=>({entity:'playlist',method:'post',url:'/playlists',payload,tempId:offlineTempId(payload)}),
    payload=>{const now=new Date().toISOString();return{id:offlineTempId(payload),name:payload.name,description:payload.description||null,item_count:0,total_duration:0,cover_url:null,cover_file_id:null,cover_urls:[],audio_count:0,video_count:0,preview_names:[],created_at:now,updated_at:now,items:[]}}
);

export const useUpdatePlaylist = () => usePlaylistMutation(async ({ id, ...payload }: { id: number; name?: string; description?: string; cover_file_id?: number | null }) =>
    (await api.patch<Playlist>(`/playlists/${id}`, payload)).data,
    ({id,...payload},current)=>({entity:'playlist',method:'patch',url:`/playlists/${id}`,payload,baseUpdatedAt:current?.updated_at}),
    ({id,...payload},current)=>({...current,id,...payload,updated_at:new Date().toISOString()} as Playlist)
);

export const useAddPlaylistItems = () => usePlaylistMutation(async ({ id, fileIds, allowDuplicates = false }: { id: number; fileIds: number[]; allowDuplicates?: boolean }) =>
    (await api.post<Playlist>(`/playlists/${id}/items`, { file_ids: fileIds, allow_duplicates: allowDuplicates })).data,
    ({id,fileIds,allowDuplicates},current)=>({entity:'playlist',method:'post',url:`/playlists/${id}/items`,payload:{file_ids:fileIds,allow_duplicates:allowDuplicates},baseUpdatedAt:current?.updated_at,conflictUrl:`/playlists/${id}`}),
    (_variables,current)=>current as Playlist
);

export const useRemovePlaylistItem = () => usePlaylistMutation(async ({ id, itemId }: { id: number; itemId: number }) =>
    (await api.delete<Playlist>(`/playlists/${id}/items/item/${itemId}`)).data,
    ({id,itemId},current)=>({entity:'playlist',method:'delete',url:`/playlists/${id}/items/item/${itemId}`,baseUpdatedAt:current?.updated_at,conflictUrl:`/playlists/${id}`}),
    ({itemId},current)=>({...current,items:(current?.items||[]).filter(item=>item.id!==itemId),item_count:Math.max(0,(current?.item_count||0)-1),updated_at:new Date().toISOString()} as Playlist)
);

export const useReorderPlaylist = () => {
    const queryClient = useQueryClient();
    type Variables = { id: number; itemIds: number[] };
    const applyOrder = (current: Playlist | undefined, itemIds: number[], server?: Playlist) => {
        const source = server || current;
        if (!source) return source;
        const byId = new Map(source.items.map(item => [item.id, item]));
        // The requested order is authoritative.  Some database drivers can return a
        // just-updated relationship in its previous in-session order; accepting that
        // response made a dropped row visibly jump back to its old position.
        const items = itemIds
            .map((itemId, position) => {
                const item = byId.get(itemId);
                return item ? { ...item, position } : null;
            })
            .filter((item): item is PlaylistItem => item !== null);
        return items.length === itemIds.length ? { ...source, items } : source;
    };
    return useMutation({
        mutationFn: async ({ id, itemIds }: Variables) => {
            const current = queryClient.getQueryData<Playlist>(['playlists', id]);
            const server = await runOrQueueMetadataMutation(
                async () => (await api.put<Playlist>(`/playlists/${id}/reorder`, { item_ids: itemIds })).data,
                { entity: 'playlist', method: 'put', url: `/playlists/${id}/reorder`, payload: { item_ids: itemIds }, baseUpdatedAt: current?.updated_at, conflictUrl: `/playlists/${id}` },
                () => applyOrder(current, itemIds) as Playlist,
            );
            return applyOrder(current, itemIds, server) as Playlist;
        },
        onMutate: async ({ id, itemIds }) => {
            await queryClient.cancelQueries({ queryKey: ['playlists', id] });
            const previous = queryClient.getQueryData<Playlist>(['playlists', id]);
            const optimistic = applyOrder(previous, itemIds);
            if (optimistic) queryClient.setQueryData(['playlists', id], optimistic);
            return { previous };
        },
        onError: (_error, { id }, context) => {
            if (context?.previous) queryClient.setQueryData(['playlists', id], context.previous);
        },
        onSuccess: (playlist) => {
            queryClient.setQueryData(['playlists', playlist.id], playlist);
            queryClient.invalidateQueries({ queryKey: ['playlists'], exact: true });
        },
    });
};

export const useShufflePlaylist = () => usePlaylistMutation(async (id: number) =>
    (await api.post<Playlist>(`/playlists/${id}/shuffle`)).data,
    (id,current)=>({entity:'playlist',method:'post',url:`/playlists/${id}/shuffle`,baseUpdatedAt:current?.updated_at,conflictUrl:`/playlists/${id}`}),
    (_id,current)=>current as Playlist
);

export const useDeletePlaylist = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id: number) => { const current=queryClient.getQueryData<Playlist>(['playlists',id]);return runOrQueueMetadataMutation(async()=>{await api.delete(`/playlists/${id}`);return id},{entity:'playlist',method:'delete',url:`/playlists/${id}`,baseUpdatedAt:current?.updated_at},()=>id); },
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
    cleanup_links?: boolean;
    cleanup_mentions?: boolean;
    cleanup_hashtags?: boolean;
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
            return runOrQueueMetadataMutation(
                async()=>(await api.post<{message:string;updated:number}>('/files/batch-update',payload)).data,
                {entity:'tag',method:'post',url:'/files/batch-update',payload},
                ()=>({message:'تغییرات برای همگام‌سازی ذخیره شد.',updated:payload.ids.length}),
            );
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['files'] });
            queryClient.invalidateQueries({ queryKey: ['folders'] });
            queryClient.invalidateQueries({ queryKey: ['tag-settings'] });
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

export const formatIranTime = (value: string): string => {
    if (!value) return '—';
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return '—';
    return new Intl.DateTimeFormat('fa-IR', {
        timeZone: 'Asia/Tehran',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(date);
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

export const useSavedFilters = () => useQuery<SavedFilter[]>({
    queryKey: ['saved-filters'],
    queryFn: async () => (await api.get<SavedFilter[]>('/accounts/saved-filters')).data,
});

export const useUpdateSavedFilters = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (filters: SavedFilter[]) => (await api.put<SavedFilter[]>('/accounts/saved-filters', {filters})).data,
        onSuccess: data => queryClient.setQueryData(['saved-filters'], data),
    });
};

export const useUpdateTagSettings = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (payload: Omit<TagSettings, 'tags'> & { tags: Array<{name:string;color:string;category?:string}> }) => runOrQueueMetadataMutation(
            async()=>cacheTagSettings((await api.put<TagSettings>('/accounts/tags',payload)).data),
            {entity:'tag',method:'put',url:'/accounts/tags',payload},
            ()=>cacheTagSettings({...payload,tags:payload.tags.map(item=>({...item,file_count:0}))}),
        ),
        onSuccess: data => queryClient.setQueryData(['tag-settings'], data),
    });
};

export const useDeleteTag = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (name: string) => {const current=queryClient.getQueryData<TagSettings>(['tag-settings'])||{tags:[],excluded_tags:[],show_file_tags:false,display_limit:2};return runOrQueueMetadataMutation(
            async()=>cacheTagSettings((await api.delete<TagSettings>(`/accounts/tags/${encodeURIComponent(name)}`)).data),
            {entity:'tag',method:'delete',url:`/accounts/tags/${encodeURIComponent(name)}`},
            ()=>cacheTagSettings({...current,tags:current.tags.filter(item=>item.name.toLocaleLowerCase('fa')!==name.toLocaleLowerCase('fa'))}),
        )},
        onSuccess: data => {
            queryClient.setQueryData(['tag-settings'], data);
            queryClient.invalidateQueries({ queryKey: ['files'] });
        },
    });
};

export const useDeleteTags = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (names: string[]) => cacheTagSettings((await api.post<TagSettings>('/accounts/tags/delete-batch', {names})).data),
        onSuccess: data => {
            queryClient.setQueryData(['tag-settings'], data);
            queryClient.invalidateQueries({ queryKey: ['files'] });
        },
    });
};

export const useSessions = () => useQuery({ queryKey: ['sessions'], queryFn: async () => (await api.get<AuthSession[]>('/auth/sessions')).data });
export interface SecurityEvent {
    id: number;
    event_type: string;
    success: boolean;
    suspicious: boolean;
    target_type?: string | null;
    ip_address?: string | null;
    device?: string | null;
    created_at: string;
}
export interface PublicShareItem {
    file_id:number;
    file_name:string;
    file_type:TelegramFile['file_type'];
    file_size:number;
    public_hash:string;
    expires_at?:string|null;
    expired:boolean;
    password_protected:boolean;
    allow_download:boolean;
    view_limit?:number|null;
    view_count:number;
    created_at:string;
}
export const usePublicShares = () => useQuery({
    queryKey:['public-shares'],
    queryFn:async()=>(await api.get<PublicShareItem[]>('/files/public-shares')).data,
});
export const useRevokePublicShares = () => { const queryClient=useQueryClient(); return useMutation({
    mutationFn:async(fileIds:number[])=>(await api.post<{revoked:number}>('/files/public-shares/revoke',{file_ids:fileIds})).data,
    onSuccess:()=>{
        queryClient.invalidateQueries({queryKey:['public-shares']});
        queryClient.invalidateQueries({queryKey:['files']});
        queryClient.invalidateQueries({queryKey:['security-events']});
    },
}); };
export const useSecurityEvents = () => useQuery({
    queryKey: ['security-events'],
    queryFn: async () => (await api.get<SecurityEvent[]>('/accounts/security-events?limit=30')).data,
});
export const useClearSecurityEvents = () => { const queryClient=useQueryClient(); return useMutation({
    mutationFn: async () => (await api.delete('/accounts/security-events')).data,
    onSuccess: () => queryClient.invalidateQueries({queryKey:['security-events']}),
}); };
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
export const useAdminHealth = (enabled: boolean) => useQuery({ queryKey: ['adminHealth'], queryFn: async () => (await api.get<AdminHealth>('/admin/health')).data, enabled, retry: 1, staleTime: 10_000, refetchInterval: enabled ? 30_000 : false });
export const useAdminErrors = (enabled: boolean) => useQuery({ queryKey: ['adminErrors'], queryFn: async () => (await api.get<AdminErrorLog[]>('/admin/errors')).data, enabled, retry: 1, staleTime: 15_000 });
export const useResolveAdminError = () => { const queryClient=useQueryClient(); return useMutation({ mutationFn: async(errorId:string)=>(await api.patch(`/admin/errors/${errorId}`)).data, onSuccess:()=>queryClient.invalidateQueries({queryKey:['adminErrors']}) }); };
export const useClearAdminErrors = () => { const queryClient=useQueryClient(); return useMutation({ mutationFn: async()=>(await api.delete('/admin/errors')).data, onSuccess:()=>queryClient.invalidateQueries({queryKey:['adminErrors']}) }); };
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
    return useMutation({
        mutationFn: async (payload: Partial<AccountPreferences>) => (await api.put<AccountPreferences>('/accounts/preferences', payload)).data,
        onMutate: async payload => {
            await queryClient.cancelQueries({queryKey:['accountPreferences']});
            const previous=queryClient.getQueryData<AccountPreferences>(['accountPreferences']);
            queryClient.setQueryData<AccountPreferences>(['accountPreferences'],current=>({...current,...payload} as AccountPreferences));
            return {previous};
        },
        onError: (_error,_payload,context) => { if(context?.previous) queryClient.setQueryData(['accountPreferences'],context.previous); },
        onSuccess: data => queryClient.setQueryData(['accountPreferences'], data),
    });
};
export const useStorageChannel = () => useQuery({ queryKey: ['storageChannel'], queryFn: async () => (await api.get<StorageChannel>('/accounts/storage-channel')).data });
export const useSetStorageChannel = () => { const queryClient=useQueryClient(); return useMutation({ mutationFn: async (channel_id:number)=>(await api.put<StorageChannel>('/accounts/storage-channel',{channel_id})).data, onSuccess:()=>queryClient.invalidateQueries({queryKey:['storageChannel']}) }); };
export const useResetStorageChannel = () => { const queryClient=useQueryClient(); return useMutation({ mutationFn: async()=>api.delete('/accounts/storage-channel'), onSuccess:()=>queryClient.invalidateQueries({queryKey:['storageChannel']}) }); };
export const useRemoveStorageChannel = () => { const queryClient=useQueryClient(); return useMutation({ mutationFn: async(channel_id:number)=>api.delete(`/accounts/storage-channel/${channel_id}`), onSuccess:()=>queryClient.invalidateQueries({queryKey:['storageChannel']}) }); };
export const useUpdateAdminUser = () => {
    const queryClient = useQueryClient();
    return useMutation({ mutationFn: async ({ id, ...payload }: { id: number; display_name?: string|null; is_active?: boolean; tts_daily_limit?:number; tts_max_chars?:number; stt_daily_limit?:number; stt_max_seconds?:number }) => (await api.patch<AdminUser>(`/admin/users/${id}`, payload)).data, onSuccess: (updated) => { queryClient.setQueryData<AdminUser[]>(['adminUsers'], current=>current?.map(item=>item.id===updated.id?updated:item)); queryClient.invalidateQueries({ queryKey: ['adminUsers'] }); queryClient.invalidateQueries({queryKey:['adminStats']}); } });
};
export const useAddAdminUser = () => {
    const queryClient = useQueryClient();
    return useMutation({ mutationFn: async (payload: { telegram_id:number; display_name?:string }) => (await api.post<AdminUser>('/admin/users', payload)).data, onSuccess: () => { queryClient.invalidateQueries({queryKey:['adminUsers']}); queryClient.invalidateQueries({queryKey:['adminStats']}); } });
};
export const useRemoveAdminUser = () => {
    const queryClient = useQueryClient();
    return useMutation({ mutationFn: async (id:number) => api.delete(`/admin/users/${id}`), onSuccess: () => { queryClient.invalidateQueries({queryKey:['adminUsers']}); queryClient.invalidateQueries({queryKey:['adminStats']}); } });
};

export const useTTSSettings = () => useQuery<TTSSettings>({
    queryKey: ['tts-settings'],
    queryFn: async () => (await api.get<TTSSettings>('/tts/settings')).data,
});
export const useUpdateTTSSettings = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (payload: Pick<TTSSettings, 'voice'|'style'|'speed'|'model'|'stt_model'|'stt_mode'|'text_model'|'auto_expression'|'gender'|'pitch'|'use_case'|'folder_id'>) => (await api.put<TTSSettings>('/tts/settings', payload)).data,
        onSuccess: data => queryClient.setQueryData(['tts-settings'], data),
    });
};
export const useGeminiKeys = () => useQuery<GeminiKeySummary>({queryKey:['gemini-personal-keys'],queryFn:async()=>(await api.get('/tts/personal-keys')).data});
export const useUpdateGeminiKeys = () => {const queryClient=useQueryClient();return useMutation({mutationFn:async(keys:string[])=>(await api.put<GeminiKeySummary>('/tts/personal-keys',{keys})).data,onSuccess:data=>{queryClient.setQueryData(['gemini-personal-keys'],data);queryClient.invalidateQueries({queryKey:['tts-settings']})}})};
export const useDeleteGeminiKeys = () => {const queryClient=useQueryClient();return useMutation({mutationFn:async()=>(await api.delete<GeminiKeySummary>('/tts/personal-keys')).data,onSuccess:data=>{queryClient.setQueryData(['gemini-personal-keys'],data);queryClient.invalidateQueries({queryKey:['tts-settings']})}})};
export const useTestGeminiKeys = () => useMutation({mutationFn:async()=>(await api.post<{results:GeminiKeyHealth[]}>('/tts/personal-keys/test')).data.results});
export const useTTSJobs = () => useQuery<TTSJobStatus[]>({
    queryKey: ['tts-jobs'],
    queryFn: async () => (await api.get<TTSJobStatus[]>('/tts/jobs')).data,
    refetchInterval: query => {
        const jobs = query.state.data || [];
        return jobs.some(job => !['done','error','cancelled'].includes(job.state)) ? 1200 : (jobs.length ? 30_000 : false);
    },
});
export const useCreateTTSJob = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (payload: {text:string;title:string;folder_id?:number|null;voice?:string;style?:string;speed?:number;auto_expression?:boolean;gender?:TTSSettings['gender'];pitch?:TTSSettings['pitch'];use_case?:TTSSettings['use_case'];output_mode?:'save'|'preview'|'telegram'}) => (await api.post<{job_id:string;queue_position:number;message:string}>('/tts/jobs', payload)).data,
        onSuccess: () => queryClient.invalidateQueries({queryKey:['tts-jobs']}),
    });
};
export const useControlTTSJob = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async ({id,action}:{id:string;action:'pause'|'cancel'}) => (await api.post<TTSJobStatus>(`/tts/jobs/${id}/${action}`)).data,
        onSuccess: () => queryClient.invalidateQueries({queryKey:['tts-jobs']}),
    });
};
export const useDismissTTSJob = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (id:string) => api.delete(`/tts/jobs/${id}`),
        onSuccess: () => queryClient.invalidateQueries({queryKey:['tts-jobs']}),
    });
};
export const useClearFinishedTTSJobs = () => {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async () => (await api.delete<{removed:number}>('/tts/jobs')).data,
        onSuccess: () => queryClient.invalidateQueries({queryKey:['tts-jobs']}),
    });
};

export const useSTTJobs = () => useQuery<STTJobStatus[]>({
    queryKey:['stt-jobs'], queryFn:async()=>(await api.get<STTJobStatus[]>('/stt/jobs')).data,
    refetchInterval:query=>(query.state.data||[]).some(job=>!['done','error','cancelled'].includes(job.state))?1500:false,
});
export const useCreateSTTJob = () => { const queryClient=useQueryClient(); return useMutation({
    mutationFn:async(payload:{file_id:number;title:string;prompt?:string;post_prompts?:string[];folder_id?:number|null;output_mode:'temporary'|'save'})=>(await api.post('/stt/jobs',payload)).data,
    onSuccess:()=>queryClient.invalidateQueries({queryKey:['stt-jobs']}),
}); };
export const useCancelSTTJob = () => { const queryClient=useQueryClient(); return useMutation({
    mutationFn:async(id:string)=>(await api.post<STTJobStatus>(`/stt/jobs/${id}/cancel`)).data,
    onSuccess:()=>queryClient.invalidateQueries({queryKey:['stt-jobs']}),
}); };
export const useDismissSTTJob = () => { const queryClient=useQueryClient(); return useMutation({
    mutationFn:async(id:string)=>api.delete(`/stt/jobs/${id}`), onSuccess:()=>queryClient.invalidateQueries({queryKey:['stt-jobs']}),
}); };
export const useRefineSTTText = () => useMutation({
    mutationFn: async ({content,prompt,onStatus}:{content:string;prompt:string;onStatus?:(message:string,progress:number)=>void}) => {
        const started=(await api.post<{job_id:string;message:string;progress:number}>('/stt/refine/jobs',{content,prompt},{timeout:30_000})).data;
        onStatus?.(started.message,started.progress);
        for(let attempt=0;attempt<1200;attempt++){
            await new Promise(resolve=>window.setTimeout(resolve,1000));
            const status=(await api.get<{state:string;message:string;progress:number;content?:string}>(`/stt/refine/jobs/${started.job_id}`,{timeout:30_000})).data;
            onStatus?.(status.message,status.progress);
            if(status.state==='done'&&status.content)return{content:status.content};
            if(status.state==='error')throw new Error(status.message||'ویرایش متن انجام نشد.');
        }
        throw new Error('ویرایش متن بیشتر از ۲۰ دقیقه طول کشید؛ متن را کوتاه‌تر کن یا دوباره تلاش کن.');
    },
});

export const sendFilesToTelegram = async (ids:number[], destinationIds:number[] = []) =>
    (await api.post<{sent:number;failed:number[]}>('/files/send-to-telegram', {ids,destination_ids:destinationIds})).data;
