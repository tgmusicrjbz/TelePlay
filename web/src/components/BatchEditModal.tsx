import { useEffect, useState } from 'react';
import { Tags, X } from 'lucide-react';
import { BatchFileEdit } from '../lib/api';
import CustomSelect from './CustomSelect';
import { getTagPresets } from './TagChips';

interface Props { open: boolean; count: number; onClose: () => void; onSave: (data: Omit<BatchFileEdit, 'ids'>) => Promise<void>; }

export default function BatchEditModal({ open, count, onClose, onSave }: Props) {
    const [descriptionMode, setDescriptionMode] = useState<'none' | 'set' | 'append' | 'clear'>('none');
    const [description, setDescription] = useState('');
    const [renameMode, setRenameMode] = useState<'none' | 'prefix' | 'suffix' | 'replace'>('none');
    const [renameValue, setRenameValue] = useState('');
    const [renameSearch, setRenameSearch] = useState('');
    const [tagsMode, setTagsMode] = useState<'none' | 'add' | 'remove' | 'replace'>('none');
    const [tagsText, setTagsText] = useState('');
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        if (open) {
            setDescriptionMode('none'); setDescription(''); setRenameMode('none');
            setRenameValue(''); setRenameSearch(''); setTagsMode('none'); setTagsText(''); setSaving(false);
        }
    }, [open]);
    if (!open) return null;
    const valid = (descriptionMode !== 'none' || renameMode !== 'none' || tagsMode !== 'none')
        && (renameMode === 'none' || renameMode === 'replace' || renameValue.length > 0)
        && (renameMode !== 'replace' || renameSearch.length > 0)
        && (tagsMode === 'none' || tagsMode === 'replace' || tagsText.trim().length > 0);
    const submit = async () => {
        if (descriptionMode === 'none' && renameMode === 'none' && tagsMode === 'none') return;
        setSaving(true);
        try {
            const tags = tagsText.split(/[،,\n]+/).map(tag => tag.trim()).filter(Boolean);
            await onSave({
                ...(descriptionMode !== 'none' && { description_mode: descriptionMode, description }),
                ...(renameMode !== 'none' && { rename_mode: renameMode, rename_value: renameValue, rename_search: renameSearch }),
                ...(tagsMode === 'add' && { tags_add: tags }),
                ...(tagsMode === 'remove' && { tags_remove: tags }),
                ...(tagsMode === 'replace' && { tags_replace: tags }),
            });
            onClose();
        } finally { setSaving(false); }
    };
    return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={onClose}>
        <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-dark-900 p-5" onMouseDown={event => event.stopPropagation()} dir="rtl">
            <div className="flex items-center justify-between"><div><h2 className="text-lg font-bold">ویرایش گروهی</h2><p className="text-xs text-dark-400">{count} فایل انتخاب شده</p></div><button className="btn-icon" onClick={onClose}><X className="h-5 w-5" /></button></div>
            <label className="mt-5 block text-sm text-dark-300">توضیحات</label>
            <CustomSelect className="mt-2" value={descriptionMode} onChange={setDescriptionMode} options={[{value:'none',label:'بدون تغییر'},{value:'set',label:'جایگزینی'},{value:'append',label:'افزودن به توضیحات فعلی'},{value:'clear',label:'پاک‌کردن'}]}/>
            {(descriptionMode === 'set' || descriptionMode === 'append') && <textarea className="mt-2 min-h-24 w-full rounded-xl border border-white/10 bg-dark-800 p-3" maxLength={1024} value={description} onChange={e => setDescription(e.target.value)} placeholder="متن توضیحات…" />}
            <label className="mt-4 block text-sm text-dark-300">تغییر نام</label>
            <CustomSelect className="mt-2" value={renameMode} onChange={setRenameMode} options={[{value:'none',label:'بدون تغییر'},{value:'prefix',label:'افزودن پیشوند'},{value:'suffix',label:'افزودن پسوند'},{value:'replace',label:'پیدا و جایگزین'}]}/>
            {renameMode === 'replace' && <input className="mt-2 w-full rounded-xl border border-white/10 bg-dark-800 p-3" value={renameSearch} onChange={e => setRenameSearch(e.target.value)} placeholder="عبارت موردنظر" />}
            {renameMode !== 'none' && <input className="mt-2 w-full rounded-xl border border-white/10 bg-dark-800 p-3" value={renameValue} onChange={e => setRenameValue(e.target.value)} placeholder={renameMode === 'replace' ? 'عبارت جایگزین (می‌تواند خالی باشد)' : 'متن موردنظر'} />}
            <div className="mt-4 rounded-2xl border border-primary-500/15 bg-primary-500/[.04] p-3"><label className="flex items-center gap-2 text-sm font-semibold text-primary-200"><Tags className="h-4 w-4"/> تغییر دسته‌ای تگ‌ها</label>
            <CustomSelect className="mt-2" value={tagsMode} onChange={setTagsMode} options={[{value:'none',label:'بدون تغییر'},{value:'add',label:'افزودن تگ به همه'},{value:'remove',label:'حذف تگ از همه'},{value:'replace',label:'جایگزینی تگ‌های همه فایل‌ها'}]}/>
            {tagsMode !== 'none' && <><input className="mt-2 w-full rounded-xl border border-white/10 bg-dark-800 p-3" value={tagsText} onChange={e => setTagsText(e.target.value)} placeholder={tagsMode === 'replace' ? 'تگ‌های جدید؛ برای پاک‌کردن همه، خالی بگذار' : 'تگ‌ها را وارد کن'} /><div className="mt-2 flex flex-wrap gap-1">{getTagPresets().map(tag=><button type="button" key={tag} onClick={()=>{const current=tagsText.split(/[،,\n]+/).map(item=>item.trim()).filter(Boolean);if(!current.includes(tag))setTagsText([...current,tag].join('، '));}} className="rounded-full border border-white/[.08] px-2.5 py-1 text-[10px] text-dark-300 hover:text-primary-200">+ {tag}</button>)}</div><p className="mt-1 text-[10px] text-dark-500">چند تگ را با ویرگول از هم جدا کن.</p></>}</div>
            <div className="mt-5 flex gap-2"><button className="btn-primary flex-1" disabled={saving || !valid} onClick={submit}>{saving ? 'در حال ذخیره…' : 'اعمال روی فایل‌ها'}</button><button className="btn-secondary" onClick={onClose}>لغو</button></div>
        </div>
    </div>;
}
