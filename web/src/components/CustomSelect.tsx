import { useCallback, useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown } from 'lucide-react';

interface Option<T extends string | number> { value: T; label: string; color?: string; }

export default function CustomSelect<T extends string | number>({ value, options, onChange, label, className = '', placement = 'bottom' }: { value: T; options: Option<T>[]; onChange: (value: T) => void; label?: string; className?: string; placement?: 'top' | 'bottom' }) {
    const [open, setOpen] = useState(false);
    const listboxId = useId();
    const [highlighted, setHighlighted] = useState(() => Math.max(0, options.findIndex(option => option.value === value)));
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
        if (!open) return;
        const close = (event: PointerEvent) => {
            const target = event.target as Node;
            if (!ref.current?.contains(target) && !menuRef.current?.contains(target)) setOpen(false);
        };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, [open]);
    useEffect(() => {
        if (!open) return;
        positionMenu();
        const update = () => positionMenu();
        window.addEventListener('resize', update);
        window.addEventListener('scroll', update, true);
        return () => { window.removeEventListener('resize', update); window.removeEventListener('scroll', update, true); };
    }, [open, positionMenu]);
    const openMenu = () => { setHighlighted(Math.max(0, options.findIndex(option => option.value === value))); setOpen(true); };
    const choose = (index: number) => { const option = options[index]; if (!option) return; onChange(option.value); setOpen(false); };
    const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
        if (event.key === 'Escape') { setOpen(false); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            if (!options.length) return;
            if (!open) { openMenu(); return; }
            const direction = event.key === 'ArrowDown' ? 1 : -1;
            setHighlighted(current => (current + direction + options.length) % options.length);
        }
        if ((event.key === 'Enter' || event.key === ' ') && open) { event.preventDefault(); choose(highlighted); }
    };
    return <div ref={ref} className={`relative ${className}`}>
        {label && <span className="mb-1.5 block text-xs text-dark-400">{label}</span>}
        <button type="button" dir="rtl" aria-haspopup="listbox" aria-expanded={open} aria-controls={listboxId} aria-activedescendant={open&&options[highlighted]?`${listboxId}-${highlighted}`:undefined} onKeyDown={handleKeyDown} onClick={() => open ? setOpen(false) : openMenu()} className="select-trigger flex h-11 w-full items-center justify-between rounded-xl px-3 text-sm text-dark-100 outline-none transition-colors hover:border-white/15 focus:border-primary-500/50 focus:ring-2 focus:ring-primary-500/20">
            <span className="flex min-w-0 items-center gap-2">{selected?.color&&<span className="h-4 w-4 shrink-0 rounded-full border border-white/20" style={{backgroundColor:selected.color}}/>}<span className="truncate">{selected?.label}</span></span><ChevronDown className={`h-4 w-4 shrink-0 text-dark-400 transition-transform ${open ? 'rotate-180' : ''}`}/>
        </button>
        {open && createPortal(<div id={listboxId} ref={menuRef} dir="rtl" role="listbox" style={menuStyle} className="select-popover min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain rounded-2xl p-1.5">
            {options.map((option,index) => <button id={`${listboxId}-${index}`} type="button" role="option" aria-selected={option.value === value} key={String(option.value)} onPointerMove={()=>setHighlighted(index)} onClick={() => choose(index)} className={`flex w-full min-w-0 items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-right text-sm transition-colors ${option.value === value ? 'bg-primary-500/15 text-primary-200' : highlighted===index?'bg-white/[.06] text-white':'text-dark-300'}`}><span className="flex min-w-0 flex-1 items-center gap-2">{option.color&&<span className="h-4 w-4 shrink-0 rounded-full border border-white/20" style={{backgroundColor:option.color}}/>}<span className="truncate">{option.label}</span></span>{option.value === value && <Check className="h-4 w-4 shrink-0"/>}</button>)}
        </div>, document.fullscreenElement || document.body)}
    </div>;
}
