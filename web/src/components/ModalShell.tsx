import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type ModalShellProps = {
    title: ReactNode;
    children: ReactNode;
    onClose: () => void;
    icon?: ReactNode;
    subtitle?: ReactNode;
    footer?: ReactNode;
    width?: 'sm' | 'md' | 'lg' | 'xl';
    danger?: boolean;
    bodyClassName?: string;
    zIndex?: number;
};

const widths = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-lg', xl: 'max-w-4xl' };

export default function ModalShell({ title, children, onClose, icon, subtitle, footer, width = 'md', danger = false, bodyClassName = '', zIndex = 180 }: ModalShellProps) {
    const dialogRef = useRef<HTMLElement>(null);
    const closeRef = useRef(onClose);
    const titleId = useId();
    useEffect(() => { closeRef.current = onClose; }, [onClose]);
    useEffect(() => {
        const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const dialog = dialogRef.current;
        const focusableSelector = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
        const focusFirst = () => (dialog?.querySelector<HTMLElement>('[autofocus]') || dialog?.querySelector<HTMLElement>(focusableSelector) || dialog)?.focus();
        const frame = window.requestAnimationFrame(focusFirst);
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return; }
            if (event.key !== 'Tab' || !dialog) return;
            const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector)).filter(element => element.offsetParent !== null);
            if (!focusable.length) { event.preventDefault(); dialog.focus(); return; }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        };
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            window.cancelAnimationFrame(frame);
            document.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
            previouslyFocused?.focus({ preventScroll: true });
        };
    }, []);

    const modal = (
        <div className="modal-backdrop fixed inset-0 flex items-end justify-center sm:items-center sm:p-4" style={{ zIndex }} onMouseDown={onClose}>
            <section ref={dialogRef} tabIndex={-1} dir="rtl" role="dialog" aria-modal="true" aria-labelledby={titleId} className={`modal-surface flex max-h-[92dvh] w-full ${widths[width]} flex-col overflow-hidden rounded-t-3xl outline-none sm:rounded-3xl`} onMouseDown={event => event.stopPropagation()}>
                {danger && <div className="h-1 shrink-0 bg-gradient-to-l from-red-400 via-red-500 to-orange-400" />}
                <header className="flex shrink-0 items-center gap-3 border-b border-white/[.07] px-4 py-3.5 sm:px-5">
                    {icon && <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${danger ? 'bg-red-500/10 text-red-300' : 'bg-primary-500/10 text-primary-300'} [&>svg]:h-5 [&>svg]:w-5`}>{icon}</span>}
                    <span className="min-w-0 flex-1"><strong id={titleId} className={`block truncate text-base ${danger ? 'text-red-300' : 'text-white'}`}>{title}</strong>{subtitle && <small className="mt-1 block truncate text-xs text-dark-400">{subtitle}</small>}</span>
                    <button type="button" className="btn-icon h-9 w-9 shrink-0" onClick={onClose} aria-label="بستن پنجره"><X className="h-4 w-4" /></button>
                </header>
                <div className={`min-h-0 flex-1 overflow-y-auto p-4 sm:p-5 ${bodyClassName}`}>{children}</div>
                {footer && <footer className="grid shrink-0 gap-2 border-t border-white/[.07] p-3 sm:flex sm:justify-end sm:px-5">{footer}</footer>}
            </section>
        </div>
    );
    return createPortal(modal, document.fullscreenElement || document.body);
}
