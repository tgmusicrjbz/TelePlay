import { useCallback, useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { useAppStore } from '../lib/store';

export default function Toasts() {
    const { toasts, removeToast, isPlayerMinimized, previewFile } = useAppStore();
    const playerVisible = isPlayerMinimized && previewFile && (previewFile.file_type === 'audio' || previewFile.file_type === 'video');

    return (
        <div className={`pointer-events-none fixed inset-x-3 top-[calc(env(safe-area-inset-top)+.75rem)] z-[320] mx-auto flex max-w-md flex-col gap-2 md:inset-x-auto md:left-5 md:top-auto md:w-[22rem] ${playerVisible ? 'md:bottom-24' : 'md:bottom-5'}`}>
            {toasts.map((toast) => (
                <ToastItem key={toast.id} toast={toast} onDismiss={() => removeToast(toast.id)} />
            ))}
        </div>
    );
}

function ToastItem({ toast, onDismiss }: { toast: { id: string; message: string; type: 'success' | 'error' | 'info' }; onDismiss: () => void }) {
    const [leaving, setLeaving] = useState(false);
    const dismiss = useCallback(() => {
        setLeaving(true);
        setTimeout(onDismiss, 180);
    }, [onDismiss]);
    useEffect(() => {
        const timer = setTimeout(dismiss, toast.type === 'error' ? 4800 : toast.type === 'info' ? 2800 : 2300);

        return () => clearTimeout(timer);
    }, [dismiss]);

    const getIcon = () => {
        switch (toast.type) {
            case 'success': return <CheckCircle className="h-4 w-4 text-emerald-300" />;
            case 'error': return <AlertCircle className="h-4 w-4 text-red-300" />;
            default: return <Info className="h-4 w-4 text-sky-300" />;
        }
    };

    const getBgColor = () => {
         switch (toast.type) {
            case 'success': return 'border-emerald-400/20 bg-dark-900/95';
            case 'error': return 'border-red-400/25 bg-dark-900/95';
            default: return 'border-sky-400/20 bg-dark-900/95';
        }
    };

    return (
        <div dir="rtl" className={`pointer-events-auto flex min-h-12 items-center gap-2.5 rounded-2xl border px-3 py-2.5 shadow-2xl shadow-black/25 backdrop-blur-xl transition-all duration-200 ease-out ${leaving ? '-translate-y-2 opacity-0 scale-[.98] md:translate-y-2' : 'animate-slide-up opacity-100'} ${getBgColor()}`}>
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[.05]">{getIcon()}</span>
            <p className="min-w-0 flex-1 text-right text-xs font-medium leading-6 text-dark-100">{toast.message}</p>
            <button 
                onClick={dismiss}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-dark-500 transition-colors hover:bg-white/[.06] hover:text-white"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
