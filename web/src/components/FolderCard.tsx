/**
 * FolderCard component - displays a folder in grid or list view with drag-drop support
 */
import { useRef, useState } from 'react';
import { Check, Folder as FolderIcon, MoreVertical, ChevronRight, Pin, Star } from 'lucide-react';
import { Folder } from '../lib/api';
import { useAppStore } from '../lib/store';
import { useCardDisplayPreferences } from '../lib/cardDisplay';
import BlurredPreview from './BlurredPreview';

interface FolderCardProps {
    folder: Folder;
    viewMode: 'grid' | 'dense' | 'list';
    selected?: boolean;
    selectionMode?: boolean;
    onSelect?: (multi: boolean) => void;
    onOpen: () => void;
    onFileDrop: (fileId: number, folderId: number) => void;
}

export default function FolderCard({ folder, viewMode, selected, selectionMode = false, onSelect, onOpen, onFileDrop }: FolderCardProps) {
    const [isDragOver, setIsDragOver] = useState(false);
    const { activeContextMenu, setActiveContextMenu } = useAppStore();
    const cardDisplay=useCardDisplayPreferences();
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const longPressed = useRef(false);
    const token = localStorage.getItem('access_token') || '';
    const coverUrl = folder.cover_url ? `${folder.cover_url}${folder.cover_url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : null;
    const folderColor = folder.color || undefined;
    const folderCardStyle = folderColor ? {
        backgroundColor: `${folderColor}18`,
        borderColor: `${folderColor}55`,
        boxShadow: `inset -3px 0 0 ${folderColor}aa`,
    } : undefined;

    // Check if this folder's context menu is active
    const showMenu = activeContextMenu?.type === 'folder' && activeContextMenu?.item.id === folder.id;

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (longPressed.current) return;
        setActiveContextMenu({ type: 'folder', item: folder, x: e.clientX, y: e.clientY });
    };

    const handleClick = (e: React.MouseEvent) => {
        if (longPressed.current) { longPressed.current = false; return; }
        if (onSelect && selectionMode) {
            e.preventDefault();
            e.stopPropagation();
            onSelect(true);
        } else {
            onOpen();
        }
    };
    const beginLongPress = () => {
        if (!onSelect) return;
        longPressed.current = false;
        longPressTimer.current = setTimeout(() => { longPressed.current = true; onSelect(true); }, 500);
    };
    const endLongPress = () => { if (longPressTimer.current) clearTimeout(longPressTimer.current); longPressTimer.current = null; };

    const handleSelectClick = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect?.(true);
    };

    // Drop handlers
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setIsDragOver(true);
    };

    const handleDragLeave = () => {
        setIsDragOver(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);

        try {
            const data = JSON.parse(e.dataTransfer.getData('application/json'));
            if (data.type === 'file' && data.id) {
                onFileDrop(data.id, folder.id);
            }
        } catch (err) {
            console.error('Invalid drop data:', err);
        }
    };

    const dropStyles = isDragOver
        ? 'ring-2 ring-primary-500 bg-primary-500/20 scale-105 shadow-xl shadow-primary-500/20'
        : '';
        
    const selectedStyles = selected 
        ? 'ring-2 ring-primary-500 bg-primary-500/10' 
        : '';

    if (viewMode === 'list') {
        return (
            <div
                style={folderCardStyle}
                className={`library-card relative flex items-center gap-4 rounded-2xl p-3 cursor-pointer active:scale-[0.99] group
                    ${dropStyles} ${selectedStyles}`}
                data-selected={Boolean(selected)}
                onClick={handleClick}
                onContextMenu={handleContextMenu}
                onPointerDown={beginLongPress}
                onPointerUp={endLongPress}
                onPointerCancel={endLongPress}
                onPointerLeave={endLongPress}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                data-folder-id={folder.id}
            >
                <BlurredPreview active={Boolean(folder.is_blurred)} card compact />
                {selectionMode && <button onClick={handleSelectClick} className="absolute left-0 top-0 z-30 flex h-11 w-11 items-center justify-center" aria-label={selected ? 'لغو انتخاب کشو' : 'انتخاب کشو'}><span className={`flex h-6 w-6 items-center justify-center rounded-md border ${selected ? 'border-primary-400 bg-primary-500 text-white' : 'border-white/30 bg-dark-900/90'}`}>{selected && <Check className="h-4 w-4"/>}</span></button>}
                <div
                    style={folderColor && !coverUrl ? { backgroundColor: `${folderColor}22`, borderColor: `${folderColor}66` } : undefined}
                    className={`relative w-12 h-12 rounded-lg flex items-center justify-center shrink-0 overflow-hidden border transition-all
                        ${selected 
                            ? 'bg-primary-500/20 border-primary-500/40' 
                            : 'bg-primary-500/10 border-primary-500/20 group-hover:bg-primary-500/20'}`}
                >
                    <span className="absolute inset-0 flex items-center justify-center transition duration-300">{coverUrl ? <img src={coverUrl} alt="" className="h-full w-full object-cover"/> : folder.icon ? <span className="text-2xl leading-none">{folder.icon}</span> : <FolderIcon style={folderColor ? {color:folderColor}:undefined} className={`w-6 h-6 transition-colors ${selected ? 'text-primary-300' : 'text-primary-400 group-hover:text-primary-300'}`} />}</span>
                    {cardDisplay.statusBadges&&(folder.is_pinned || folder.is_favorite) && <span className="absolute -right-1 -top-1 z-20 flex items-center gap-0.5 rounded-full border border-white/10 bg-dark-900/95 p-1 shadow-lg">{folder.is_pinned && <Pin className="h-3 w-3 fill-current text-primary-300"/>}{folder.is_favorite && <Star className="h-3 w-3 fill-current text-amber-300"/>}</span>}
                </div>

                <div className="min-w-0 flex-1">
                    <p className={`flex items-center gap-1.5 font-medium truncate text-sm transition-colors ${selected ? 'text-primary-300' : 'text-white group-hover:text-primary-300'}`}><span className="truncate">{folder.name}</span></p>
                    {cardDisplay.folderCount&&<p className="text-xs text-dark-400 mt-0.5">
                        {folder.file_count.toLocaleString('fa-IR')} فایل
                    </p>}
                    {cardDisplay.folderDescription&&folder.description && <p dir="auto" className="text-xs text-dark-400 truncate mt-1" title={folder.description}>{folder.description}</p>}
                </div>

                <div className="relative z-30 flex items-center gap-2">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            if (showMenu) {
                                setActiveContextMenu(null);
                            } else {
                                const rect = e.currentTarget.getBoundingClientRect();
                                setActiveContextMenu({ type: 'folder', item: folder, x: rect.right, y: rect.bottom });
                            }
                        }}
                        className={`p-2 rounded-lg transition-colors ${showMenu ? 'bg-white/10 text-white' : 'hover:bg-white/[0.08] text-dark-300'}`}
                    >
                        <MoreVertical className="w-4 h-4" />
                    </button>
                    <ChevronRight className="w-4 h-4 text-dark-600 group-hover:text-dark-400 transition-colors" />
                </div>
            </div>
        );
    }

    // Grid view
    const dense = viewMode === 'dense';
    return (
        <div
            style={folderCardStyle}
            className={`library-card ${dense ? 'p-2.5' : 'p-4'} rounded-2xl cursor-pointer group relative select-none
                ${dropStyles} ${selectedStyles}`}
            data-selected={Boolean(selected)}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            onPointerDown={beginLongPress}
            onPointerUp={endLongPress}
            onPointerCancel={endLongPress}
            onPointerLeave={endLongPress}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            data-folder-id={folder.id}
        >
            <BlurredPreview active={Boolean(folder.is_blurred)} card />
            <div className={`flex items-start justify-between ${dense ? 'mb-2' : 'mb-3'}`}>
                <div
                    style={folderColor && !coverUrl ? { backgroundColor: `${folderColor}22`, borderColor: `${folderColor}66` } : undefined}
                    className={`relative w-10 h-10 rounded-lg flex items-center justify-center overflow-hidden border group-hover:scale-110 transition-all duration-300
                        ${selected 
                            ? 'bg-gradient-to-br from-primary-500/20 to-primary-500/10 border-primary-500/40' 
                            : 'bg-gradient-to-br from-primary-500/10 to-primary-500/5 border-primary-500/20 group-hover:border-primary-500/30'}`}
                >
                    <span className="absolute inset-0 flex items-center justify-center transition duration-300">{coverUrl ? <img src={coverUrl} alt="" className="h-full w-full object-cover"/> : folder.icon ? <span className="text-xl leading-none">{folder.icon}</span> : <FolderIcon style={folderColor ? {color:folderColor}:undefined} className={`w-5 h-5 transition-colors ${selected ? 'text-primary-300' : 'text-primary-400'}`} />}</span>
                    {cardDisplay.statusBadges&&(folder.is_pinned || folder.is_favorite) && <span className="absolute -right-1 -top-1 z-20 flex items-center gap-0.5 rounded-full border border-white/10 bg-dark-900/95 p-0.5 shadow-lg">{folder.is_pinned && <Pin className="h-2.5 w-2.5 fill-current text-primary-300"/>}{folder.is_favorite && <Star className="h-2.5 w-2.5 fill-current text-amber-300"/>}</span>}
                </div>
                <div className="relative z-30 flex items-center gap-1">
                {selectionMode && <button onClick={handleSelectClick} className="absolute left-0 top-0 z-30 flex h-11 w-11 items-center justify-center" aria-label={selected ? 'لغو انتخاب کشو' : 'انتخاب کشو'}><span className={`flex h-6 w-6 items-center justify-center rounded-md border ${selected ? 'border-primary-400 bg-primary-500 text-white' : 'border-white/30 bg-dark-900/90'}`}>{selected && <Check className="h-4 w-4"/>}</span></button>}
                {!selectionMode && <button
                    onClick={(e) => {
                        e.stopPropagation();
                        if (showMenu) {
                            setActiveContextMenu(null);
                        } else {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setActiveContextMenu({ type: 'folder', item: folder, x: rect.right, y: rect.bottom });
                        }
                    }}
                    className={`p-1.5 rounded-lg transition-colors ${showMenu ? 'bg-white/10 text-white' : 'hover:bg-white/[0.08] text-dark-300'}`}
                >
                    <MoreVertical className="w-4 h-4" />
                </button>}
                </div>
            </div>

            <p className={`flex items-center gap-1.5 font-medium text-sm truncate transition-all ${selected ? 'text-primary-300' : 'text-white group-hover:text-primary-300'}`} title={folder.name}>
                <span className="truncate">{folder.name}</span>
            </p>
            {cardDisplay.folderCount&&<p className="text-xs text-dark-500 mt-1">
                {folder.file_count.toLocaleString('fa-IR')} فایل
            </p>}
            {!dense&&cardDisplay.folderDescription&&folder.description && <p dir="auto" className="text-xs text-dark-400 truncate mt-1" title={folder.description}>{folder.description}</p>}
        </div>
    );
}
