/**
 * FileCard component - displays a single file in grid or list view
 */
import { Play, MoreVertical, Film, Music, FileText, Image, Check, Star } from 'lucide-react';
import { TelegramFile, formatFileSize, formatDuration, formatPersianDate, useUpdateFile } from '../lib/api';
import { useAppStore } from '../lib/store';

interface FileCardProps {
    file: TelegramFile;
    viewMode: 'grid' | 'dense' | 'list';
    selected: boolean;
    selectionMode?: boolean;
    onSelect: (multi: boolean) => void;
    onPlay: () => void;
}

export default function FileCard({
    file,
    viewMode,
    selected,
    selectionMode = false,
    onSelect,
    onPlay
}: FileCardProps) {
    const { activeContextMenu, setActiveContextMenu, addToast } = useAppStore();
    const updateFile = useUpdateFile();
    const toggleFavorite = async (event: React.MouseEvent) => {
        event.stopPropagation();
        await updateFile.mutateAsync({ id: file.id, is_favorite: !file.is_favorite });
        addToast(file.is_favorite ? 'از نشان‌شده‌ها برداشته شد' : 'به نشان‌شده‌ها اضافه شد ⭐');
    };

    // Check if this file's context menu is active
    const showMenu = activeContextMenu?.type === 'file' && activeContextMenu?.item.id === file.id;

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!selected) {
            onSelect(false);
        }
        setActiveContextMenu({ type: 'file', item: file, x: e.clientX, y: e.clientY });
    };

    const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (selectionMode) onSelect(true);
        else onPlay();
    };

    // Generate authenticated stream URL for thumbnail
    const token = localStorage.getItem('access_token');
    const thumbnailSource = file.thumbnail_url || (file.file_type === 'image' ? file.stream_url : null);
    const authorizedThumbnailUrl = thumbnailSource
        ? `${thumbnailSource}${thumbnailSource.includes('?') ? '&' : '?'}token=${encodeURIComponent(token || '')}`
        : null;

    const getIcon = () => {
        switch (file.file_type) {
            case 'video': return <Film className="w-8 h-8 text-primary-400" />;
            case 'audio': return <Music className="w-8 h-8 text-pink-400" />;
            case 'image': return <Image className="w-8 h-8 text-emerald-400" />;
            default: return <FileText className="w-8 h-8 text-blue-400" />;
        }
    };

    const getSmallIcon = () => {
        switch (file.file_type) {
            case 'video': return <Film className="w-3 h-3 text-primary-400" />;
            case 'audio': return <Music className="w-3 h-3 text-pink-400" />;
            case 'image': return <Image className="w-3 h-3 text-emerald-400" />;
            default: return <FileText className="w-3 h-3 text-blue-400" />;
        }
    };

    const typeLabel = ({ video: 'ویدیو', audio: 'صوت', image: 'عکس', document: 'سند', text: 'متن' } as Record<string, string>)[file.file_type] || 'فایل';

    if (viewMode === 'list') {
        return (
            <div
                className={`relative flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-all duration-200 animate-slide-up active:scale-[0.99]
                    ${selected
                        ? 'bg-primary-500/10 border border-primary-500/30'
                        : 'glass-card hover:bg-white/[0.03] border-white/[0.05]'
                    }`}
                onClick={handleClick}
                onContextMenu={handleContextMenu}
                data-file-id={file.id}
            >
            {selectionMode && <div className="absolute left-0 top-0 z-10 flex h-11 w-11 items-center justify-center"><div className={`flex h-6 w-6 items-center justify-center rounded-md border ${selected ? 'border-primary-400 bg-primary-500 text-white' : 'border-white/30 bg-dark-900/90'}`}>{selected && <Check className="h-4 w-4" />}</div></div>}
            <button onClick={toggleFavorite} disabled={updateFile.isPending} className={`absolute right-2 top-2 z-10 rounded-full p-1.5 ${file.is_favorite ? 'bg-amber-400/15 text-amber-300' : 'text-dark-500 opacity-0 group-hover:opacity-100'}`} title={file.is_favorite ? 'برداشتن نشان' : 'نشان کردن'}><Star className={`h-3.5 w-3.5 ${file.is_favorite ? 'fill-current' : ''}`}/></button>
                <div className="w-12 h-12 rounded-lg bg-dark-800/80 flex items-center justify-center overflow-hidden shrink-0 border border-white/[0.05]">
                    {authorizedThumbnailUrl ? (
                        <img src={authorizedThumbnailUrl} alt={file.file_name} className="w-full h-full object-cover" />
                    ) : (
                        getIcon()
                    )}
                </div>

                <div className="flex-1 min-w-0">
                    <p className={`font-medium truncate text-sm ${selected ? 'text-primary-200' : 'text-white'}`}>{file.file_name}</p>
                    {file.description && <p dir="auto" className="text-xs text-dark-400 line-clamp-2 mt-0.5" title={file.description}>{file.description}</p>}
                    <div className="flex items-center gap-3 text-xs text-dark-400 mt-1">
                        <span className="flex items-center gap-1">
                            {getSmallIcon()}
                            <span>{typeLabel}</span>
                        </span>
                        <span className="w-1 h-1 rounded-full bg-dark-600"></span>
                        <span>{formatFileSize(file.file_size)}</span>
                        {file.duration && (
                            <>
                                <span className="w-1 h-1 rounded-full bg-dark-600"></span>
                                <span>{formatDuration(file.duration)}</span>
                            </>
                        )}
                        {file.last_pos && file.duration && (file.last_pos / file.duration > 0.05) && (
                            <>
                                <span className="w-1 h-1 rounded-full bg-dark-600"></span>
                                <span className="text-primary-400">
                                    {Math.round((file.last_pos / file.duration) * 100)}%
                                </span>
                            </>
                        )}
                    </div>
                    <p className="text-[10px] text-dark-500 mt-1" title={`آخرین تغییر: ${formatPersianDate(file.updated_at)}`}>
                        آپلود: {formatPersianDate(file.created_at)} · تغییر: {formatPersianDate(file.updated_at)}
                    </p>
                </div>

                <div className="relative">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (showMenu) {
                                setActiveContextMenu(null);
                            } else {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setActiveContextMenu({ type: 'file', item: file, x: rect.right, y: rect.bottom });
                            }
                        }}
                        className={`p-2 rounded-lg transition-colors ${showMenu ? 'bg-white/10 text-white' : 'hover:bg-white/[0.08] text-dark-400'}`}
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button>
                </div>
            </div>
        );
    }

    // Grid view
    const dense = viewMode === 'dense';
    return (
        <div
            className={`${dense ? 'p-2' : 'p-3'} rounded-xl cursor-pointer transition-all duration-300 group relative animate-scale-in select-none
                ${selected
                    ? 'bg-primary-500/10 border border-primary-500/30 shadow-lg shadow-primary-500/5'
                    : 'glass-card hover:bg-dark-800/60 hover:shadow-xl hover:shadow-black/20 hover:-translate-y-1'
                }`}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            data-file-id={file.id}
        >
            {selectionMode && <div className="absolute left-0 top-0 z-20 flex h-11 w-11 items-center justify-center"><div className={`flex h-6 w-6 items-center justify-center rounded-md border ${selected ? 'border-primary-400 bg-primary-500 text-white' : 'border-white/30 bg-dark-900/90'}`}>{selected && <Check className="h-4 w-4" />}</div></div>}
            <button onClick={toggleFavorite} disabled={updateFile.isPending} className={`absolute right-2 top-2 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-dark-950/75 backdrop-blur ${file.is_favorite ? 'text-amber-300' : 'text-white/65 opacity-0 group-hover:opacity-100'}`} title={file.is_favorite ? 'برداشتن نشان' : 'نشان کردن'}><Star className={`h-4 w-4 ${file.is_favorite ? 'fill-current' : ''}`}/></button>
            <div className={`aspect-video rounded-lg ${dense ? 'mb-2' : 'mb-3'} overflow-hidden relative border ${selected ? 'border-primary-500/20' : 'border-white/[0.05]'} bg-dark-900/50`}>
                {authorizedThumbnailUrl ? (
                    <>
                        <img src={authorizedThumbnailUrl} alt={file.file_name} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" />
                        {/* Gradient overlay */}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                    </>
                ) : (
                    <div className="w-full h-full flex items-center justify-center">
                        {getIcon()}
                    </div>
                )}

                {/* Progress Bar */}
                {file.last_pos && file.duration && (file.last_pos / file.duration > 0.05) && (
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
                        <div 
                            className="h-full bg-primary-500" 
                            style={{ width: `${Math.min(100, (file.last_pos / file.duration) * 100)}%` }}
                        />
                    </div>
                )}

                {/* Duration badge */}
                {file.duration && (
                    <div className="absolute bottom-1.5 right-1.5 bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded text-[10px] font-medium text-white shadow-sm">
                        {formatDuration(file.duration)}
                    </div>
                )}

                {/* Play overlay for video/audio */}
                {(file.file_type === 'video' || file.file_type === 'audio') && (
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-300">
                        <div className="w-10 h-10 rounded-full bg-white/10 backdrop-blur-md flex items-center justify-center shadow-lg border border-white/20 hover:scale-110 transition-transform">
                            <Play className="w-4 h-4 text-white ml-0.5" fill="currentColor" />
                        </div>
                    </div>
                )}
            </div>

            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                    <p className={`font-medium text-sm truncate transition-colors ${selected ? 'text-primary-200' : 'text-white group-hover:text-primary-300'}`} title={file.file_name}>
                        {file.file_name}
                    </p>
                    {!dense && file.description && <p dir="auto" className="text-xs text-dark-400 line-clamp-2 mt-0.5" title={file.description}>{file.description}</p>}
                    <div className="flex items-center gap-2 mt-1">
                        <span className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-md border ${
                            selected 
                            ? 'bg-primary-500/20 border-primary-500/20 text-primary-300' 
                            : 'bg-dark-800 border-white/[0.05] text-dark-400 group-hover:border-white/[0.1]'
                        }`}>
                            {getSmallIcon()}
                            <span>{typeLabel}</span>
                        </span>
                        <p className="text-[10px] text-dark-500">
                            {formatFileSize(file.file_size)}
                        </p>
                    </div>
                    {!dense && <p className="text-[10px] text-dark-500 mt-1 leading-4">
                        آپلود: {formatPersianDate(file.created_at)}<br />تغییر: {formatPersianDate(file.updated_at)}
                    </p>}
                </div>

                <div className={`${showMenu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                   <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (showMenu) {
                                setActiveContextMenu(null);
                            } else {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setActiveContextMenu({ type: 'file', item: file, x: rect.right, y: rect.bottom });
                            }
                        }}
                        className={`p-1.5 rounded-lg transition-colors ${showMenu ? 'bg-white/10 text-white' : 'hover:bg-white/[0.08] text-dark-400'}`}
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button> 
                </div>
            </div>
        </div>
    );
}
