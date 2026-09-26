import { useCallback, useEffect, useState } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { useAppStore } from '../lib/store';

export default function Toasts() {
    const { toasts, removeToast } = useAppStore();

    return (
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+168px)] right-4 z-[160] flex flex-col gap-2 pointer-events-none md:bottom-[calc(env(safe-area-inset-bottom)+88px)]">
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
        const timer = setTimeout(dismiss, 2800);

        return () => clearTimeout(timer);
    }, [dismiss]);

    const getIcon = () => {
        switch (toast.type) {
            case 'success': return <CheckCircle className="w-5 h-5 text-green-400" />;
            case 'error': return <AlertCircle className="w-5 h-5 text-red-400" />;
            default: return <Info className="w-5 h-5 text-blue-400" />;
        }
    };

    const getBgColor = () => {
         switch (toast.type) {
            case 'success': return 'border-green-500/20 bg-dark-900/90 shadow-green-900/10';
            case 'error': return 'border-red-500/20 bg-dark-900/90 shadow-red-900/10';
            default: return 'border-blue-500/20 bg-dark-900/90 shadow-blue-900/10';
        }
    };

    return (
        <div className={`pointer-events-auto flex items-center gap-3 pl-4 pr-3 py-3 rounded-xl border shadow-xl backdrop-blur-md sm:min-w-[300px] max-w-md transition-all duration-200 ease-out ${leaving ? 'translate-y-2 opacity-0 scale-[.98]' : 'animate-slide-up opacity-100'} ${getBgColor()}`}>
            {getIcon()}
            <p className="flex-1 text-sm font-medium text-white">{toast.message}</p>
            <button 
                onClick={dismiss}
                className="p-1 rounded-lg hover:bg-white/10 text-dark-400 hover:text-white transition-colors"
            >
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}
