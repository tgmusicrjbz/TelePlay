import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, Plus, X } from 'lucide-react';
import { SortCriterion, SortField } from '../lib/api';

const labels: Record<SortField, string> = {
    name: 'نام', type: 'نوع', size: 'حجم', duration: 'مدت',
    created: 'تاریخ آپلود', updated: 'تاریخ ویرایش', count: 'تعداد فایل‌های کشو',
};

interface Props {
    open: boolean;
    criteria: SortCriterion[];
    onApply: (criteria: SortCriterion[]) => void;
    onClose: () => void;
}

export default function SortModal({ open, criteria, onApply, onClose }: Props) {
    const [draft, setDraft] = useState<SortCriterion[]>(criteria);
    useEffect(() => { if (open) setDraft(criteria); }, [open, criteria]);
    if (!open) return null;
    const available = (Object.keys(labels) as SortField[]).filter(field => !draft.some(item => item.field === field));
    const update = (index: number, next: SortCriterion) => setDraft(draft.map((item, i) => i === index ? next : item));
    const move = (index: number, offset: number) => {
        const target = index + offset;
        if (target < 0 || target >= draft.length) return;
        const next = [...draft];
        [next[index], next[target]] = [next[target], next[index]];
        setDraft(next);
    };
    return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={onClose}>
        <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-dark-900 p-5 shadow-2xl" onMouseDown={event => event.stopPropagation()} dir="rtl">
            <div className="mb-5 flex items-center justify-between">
                <div><h2 className="text-lg font-bold">مرتب‌سازی چندمرحله‌ای</h2><p className="mt-1 text-xs text-dark-400">اولویت از بالا به پایین اعمال می‌شود.</p></div>
                <button className="btn-icon" onClick={onClose}><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-2">
                {draft.map((item, index) => <div key={item.field} className="flex items-center gap-2 rounded-xl border border-white/10 bg-dark-800/60 p-2">
                    <span className="w-6 text-center text-xs text-primary-300">{index + 1}</span>
                    <span className="min-w-0 flex-1 text-sm">{labels[item.field]}</span>
                    <button className="btn-secondary px-2 py-1 text-xs" onClick={() => update(index, { ...item, direction: item.direction === 'asc' ? 'desc' : 'asc' })}>
                        {item.direction === 'asc' ? <><ArrowUp className="inline h-3.5 w-3.5" /> صعودی</> : <><ArrowDown className="inline h-3.5 w-3.5" /> نزولی</>}
                    </button>
                    <button className="btn-icon" disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp className="h-4 w-4" /></button>
                    <button className="btn-icon" disabled={index === draft.length - 1} onClick={() => move(index, 1)}><ChevronDown className="h-4 w-4" /></button>
                    <button className="btn-icon text-red-300" onClick={() => setDraft(draft.filter((_, i) => i !== index))}><X className="h-4 w-4" /></button>
                </div>)}
            </div>
            {available.length > 0 && <div className="mt-4 grid grid-cols-2 gap-2">
                {available.map(field => <button key={field} className="btn-secondary flex items-center justify-center gap-2 text-xs" onClick={() => setDraft([...draft, { field, direction: 'asc' }])}><Plus className="h-4 w-4" />{labels[field]}</button>)}
            </div>}
            <div className="mt-5 flex gap-2">
                <button className="btn-primary flex-1" onClick={() => { onApply(draft.length ? draft : [{ field: 'created', direction: 'desc' }]); onClose(); }}>اعمال</button>
                <button className="btn-secondary" onClick={() => setDraft([{ field: 'created', direction: 'desc' }])}>حالت پیش‌فرض</button>
            </div>
        </div>
    </div>;
}
