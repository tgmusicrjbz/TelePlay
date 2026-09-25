import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../lib/store';
import { TelegramFile, Folder, api, canPreviewText, useUpdateFile } from '../lib/api';
import { Play, Download, Link, Edit, FolderInput, Trash2, Globe, ShieldOff, HardDriveDownload, Eye, AlignLeft, ListPlus, Heart } from 'lucide-react';

export default function GlobalContextMenu() {
    const { activeContextMenu, setActiveContextMenu, setPreviewFile, setMoveItems, setMoveFiles, setDeleteConfirm, setRenameFile, setRenameFolder, setDescriptionItem, selectedFileIds, selectedFiles, setPlaylistFile, addToast } = useAppStore();
    const updateFile = useUpdateFile();
    const menuRef = useRef<HTMLDivElement>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // Close menu on escape
    useEffect(() => {
        const handleEscape = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                setActiveContextMenu(null);
            }
        };
        if (activeContextMenu) {
            document.addEventListener('keydown', handleEscape);
        }
        return () => document.removeEventListener('keydown', handleEscape);
    }, [activeContextMenu, setActiveContextMenu]);

    if (!activeContextMenu) return null;

    const { x, y } = activeContextMenu;
    const isMultiSelect = selectedFileIds.size > 1 && activeContextMenu.type === 'file' && selectedFileIds.has(activeContextMenu.item.id);

    // Adjust position to keep within viewport
    const getMenuPosition = () => {
        const menuWidth = 220;
        const padding = 10;
        const menuHeight = Math.min(window.innerHeight * 0.82, 620);

        let posX = x;
        let posY = y;

        if (posX + menuWidth > window.innerWidth - padding) {
            posX = window.innerWidth - menuWidth - padding;
        }
        posY = Math.min(Math.max(padding, posY), Math.max(padding, window.innerHeight - menuHeight - padding));

        return { left: posX, top: posY };
    };

    const position = getMenuPosition();
    const isMobile = window.innerWidth < 640;

    const handleAction = (action: () => void) => {
        action();
        setActiveContextMenu(null);
    };

    const handleCopy = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        } catch (err) {
                    console.error('کپی‌کردن انجام نشد:', err);
        }
    };

    // --- File Actions ---
    const handlePlay = (file: TelegramFile) => {
        setPreviewFile(file);
    };

    const handleShare = async (file: TelegramFile) => {
        try {
            const { data } = await api.post<TelegramFile>(`/files/${file.id}/share`);
            if (activeContextMenu && activeContextMenu.type === 'file') {
                setActiveContextMenu({ ...activeContextMenu, item: data });
            }
        } catch (error) {
            console.error('Failed to share file:', error);
        }
    };

    const handleRevokeShare = async (file: TelegramFile) => {
        try {
            const { data } = await api.delete<TelegramFile>(`/files/${file.id}/share`);
            if (activeContextMenu && activeContextMenu.type === 'file') {
                setActiveContextMenu({ ...activeContextMenu, item: data });
            }
        } catch (error) {
            console.error('Failed to revoke share:', error);
        }
    };

    const ensurePublicLink = async (file: TelegramFile): Promise<string> => {
        if (file.public_stream_url) {
            return `${window.location.protocol}//${window.location.host}${file.public_stream_url}`;
        }
        try {
            const { data } = await api.post<TelegramFile>(`/files/${file.id}/share`);
            if (data.public_stream_url) {
                if (activeContextMenu && activeContextMenu.type === 'file') {
                    setActiveContextMenu({ ...activeContextMenu, item: data });
                }
                return `${window.location.protocol}//${window.location.host}${data.public_stream_url}`;
            }
        } catch (err) {
            console.error('Failed to create public link:', err);
        }
        const token = localStorage.getItem('access_token');
        const downloadUrl = `${api.defaults.baseURL}/stream/${file.id}?token=${token}`;
        return downloadUrl.startsWith('http')
            ? downloadUrl
            : `${window.location.protocol}//${window.location.host}${downloadUrl}`;
    };

    const handleDownload = async (file: TelegramFile) => {
        try {
            const url = await ensurePublicLink(file);
            const downloadUrl = url + (url.includes('?') ? '&' : '?') + 'download=1';
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = file.file_name;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } catch (err) {
            console.error('Failed to download:', err);
        }
    };

    // --- Render ---

    return (
        <>
            {/* Overlay to catch clicks outside */}
            <div
                className="fixed inset-0 z-[99998]"
                onClick={(e) => {
                    e.stopPropagation();
                    setActiveContextMenu(null);
                }}
            />

            {/* Context Menu */}
            <div
                ref={menuRef}
                dir="rtl"
                className={`fixed z-[99999] max-h-[82vh] overflow-y-auto border border-white/[0.08] bg-dark-800/95 py-1.5 text-right shadow-2xl backdrop-blur-xl ${isMobile ? 'inset-x-0 bottom-0 rounded-t-3xl px-2 pb-[calc(.5rem+env(safe-area-inset-bottom))] animate-slide-up' : 'min-w-[220px] rounded-xl animate-scale-in'}`}
                style={isMobile ? undefined : { left: position.left, top: position.top, transformOrigin: 'top left' }}
                onClick={(e) => e.stopPropagation()}
                onContextMenu={(e) => e.preventDefault()}
            >
                {activeContextMenu.type === 'file' ? (
                    // File Context Menu
                    <>
                        {isMultiSelect ? (
                            <>
                                <div className="px-3 py-2 text-xs font-medium text-dark-400 uppercase tracking-wider">
                                    {selectedFileIds.size.toLocaleString('fa-IR')} فایل انتخاب شده
                                </div>
                                <button className="context-menu-item w-full text-right" onClick={() => handleAction(() => setMoveFiles(selectedFiles))}>
                                    <FolderInput className="w-4 h-4" />
                                    جابه‌جایی فایل‌های انتخاب‌شده
                                </button>
                                <button className="context-menu-item w-full text-right text-red-400 hover:bg-red-500/10" onClick={() => handleAction(() => setDeleteConfirm({ type: 'file', items: Array.from(selectedFileIds).map(id => ({ id } as any)) }))}>
                                    <Trash2 className="w-4 h-4" />
                                    حذف فایل‌های انتخاب‌شده
                                </button>
                            </>
                        ) : (
                            <>
                                {(activeContextMenu.item.file_type === 'video' || activeContextMenu.item.file_type === 'audio') && (
                                    <><button className="context-menu-item w-full text-right" onClick={() => handleAction(() => handlePlay(activeContextMenu.item as TelegramFile))}>
                                        <Play className="w-4 h-4" />
                                        پخش
                                    </button><button className="context-menu-item w-full text-right" onClick={() => handleAction(() => setPlaylistFile(activeContextMenu.item as TelegramFile))}><ListPlus className="h-4 w-4"/> افزودن به پلی‌لیست</button></>
                                )}
                                <button className="context-menu-item w-full text-right" onClick={async () => { const file=activeContextMenu.item as TelegramFile; await updateFile.mutateAsync({id:file.id,is_favorite:!file.is_favorite}); addToast(file.is_favorite?'از نشان‌شده‌ها برداشته شد':'به نشان‌شده‌ها اضافه شد ⭐'); setActiveContextMenu(null); }}><Heart className={`h-4 w-4 ${(activeContextMenu.item as TelegramFile).is_favorite?'fill-current text-pink-400':''}`}/>{(activeContextMenu.item as TelegramFile).is_favorite?'برداشتن نشان':'نشان کردن'}</button>
                                {(activeContextMenu.item.file_type === 'image' || canPreviewText(activeContextMenu.item as TelegramFile)) && (
                                    <button className="context-menu-item w-full text-right" onClick={() => handleAction(() => setPreviewFile(activeContextMenu.item as TelegramFile))}>
                                        <Eye className="w-4 h-4" />
                                        پیش‌نمایش
                                    </button>
                                )}
                                <button
                                    className="context-menu-item w-full text-right"
                                    onClick={() => { handleDownload(activeContextMenu.item as TelegramFile); setActiveContextMenu(null); }}
                                >
                                    <Download className="w-4 h-4" />
                                    دانلود
                                </button>
                                
                                <hr className="border-white/[0.08] my-1" />

                                <button className="context-menu-item w-full text-right" onClick={async () => {
                                    const url = await ensurePublicLink(activeContextMenu.item as TelegramFile);
                                    handleCopy(url, 'stream');
                                }}>
                                    <Link className="w-4 h-4" />
                                    {copiedId === 'stream' ? '✓ کپی شد' : 'کپی پیوند پخش'}
                                </button>

                                <button className="context-menu-item w-full text-right" onClick={async () => {
                                    const url = await ensurePublicLink(activeContextMenu.item as TelegramFile);
                                    const downloadUrl = url + (url.includes('?') ? '&' : '?') + 'download=1';
                                    handleCopy(downloadUrl, 'download');
                                }}>
                                    <HardDriveDownload className="w-4 h-4" />
                                    {copiedId === 'download' ? '✓ کپی شد' : 'کپی پیوند دانلود'}
                                </button>

                                <hr className="border-white/[0.08] my-1" />

                                {(activeContextMenu.item as TelegramFile).public_stream_url ? (
                                    <>
                                        <button className="context-menu-item w-full text-right" onClick={() => handleCopy(`${window.location.protocol}//${window.location.host}${(activeContextMenu.item as TelegramFile).public_stream_url}`, 'public')}>
                                            <Globe className="w-4 h-4 text-emerald-400" />
                                            {copiedId === 'public' ? '✓ کپی شد' : 'کپی پیوند عمومی'}
                                        </button>
                                        <button className="context-menu-item w-full text-right text-orange-400 hover:bg-orange-500/10" onClick={() => handleRevokeShare(activeContextMenu.item as TelegramFile)}>
                                            <ShieldOff className="w-4 h-4" />
                                            لغو پیوند عمومی
                                        </button>
                                    </>
                                ) : (
                                    <button className="context-menu-item w-full text-right" onClick={() => handleShare(activeContextMenu.item as TelegramFile)}>
                                        <Globe className="w-4 h-4" />
                                        ساخت پیوند عمومی
                                    </button>
                                )}

                                <hr className="border-white/[0.08] my-1" />
                                
                                <button className="context-menu-item w-full text-right" onClick={() => handleAction(() => setRenameFile(activeContextMenu.item as TelegramFile))}>
                                    <Edit className="w-4 h-4" />
                                    تغییر نام
                                </button>
                                <button className="context-menu-item w-full text-right" onClick={() => handleAction(() => setDescriptionItem({ type: 'file', item: activeContextMenu.item as TelegramFile }))}>
                                    <AlignLeft className="w-4 h-4" />
                                    {(activeContextMenu.item as TelegramFile).description ? 'ویرایش توضیحات' : 'افزودن توضیحات'}
                                </button>
                                <button className="context-menu-item w-full text-right" onClick={() => handleAction(() => setMoveItems({ files: [activeContextMenu.item as TelegramFile], folders: [] }))}>
                                    <FolderInput className="w-4 h-4" />
                                    جابه‌جایی به…
                                </button>
                                
                                <hr className="border-white/[0.08] my-1" />
                                
                                <button className="context-menu-item w-full text-right text-red-400 hover:bg-red-500/10" onClick={() => handleAction(() => setDeleteConfirm({ type: 'file', items: [activeContextMenu.item] }))}>
                                    <Trash2 className="w-4 h-4" />
                                    حذف
                                </button>
                            </>
                        )}
                    </>
                ) : (
                    // Folder Context Menu
                    <>
                        <button
                            className="context-menu-item w-full text-right"
                            onClick={() => handleAction(() => setRenameFolder(activeContextMenu.item as Folder))}
                        >
                            <Edit className="w-4 h-4" />
                            تغییر نام
                        </button>
                        <button className="context-menu-item w-full text-right" onClick={() => handleAction(() => setDescriptionItem({ type: 'folder', item: activeContextMenu.item as Folder }))}>
                            <AlignLeft className="w-4 h-4" />
                            {(activeContextMenu.item as Folder).description ? 'ویرایش توضیحات' : 'افزودن توضیحات'}
                        </button>
                        <button className="context-menu-item w-full text-right" onClick={() => handleAction(() => setMoveItems({ files: [], folders: [activeContextMenu.item as Folder] }))}>
                            <FolderInput className="w-4 h-4" />
                            جابه‌جایی به…
                        </button>
                        <hr className="border-white/[0.08] my-1" />
                        <button
                            className="context-menu-item w-full text-right text-red-400 hover:bg-red-500/10"
                            onClick={() => handleAction(() => setDeleteConfirm({ type: 'folder', items: [activeContextMenu.item] }))}
                        >
                            <Trash2 className="w-4 h-4" />
                            حذف
                        </button>
                    </>
                )}
            </div>
        </>
    );
}
