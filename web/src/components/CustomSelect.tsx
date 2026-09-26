import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

interface Option<T extends string | number> { value: T; label: string; }

export default function CustomSelect<T extends string | number>({ value, options, onChange, label, className = '' }: { value: T; options: Option<T>[]; onChange: (value: T) => void; label?: string; className?: string }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const selected = options.find(option => option.value === value) || options[0];
    useEffect(() => {
        const close = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) setOpen(false); };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, []);
    return <div ref={ref} className={`relative ${className}`}>
        {label && <span className="mb-1.5 block text-xs text-dark-400">{label}</span>}
        <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)} className="flex h-11 w-full items-center justify-between rounded-xl border border-white/[.08] bg-dark-800/90 px-3 text-sm text-dark-100 outline-none transition hover:border-white/15 focus:border-primary-500/50">
            <span className="truncate">{selected?.label}</span><ChevronDown className={`h-4 w-4 shrink-0 text-dark-400 transition-transform ${open ? 'rotate-180' : ''}`}/>
        </button>
        {open && <div role="listbox" className="absolute inset-x-0 top-full z-[170] mt-2 max-h-64 overflow-y-auto rounded-2xl border border-white/10 bg-dark-900/95 p-1.5 shadow-2xl backdrop-blur-xl">
            {options.map(option => <button type="button" role="option" aria-selected={option.value === value} key={String(option.value)} onClick={() => { onChange(option.value); setOpen(false); }} className={`flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-right text-sm transition ${option.value === value ? 'bg-primary-500/15 text-primary-200' : 'text-dark-300 hover:bg-white/[.05] hover:text-white'}`}><span>{option.label}</span>{option.value === value && <Check className="h-4 w-4"/>}</button>)}
        </div>}
    </div>;
}
