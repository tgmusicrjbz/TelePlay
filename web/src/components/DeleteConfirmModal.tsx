/**
 * DeleteConfirmModal - confirmation dialog for deleting files/folders
 */
import { X, Trash2 } from 'lucide-react';
import { useState } from 'react';

interface DeleteConfirmModalProps {
    type: 'file' | 'folder' | 'multiple';
    name?: string;
    count?: number;
    onConfirm: (deleteContents: boolean) => Promise<void>;
    onClose: () => void;
}

export default function DeleteConfirmModal({ type, name, count = 1, onConfirm, onClose }: DeleteConfirmModalProps) {
    const [isDeleting, setIsDeleting] = useState(false);
    const confirm = async (deleteContents: boolean) => {
        if (isDeleting) return;
        setIsDeleting(true);
        try { await onConfirm(deleteContents); }
        finally { setIsDeleting(false); }
    };
    const title = count > 1 ? `Delete ${count} items` : `Delete ${type}`;
    const includesFolder = type === 'folder' || type === 'multiple';
    const message = count > 1 
        ? `Are you sure you want to delete these ${count} items?`
        : <>Are you sure you want to delete <span className="text-white font-medium">"{name}"</span>?</>;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="glass-card w-full max-w-sm p-6 animate-slide-up">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2 text-red-400">
                        <Trash2 className="w-5 h-5" />
                        {title}
                    </h2>
                    <button onClick={onClose} disabled={isDeleting} className="p-1 hover:bg-dark-700 rounded disabled:opacity-50">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="text-dark-300 mb-6">
                    <p>{message}</p>
                    {includesFolder && <p className="mt-2 text-sm text-dark-400">Keep contents moves files and subfolders up one level. Delete everything also removes their contents.</p>}
                </div>

                <div className="flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={isDeleting}
                        className="px-4 py-2 text-dark-400 hover:text-white transition-colors"
                    >
                        Cancel
                    </button>
                    {includesFolder && <button onClick={() => confirm(false)} disabled={isDeleting} className="px-4 py-2 bg-dark-700 hover:bg-dark-600 rounded-lg font-medium disabled:opacity-50">Keep contents</button>}
                    <button onClick={() => confirm(true)} disabled={isDeleting} className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg font-medium transition-colors disabled:opacity-50">
                        {isDeleting ? 'Deleting...' : includesFolder ? 'Delete everything' : 'Delete file'}
                    </button>
                </div>
            </div>
        </div>
    );
}
