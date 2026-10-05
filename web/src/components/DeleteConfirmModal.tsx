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
    const itemLabel = type === 'folder' ? 'کشو' : 'فایل';
    const title = count > 1 ? `حذف ${count.toLocaleString('fa-IR')} مورد` : `حذف ${itemLabel}`;
    const includesFolder = type === 'folder' || type === 'multiple';
    const message = count > 1 
        ? `از حذف این ${count.toLocaleString('fa-IR')} مورد مطمئنی؟`
        : <>از حذف <span className="inline break-all text-white font-medium">«{name}»</span> مطمئنی؟</>;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div dir="rtl" className="w-full max-w-md overflow-hidden rounded-3xl border border-white/10 bg-dark-900 shadow-2xl animate-slide-up">
                <div className="h-1 bg-gradient-to-l from-red-400 via-red-500 to-orange-400"/>
                <div className="p-5 sm:p-6">
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
                    <p className="max-w-full overflow-hidden break-words leading-7">{message}</p>
                    {includesFolder && <p className="mt-2 text-sm text-dark-400">می‌تونی فقط خود کشو را حذف کنی و محتویاتش را یک سطح بالاتر ببری، یا همه محتویات را هم پاک کنی.</p>}
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                    <button onClick={() => confirm(true)} disabled={isDeleting} className="min-h-11 rounded-xl bg-red-600 px-4 py-2 font-medium transition-colors hover:bg-red-500 disabled:opacity-50">
                        {isDeleting ? 'در حال حذف…' : includesFolder ? 'حذف کشو و محتویات' : 'حذف فایل'}
                    </button>
                    {includesFolder && <button onClick={() => confirm(false)} disabled={isDeleting} className="min-h-11 rounded-xl border border-white/10 bg-dark-800 px-4 py-2 font-medium hover:bg-dark-700 disabled:opacity-50">فقط حذف کشو</button>}
                    <button onClick={onClose} disabled={isDeleting} className="min-h-11 rounded-xl px-4 py-2 text-dark-400 transition-colors hover:bg-white/[.04] hover:text-white sm:col-span-2">بی‌خیال</button>
                </div>
                </div>
            </div>
        </div>
    );
}
