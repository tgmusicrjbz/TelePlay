import { useEffect, type ReactNode } from 'react';
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
    useEffect(() => {
        const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
        document.addEventListener('keydown', close);
        return () => document.removeEventListener('keydown', close);
    }, [onClose]);

    const modal = (
        <div className="modal-backdrop fixed inset-0 flex items-end justify-center sm:items-center sm:p-4" style={{ zIndex }} onMouseDown={onClose}>
            <section dir="rtl" role="dialog" aria-modal="true" className={`modal-surface flex max-h-[92dvh] w-full ${widths[width]} flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl`} onMouseDown={event => event.stopPropagation()}>
                {danger && <div className="h-1 shrink-0 bg-gradient-to-l from-red-400 via-red-500 to-orange-400" />}
                <header className="flex shrink-0 items-center gap-3 border-b border-white/[.07] px-4 py-3.5 sm:px-5">
                    {icon && <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${danger ? 'bg-red-500/10 text-red-300' : 'bg-primary-500/10 text-primary-300'} [&>svg]:h-5 [&>svg]:w-5`}>{icon}</span>}
                    <span className="min-w-0 flex-1"><strong className={`block truncate text-base ${danger ? 'text-red-300' : 'text-white'}`}>{title}</strong>{subtitle && <small className="mt-1 block truncate text-xs text-dark-500">{subtitle}</small>}</span>
                    <button type="button" className="btn-icon h-9 w-9 shrink-0" onClick={onClose} aria-label="بستن پنجره"><X className="h-4 w-4" /></button>
                </header>
                <div className={`min-h-0 flex-1 overflow-y-auto p-4 sm:p-5 ${bodyClassName}`}>{children}</div>
                {footer && <footer className="grid shrink-0 gap-2 border-t border-white/[.07] p-3 sm:flex sm:justify-end sm:px-5">{footer}</footer>}
            </section>
        </div>
    );
    return createPortal(modal, document.fullscreenElement || document.body);
}
