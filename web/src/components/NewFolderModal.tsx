/**
 * NewFolderModal - modal for creating a new folder
 */
import { useState } from 'react';
import { FolderPlus } from 'lucide-react';
import { useCreateFolder } from '../lib/api';
import ModalShell from './ModalShell';

interface NewFolderModalProps {
    parentId: number | null;
    onClose: () => void;
}

export default function NewFolderModal({ parentId, onClose }: NewFolderModalProps) {
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [error, setError] = useState('');
    const createFolder = useCreateFolder();

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return;

        setError('');
        try {
            await createFolder.mutateAsync({ name: name.trim(), description: description.trim(), parent_id: parentId });
            onClose();
        } catch {
            setError('کشوی تازه ساخته نشد. نام را بررسی کن و دوباره تلاش کن.');
        }
    };

    return (
        <ModalShell title="ساخت کشوی تازه" icon={<FolderPlus/>} onClose={onClose} zIndex={180}>
                <form onSubmit={handleSubmit}>
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={255}
                        placeholder="نام کشو"
                        autoFocus
                        className="input mb-3 w-full"
                    />
                    <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        maxLength={1024}
                        rows={4}
                        placeholder="توضیحات کشو (اختیاری)"
                        className="input min-h-28 w-full resize-y"
                    />
                    <div className="mt-1 text-left text-xs text-dark-500">{description.length.toLocaleString('fa-IR')} / ۱٬۰۲۴</div>
                    {error && <p className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300" role="alert">{error}</p>}

                    <div className="mt-5 grid grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn-secondary"
                        >
                            لغو
                        </button>
                        <button
                            type="submit"
                            disabled={!name.trim() || createFolder.isPending}
                            className="btn-primary disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {createFolder.isPending ? 'در حال ساخت…' : 'ساخت کشو'}
                        </button>
                    </div>
                </form>
        </ModalShell>
    );
}
