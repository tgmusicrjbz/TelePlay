import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { BatchFileEdit } from '../lib/api';

interface Props { open: boolean; count: number; onClose: () => void; onSave: (data: Omit<BatchFileEdit, 'ids'>) => Promise<void>; }

export default function BatchEditModal({ open, count, onClose, onSave }: Props) {
    const [descriptionMode, setDescriptionMode] = useState<'none' | 'set' | 'append' | 'clear'>('none');
    const [description, setDescription] = useState('');
    const [renameMode, setRenameMode] = useState<'none' | 'prefix' | 'suffix' | 'replace'>('none');
    const [renameValue, setRenameValue] = useState('');
    const [renameSearch, setRenameSearch] = useState('');
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        if (open) {
            setDescriptionMode('none'); setDescription(''); setRenameMode('none');
            setRenameValue(''); setRenameSearch(''); setSaving(false);
        }
    }, [open]);
    if (!open) return null;
    const valid = (descriptionMode !== 'none' || renameMode !== 'none')
        && (renameMode === 'none' || renameMode === 'replace' || renameValue.length > 0)
        && (renameMode !== 'replace' || renameSearch.length > 0);
    const submit = async () => {
        if (descriptionMode === 'none' && renameMode === 'none') return;
        setSaving(true);
        try {
            await onSave({
                ...(descriptionMode !== 'none' && { description_mode: descriptionMode, description }),
                ...(renameMode !== 'none' && { rename_mode: renameMode, rename_value: renameValue, rename_search: renameSearch }),
            });
            onClose();
        } finally { setSaving(false); }
    };
    return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={onClose}>
        <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-dark-900 p-5" onMouseDown={event => event.stopPropagation()} dir="rtl">
            <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">ویرایش گروهی</h2><p className="text-xs text-dark-400">{count} فایل انتخاب شده</p></div><button className="btn-icon" onClick={onClose}><X className="h-5 w-5" /></button></div>
            <label className="mt-5 block text-sm text-dark-300">توضیحات</label>
            <select className="mt-2 w-full rounded-xl border border-white/10 bg-dark-800 p-3" value={descriptionMode} onChange={e => setDescriptionMode(e.target.value as typeof descriptionMode)}>
                <option value="none">بدون تغییر</option><option value="set">جایگزینی</option><option value="append">افزودن به توضیحات فعلی</option><option value="clear">پاک‌کردن</option>
            </select>
            {(descriptionMode === 'set' || descriptionMode === 'append') && <textarea className="mt-2 min-h-24 w-full rounded-xl border border-white/10 bg-dark-800 p-3" maxLength={1024} value={description} onChange={e => setDescription(e.target.value)} placeholder="متن توضیحات…" />}
            <label className="mt-4 block text-sm text-dark-300">تغییر نام</label>
            <select className="mt-2 w-full rounded-xl border border-white/10 bg-dark-800 p-3" value={renameMode} onChange={e => setRenameMode(e.target.value as typeof renameMode)}>
                <option value="none">بدون تغییر</option><option value="prefix">افزودن پیشوند</option><option value="suffix">افزودن پسوند</option><option value="replace">پیدا و جایگزین</option>
            </select>
            {renameMode === 'replace' && <input className="mt-2 w-full rounded-xl border border-white/10 bg-dark-800 p-3" value={renameSearch} onChange={e => setRenameSearch(e.target.value)} placeholder="عبارت موردنظر" />}
            {renameMode !== 'none' && <input className="mt-2 w-full rounded-xl border border-white/10 bg-dark-800 p-3" value={renameValue} onChange={e => setRenameValue(e.target.value)} placeholder={renameMode === 'replace' ? 'عبارت جایگزین (می‌تواند خالی باشد)' : 'متن موردنظر'} />}
            <div className="mt-5 flex gap-2"><button className="btn-primary flex-1" disabled={saving || !valid} onClick={submit}>{saving ? 'در حال ذخیره…' : 'اعمال روی فایل‌ها'}</button><button className="btn-secondary" onClick={onClose}>لغو</button></div>
        </div>
    </div>;
}
