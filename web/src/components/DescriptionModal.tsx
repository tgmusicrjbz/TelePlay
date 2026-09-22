import { useEffect, useState } from 'react';
import { AlignLeft, X } from 'lucide-react';

interface DescriptionModalProps {
    isOpen: boolean;
    itemType: 'file' | 'folder';
    currentDescription: string;
    onClose: () => void;
    onSave: (description: string) => Promise<void>;
}

export default function DescriptionModal({ isOpen, itemType, currentDescription, onClose, onSave }: DescriptionModalProps) {
    const [description, setDescription] = useState(currentDescription);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (isOpen) {
            setDescription(currentDescription);
            setError('');
        }
    }, [isOpen, currentDescription]);

    if (!isOpen) return null;

    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        setSaving(true);
        setError('');
        try {
            await onSave(description.trim());
            onClose();
        } catch {
            setError('Could not save the description. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <form onSubmit={submit} className="glass-card w-full max-w-lg p-6 animate-slide-up">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <AlignLeft className="w-5 h-5 text-primary-400" />
                        {currentDescription ? 'Edit' : 'Add'} {itemType} description
                    </h2>
                    <button type="button" onClick={onClose} className="p-1 hover:bg-dark-700 rounded"><X className="w-5 h-5" /></button>
                </div>
                <textarea
                    value={description}
                    onChange={(event) => setDescription(event.target.value)}
                    maxLength={1024}
                    rows={7}
                    autoFocus
                    placeholder="Write a short description…"
                    className="w-full resize-y px-4 py-3 bg-dark-700 border border-dark-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-primary-500/50"
                />
                <div className="flex justify-between mt-2 text-xs text-dark-400">
                    <span>Leave empty to remove the description.</span>
                    <span>{description.length}/1024</span>
                </div>
                {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
                <div className="flex justify-end gap-3 mt-5">
                    <button type="button" onClick={onClose} className="px-4 py-2 text-dark-400 hover:text-white">Cancel</button>
                    {currentDescription && (
                        <button type="button" disabled={saving} onClick={() => setDescription('')} className="px-4 py-2 text-red-400 hover:bg-red-500/10 rounded-lg">Clear</button>
                    )}
                    <button type="submit" disabled={saving} className="px-4 py-2 bg-primary-600 hover:bg-primary-700 rounded-lg font-medium disabled:opacity-50">
                        {saving ? 'Saving…' : 'Save'}
                    </button>
                </div>
            </form>
        </div>
    );
}
