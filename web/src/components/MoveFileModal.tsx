/**
 * MoveFileModal - modal for selecting a destination folder
 */
import { useState } from 'react';
import { X, Folder as FolderIcon, ChevronRight, Home, Plus } from 'lucide-react';
import { useFolderTree, TelegramFile, Folder, useMoveFiles, useMoveFolders, useCreateFolder } from '../lib/api';
import { useAppStore } from '../lib/store';

interface MoveFileModalProps {
    items: { files: TelegramFile[]; folders: Folder[] };
    onClose: () => void;
}

export default function MoveFileModal({ items, onClose }: MoveFileModalProps) {
    const [selectedId, setSelectedId] = useState<number | null>(null);
    const { data: folderTree, isLoading } = useFolderTree();
    const { mutateAsync: moveFiles, isPending: isFilesPending } = useMoveFiles();
    const { mutateAsync: moveFolders, isPending: isFoldersPending } = useMoveFolders();
    const createFolder=useCreateFolder();
    const [creatingFolder,setCreatingFolder]=useState(false);
    const [folderName,setFolderName]=useState('');
    const { addToast, clearSelection } = useAppStore();

    const isPending = isFilesPending || isFoldersPending;
    const totalItems = items.files.length + items.folders.length;
    const movingFolderIds = new Set(items.folders.map(folder => folder.id));
    const blockedIds = new Set<number>();
    const markBlocked = (folders: Folder[], insideMovingFolder = false) => {
        folders.forEach(folder => {
            const blocked = insideMovingFolder || movingFolderIds.has(folder.id);
            if (blocked) blockedIds.add(folder.id);
            if (folder.children) markBlocked(folder.children, blocked);
        });
    };
    markBlocked(folderTree || []);

    const handleMove = async () => {
        try {
            const promises = [];
            if (items.files.length > 0) {
                promises.push(moveFiles({ ids: items.files.map(f => f.id), folderId: selectedId }));
            }
            if (items.folders.length > 0) {
                // Prevent moving folder into itself
                const folderIds = items.folders.map(f => f.id);
                if (selectedId && blockedIds.has(selectedId)) {
                    addToast('نمی‌شود یک کشو را داخل خودش یا زیرکشوهایش جابه‌جا کرد.', 'error');
                    return;
                }
                promises.push(moveFolders({ ids: folderIds, folderId: selectedId }));
            }

            await Promise.all(promises);
            addToast(`${totalItems.toLocaleString('fa-IR')} مورد با موفقیت جابه‌جا شد.`);
            clearSelection();
            onClose();
        } catch (error) {
            addToast('جابه‌جایی انجام نشد. دوباره تلاش کن.', 'error');
        }
    };
    const handleCreateFolder=async()=>{
        const name=folderName.trim();
        if(!name)return;
        try{
            const folder=await createFolder.mutateAsync({name,parent_id:selectedId});
            setSelectedId(folder.id);setFolderName('');setCreatingFolder(false);
            addToast('کشوی تازه ساخته و به‌عنوان مقصد انتخاب شد.');
        }catch{addToast('ساخت کشوی تازه انجام نشد.','error')}
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
            <div className="glass-card w-full max-w-md p-6 animate-scale-in">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">جابه‌جایی {totalItems.toLocaleString('fa-IR')} مورد</h2>
                    <button onClick={onClose} className="p-1 hover:bg-dark-700 rounded">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <p className="text-sm text-dark-400 mb-4 truncate">
                    کشوی مقصد را انتخاب کن
                </p>

                <div className="bg-dark-800 rounded-lg max-h-64 overflow-y-auto mb-4 custom-scrollbar">
                    {/* Root option */}
                    <button
                        onClick={() => setSelectedId(null)}
                        className={`w-full flex items-center gap-2 px-4 py-3 hover:bg-dark-700 transition-colors ${selectedId === null ? 'bg-primary-600/20 text-primary-400' : ''
                            }`}
                    >
                        <Home className="w-4 h-4" />
                        <span>بیرون از کشو</span>
                    </button>

                    {isLoading ? (
                        <div className="p-4 text-center text-dark-400">در حال بارگذاری…</div>
                    ) : (
                        folderTree?.map((folder) => (
                            <FolderTreeItem
                                key={folder.id}
                                folder={folder}
                                selectedId={selectedId}
                                blockedIds={blockedIds}
                                onSelect={setSelectedId}
                                depth={0}
                            />
                        ))
                    )}
                </div>

                {creatingFolder?<div className="mb-4 flex gap-2 rounded-xl border border-primary-400/15 bg-primary-500/[.05] p-2"><input autoFocus dir="auto" className="input min-w-0 flex-1 text-right" value={folderName} onChange={event=>setFolderName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();void handleCreateFolder()}}} placeholder="نام کشوی تازه"/><button disabled={!folderName.trim()||createFolder.isPending} className="btn-primary shrink-0 px-3 text-xs" onClick={()=>void handleCreateFolder()}>{createFolder.isPending?'…':'ساخت'}</button><button className="btn-icon shrink-0" onClick={()=>setCreatingFolder(false)}><X className="h-4 w-4"/></button></div>:<button type="button" onClick={()=>setCreatingFolder(true)} className="mb-4 flex min-h-10 w-full items-center justify-center gap-2 rounded-xl border border-primary-400/15 bg-primary-500/[.06] text-sm text-primary-200"><Plus className="h-4 w-4"/>ساخت کشوی تازه در مقصد فعلی</button>}

                <div className="flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-dark-400 hover:text-white transition-colors"
                    >
                        لغو
                    </button>
                    <button
                        onClick={handleMove}
                        disabled={isPending}
                        className="px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                    >
                        {isPending ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                در حال جابه‌جایی…
                            </>
                        ) : (
                            'انتقال به اینجا'
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

function FolderTreeItem({ folder, selectedId, blockedIds, onSelect, depth }: {
    folder: Folder;
    selectedId: number | null;
    blockedIds: Set<number>;
    onSelect: (id: number) => void;
    depth: number;
}) {
    const [expanded, setExpanded] = useState(true);
    const hasChildren = folder.children && folder.children.length > 0;

    return (
        <div>
            <button
                onClick={() => onSelect(folder.id)}
                disabled={blockedIds.has(folder.id)}
                title={blockedIds.has(folder.id) ? 'انتقال به این کشو ممکن نیست' : undefined}
                className={`w-full flex items-center gap-2 px-4 py-2 hover:bg-dark-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${selectedId === folder.id ? 'bg-primary-600/20 text-primary-400' : ''
                    }`}
                style={{ paddingRight: `${16 + depth * 16}px` }}
            >
                {hasChildren && (
                    <div
                        onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                        className="p-0.5"
                    >
                        <ChevronRight className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                    </div>
                )}
                {!hasChildren && <div className="w-4" />}
                <FolderIcon className="w-4 h-4 text-primary-400" />
                <span className="truncate">{folder.name}</span>
                <span className="text-xs text-dark-500 ml-auto">{folder.file_count}</span>
            </button>

            {expanded && hasChildren && folder.children?.map((child) => (
                <FolderTreeItem
                    key={child.id}
                    folder={child}
                    selectedId={selectedId}
                    blockedIds={blockedIds}
                    onSelect={onSelect}
                    depth={depth + 1}
                />
            ))}
        </div>
    );
}
