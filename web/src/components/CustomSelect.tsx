import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

interface Option<T extends string | number> { value: T; label: string; }

export default function CustomSelect<T extends string | number>({ value, options, onChange, label, className = '', placement = 'bottom' }: { value: T; options: Option<T>[]; onChange: (value: T) => void; label?: string; className?: string; placement?: 'top' | 'bottom' }) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
    const selected = options.find(option => option.value === value) || options[0];
    const positionMenu = useCallback(() => {
        if (!ref.current) return;
        const rect = ref.current.getBoundingClientRect();
        const labelOffset = label ? 22 : 0;
        const triggerTop = rect.top + labelOffset;
        const triggerHeight = Math.max(44, rect.height - labelOffset);
        const spaceBelow = window.innerHeight - (triggerTop + triggerHeight) - 12;
        const openAbove = placement === 'top' || spaceBelow < 220;
        const maxHeight = Math.max(120, Math.min(224, openAbove ? triggerTop - 12 : spaceBelow));
        setMenuStyle({
            position: 'fixed',
            zIndex: 100000,
            right: Math.max(8, window.innerWidth - rect.right),
            top: openAbove ? undefined : triggerTop + triggerHeight + 8,
            bottom: openAbove ? window.innerHeight - triggerTop + 8 : undefined,
            width: Math.min(rect.width, window.innerWidth - 16),
            maxHeight,
        });
    }, [label, placement]);
    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target as Node;
            if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
        };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, []);
    useEffect(() => {
        if (!open) return;
        positionMenu();
        const update = () => positionMenu();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
    }, [open, positionMenu]);
    return <div ref={ref} className={`relative ${className}`}>
        {label && <span className="mb-1.5 block text-xs text-dark-400">{label}</span>}
        <button type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen(current => !current)} className="flex h-11 w-full items-center justify-between rounded-xl border border-white/[.08] bg-dark-800/90 px-3 text-sm text-dark-100 outline-none transition hover:border-white/15 focus:border-primary-500/50">
            <span className="truncate">{selected?.label}</span><ChevronDown className={`h-4 w-4 shrink-0 text-dark-400 transition-transform ${open ? 'rotate-180' : ''}`}/>
        </button>
        {open && createPortal(<div ref={menuRef} role="listbox" style={menuStyle} className="min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl border border-white/10 bg-dark-900/95 p-1.5 shadow-2xl backdrop-blur-xl">
            {options.map(option => <button type="button" role="option" aria-selected={option.value === value} key={String(option.value)} onClick={() => { onChange(option.value); setOpen(false); }} className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-right text-sm transition ${option.value === value ? 'bg-primary-500/15 text-primary-200' : 'text-dark-300 hover:bg-white/[.05] hover:text-white'}`}><span className="min-w-0 flex-1 truncate">{option.label}</span>{option.value === value && <Check className="h-4 w-4 shrink-0"/>}</button>)}
        </div>, document.body)}
    </div>;
}
