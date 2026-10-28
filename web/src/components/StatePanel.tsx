import type { ReactNode } from 'react';
import { Loader2 } from 'lucide-react';

type EmptyStateProps = {
    icon: ReactNode;
    title: string;
    description?: string;
    action?: ReactNode;
    className?: string;
};

export function EmptyState({ icon, title, description, action, className = '' }: EmptyStateProps) {
    return (
        <div className={`col-span-full flex min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed border-white/[.10] bg-gradient-to-b from-white/[.035] to-transparent px-6 py-12 text-center ${className}`}>
            <span className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[.08] bg-dark-800/80 text-primary-300 shadow-lg shadow-black/15 [&>svg]:h-7 [&>svg]:w-7">
                {icon}
            </span>
            <h2 className="mt-5 text-lg font-bold text-white">{title}</h2>
            {description && <p className="mt-2 max-w-sm text-sm leading-6 text-dark-400">{description}</p>}
            {action && <div className="mt-5">{action}</div>}
        </div>
    );
}

export function LoadingState({ label = 'در حال بارگذاری…', className = '' }: { label?: string; className?: string }) {
    return (
        <div className={`flex min-h-52 w-full flex-col items-center justify-center rounded-3xl border border-white/[.07] bg-dark-900/45 px-6 text-center ${className}`} role="status" aria-live="polite">
            <span className="relative flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-500/10 text-primary-300">
                <Loader2 className="relative h-6 w-6 animate-spin motion-reduce:animate-none" />
            </span>
            <span className="mt-4 text-sm font-medium text-dark-300">{label}</span>
        </div>
    );
}
