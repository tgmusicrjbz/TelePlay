/**
 * FolderCard component - displays a folder in grid or list view with drag-drop support
 */
import { useState } from 'react';
import { Check, Folder as FolderIcon, MoreVertical, ChevronRight } from 'lucide-react';
import { Folder } from '../lib/api';
import { useAppStore } from '../lib/store';

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

    // Check if this folder's context menu is active
    const showMenu = activeContextMenu?.type === 'folder' && activeContextMenu?.item.id === folder.id;

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setActiveContextMenu({ type: 'folder', item: folder, x: e.clientX, y: e.clientY });
    };

    const handleClick = (e: React.MouseEvent) => {
        if (onSelect && selectionMode) {
            e.preventDefault();
            e.stopPropagation();
            onSelect(true);
        } else {
            onOpen();
        }
    };

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
                className={`relative flex items-center gap-4 p-3 rounded-xl cursor-pointer transition-all duration-200 animate-slide-up active:scale-[0.99]
                    glass-card hover:bg-white/[0.03] border-white/[0.05] group
                    ${dropStyles} ${selectedStyles}`}
                onClick={handleClick}
                onContextMenu={handleContextMenu}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                data-folder-id={folder.id}
            >
                {selectionMode && <button onClick={handleSelectClick} className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-colors ${selected ? 'border-primary-400 bg-primary-500/15 text-primary-200' : 'border-white/10 bg-dark-800 text-dark-500'}`} aria-label={selected ? 'لغو انتخاب کشو' : 'انتخاب کشو'}><span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 ${selected ? 'border-primary-400 bg-primary-500 text-white' : 'border-white/30'}`}>{selected && <Check className="h-4 w-4"/>}</span></button>}
                <div 
                    className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 border transition-colors
                        ${selected 
                            ? 'bg-primary-500/20 border-primary-500/40' 
                            : 'bg-primary-500/10 border-primary-500/20 group-hover:bg-primary-500/20'}`}
                >
                    <FolderIcon className={`w-6 h-6 transition-colors ${selected ? 'text-primary-300' : 'text-primary-400 group-hover:text-primary-300'}`} />
                    
                </div>

                <div className="flex-1 min-w-0">
                    <p className={`font-medium truncate text-sm transition-colors ${selected ? 'text-primary-300' : 'text-white group-hover:text-primary-300'}`}>{folder.name}</p>
                    <p className="text-xs text-dark-400 mt-0.5">
                        {folder.file_count.toLocaleString('fa-IR')} فایل
                    </p>
                    {folder.description && <p dir="auto" className="text-xs text-dark-400 truncate mt-1" title={folder.description}>{folder.description}</p>}
                </div>

                <div className="relative flex items-center gap-2">
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
            className={`${dense ? 'p-2.5' : 'p-4'} rounded-xl cursor-pointer transition-all duration-300 group relative animate-scale-in select-none
                glass-card hover:bg-dark-800/60 hover:shadow-xl hover:shadow-black/20 hover:-translate-y-1
                ${dropStyles} ${selectedStyles}`}
            onClick={handleClick}
            onContextMenu={handleContextMenu}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            data-folder-id={folder.id}
        >
            <div className={`flex items-start justify-between ${dense ? 'mb-2' : 'mb-3'}`}>
                <div 
                    className={`w-10 h-10 rounded-lg flex items-center justify-center border group-hover:scale-110 transition-all duration-300
                        ${selected 
                            ? 'bg-gradient-to-br from-primary-500/20 to-primary-500/10 border-primary-500/40' 
                            : 'bg-gradient-to-br from-primary-500/10 to-primary-500/5 border-primary-500/20 group-hover:border-primary-500/30'}`}
                >
                    <FolderIcon className={`w-5 h-5 transition-colors ${selected ? 'text-primary-300' : 'text-primary-400'}`} />
                    
                </div>
                <div className="flex items-center gap-1">
                {selectionMode && <button onClick={handleSelectClick} className={`flex h-9 w-9 items-center justify-center rounded-lg border ${selected ? 'border-primary-400 bg-primary-500/15 text-primary-200' : 'border-white/10 bg-dark-800 text-dark-500'}`} aria-label={selected ? 'لغو انتخاب کشو' : 'انتخاب کشو'}><span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${selected ? 'border-primary-400 bg-primary-500 text-white' : 'border-white/30'}`}>{selected && <Check className="h-3.5 w-3.5"/>}</span></button>}
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

            <p className={`font-medium text-sm truncate transition-colors ${selected ? 'text-primary-300' : 'text-white group-hover:text-primary-300'}`} title={folder.name}>
                {folder.name}
            </p>
            <p className="text-xs text-dark-500 mt-1">
                {folder.file_count.toLocaleString('fa-IR')} فایل
            </p>
            {!dense && folder.description && <p dir="auto" className="text-xs text-dark-400 truncate mt-1" title={folder.description}>{folder.description}</p>}
        </div>
    );
}
