/**
 * RenameModal - Modal for renaming files and folders
 */
import { useState, useEffect, useRef } from 'react';
import { Pencil } from 'lucide-react';
import ModalShell from './ModalShell';

interface RenameModalProps {
    isOpen: boolean;
    onClose: () => void;
    onRename: (newName: string) => Promise<void>;
    currentName: string;
    itemType: 'file' | 'folder';
}

export default function RenameModal({ isOpen, onClose, onRename, currentName, itemType }: RenameModalProps) {
    const [name, setName] = useState(currentName);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (isOpen) {
            setName(currentName);
            setError('');
            setTimeout(() => {
                if (inputRef.current) {
                    inputRef.current.focus();
                    // Select filename without extension for files
                    if (itemType === 'file') {
                        const lastDot = currentName.lastIndexOf('.');
                        if (lastDot > 0) {
                            inputRef.current.setSelectionRange(0, lastDot);
                        } else {
                            inputRef.current.select();
                        }
                    } else {
                        inputRef.current.select();
                    }
                }
            }, 50);
        }
    }, [isOpen, currentName, itemType]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim() || name.trim() === currentName) return;
        setIsSaving(true);
        setError('');
        try {
            await onRename(name.trim());
            onClose();
        } catch {
            setError('نام مورد تغییر نکرد. دوباره تلاش کن.');
        } finally {
            setIsSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <ModalShell title={`تغییر نام ${itemType === 'file' ? 'فایل' : 'کشو'}`} icon={<Pencil/>} onClose={onClose} zIndex={180}>
                <form onSubmit={handleSubmit}>
                    <input
                        ref={inputRef}
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        maxLength={255}
                        className="input w-full"
                        placeholder={`نام ${itemType === 'file' ? 'فایل' : 'کشو'} را بنویس`}
                    />
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
                            disabled={isSaving || !name.trim() || name.trim() === currentName}
                            className="btn-primary disabled:opacity-50"
                        >
                            {isSaving ? 'در حال ذخیره…' : 'تغییر نام'}
                        </button>
                    </div>
                </form>
        </ModalShell>
    );
}
