/**
 * DeleteConfirmModal - confirmation dialog for deleting files/folders
 */
import { Trash2 } from 'lucide-react';
import ModalShell from './ModalShell';

interface DeleteConfirmModalProps {
    type: 'file' | 'folder' | 'multiple';
    name?: string;
    count?: number;
    onConfirm: (deleteContents: boolean) => Promise<void> | void;
    onClose: () => void;
}

export default function DeleteConfirmModal({ type, name, count = 1, onConfirm, onClose }: DeleteConfirmModalProps) {
    const confirm = (deleteContents: boolean) => {
        onClose();
        void Promise.resolve(onConfirm(deleteContents));
    };
    const itemLabel = type === 'folder' ? 'کشو' : 'فایل';
    const title = count > 1 ? `حذف ${count.toLocaleString('fa-IR')} مورد` : `حذف ${itemLabel}`;
    const includesFolder = type === 'folder' || type === 'multiple';
    const message = count > 1 
        ? `از حذف این ${count.toLocaleString('fa-IR')} مورد مطمئنی؟`
        : <>از حذف <span className="inline break-all text-white font-medium">«{name}»</span> مطمئنی؟</>;

    return (
        <ModalShell title={title} icon={<Trash2/>} onClose={onClose} danger zIndex={180}>
                <div className="text-dark-300 mb-6">
                    <p className="max-w-full overflow-hidden break-words leading-7">{message}</p>
                    {includesFolder && <p className="mt-2 text-sm text-dark-400">می‌تونی فقط خود کشو را حذف کنی و محتویاتش را یک سطح بالاتر ببری، یا همه محتویات را هم پاک کنی.</p>}
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                    <button onClick={() => confirm(true)} className={`min-h-11 w-full rounded-xl bg-red-600 px-4 py-2 font-medium transition-colors hover:bg-red-500 ${includesFolder?'':'sm:col-span-2'}`}>
                        {includesFolder ? 'حذف کشو و محتویات' : 'حذف فایل'}
                    </button>
                    {includesFolder && <button onClick={() => confirm(false)} className="min-h-11 rounded-xl border border-white/10 bg-dark-800 px-4 py-2 font-medium hover:bg-dark-700">فقط حذف کشو</button>}
                    <button onClick={onClose} className="min-h-11 rounded-xl px-4 py-2 text-dark-400 transition-colors hover:bg-white/[.04] hover:text-white sm:col-span-2">بی‌خیال</button>
                </div>
        </ModalShell>
    );
}
