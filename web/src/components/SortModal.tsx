import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, ChevronUp, ListFilter, Plus, X } from 'lucide-react';
import { SortCriterion, SortField } from '../lib/api';
import ModalShell from './ModalShell';

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
    return <ModalShell title="مرتب‌سازی چندمرحله‌ای" subtitle="اولویت از بالا به پایین اعمال می‌شود." icon={<ListFilter/>} width="lg" onClose={onClose} footer={<><button className="btn-primary flex-1 sm:flex-none" onClick={() => { onApply(draft.length ? draft : [{ field: 'created', direction: 'desc' }]); onClose(); }}>اعمال</button><button className="btn-secondary flex-1 sm:flex-none" onClick={() => setDraft([{ field: 'created', direction: 'desc' }])}>حالت پیش‌فرض</button></>}>
            <div className="space-y-2">
                {draft.map((item, index) => <div key={item.field} className="flex items-center gap-2 rounded-xl border border-white/10 bg-dark-800/60 p-2">
                    <span className="w-6 text-center text-xs text-primary-300">{index + 1}</span>
                    <button className="flex min-w-0 flex-1 items-center justify-between rounded-lg px-2 py-1.5 text-right text-sm transition hover:bg-white/[.05]" title="برای تغییر جهت دوباره بزن" onClick={() => update(index, { ...item, direction: item.direction === 'asc' ? 'desc' : 'asc' })}><span>{labels[item.field]}</span><span className="text-xs text-primary-200">
                        {item.direction === 'asc' ? <><ArrowUp className="inline h-3.5 w-3.5" /> صعودی</> : <><ArrowDown className="inline h-3.5 w-3.5" /> نزولی</>}
                    </span></button>
                    <button className="btn-icon" disabled={index === 0} onClick={() => move(index, -1)}><ChevronUp className="h-4 w-4" /></button>
                    <button className="btn-icon" disabled={index === draft.length - 1} onClick={() => move(index, 1)}><ChevronDown className="h-4 w-4" /></button>
                    <button className="btn-icon text-red-300" onClick={() => setDraft(draft.filter((_, i) => i !== index))}><X className="h-4 w-4" /></button>
                </div>)}
            </div>
            {available.length > 0 && <div className="mt-4 grid grid-cols-2 gap-2">
                {available.map(field => <button key={field} className="btn-secondary flex items-center justify-center gap-2 text-xs" onClick={() => setDraft([...draft, { field, direction: 'asc' }])}><Plus className="h-4 w-4" />{labels[field]}</button>)}
            </div>}
    </ModalShell>;
}
