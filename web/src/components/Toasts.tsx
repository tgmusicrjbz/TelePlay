import { useCallback, useEffect, useRef, useState } from 'react';
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
    const [dragX, setDragX] = useState(0);
    const dragRef = useRef<{ pointerId: number; startX: number; startedAt: number } | null>(null);
    const dismissRef = useRef(onDismiss);
    const dismissedRef = useRef(false);
    useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);
    const dismiss = useCallback(() => {
        if (dismissedRef.current) return;
        dismissedRef.current = true;
        setLeaving(true);
        setTimeout(() => dismissRef.current(), 180);
    }, []);
    useEffect(() => {
        const timer = setTimeout(dismiss, toast.type === 'error' ? 4800 : toast.type === 'info' ? 2800 : 2300);

        return () => clearTimeout(timer);
    }, [dismiss, toast.id, toast.type]);

    const getIcon = () => {
        switch (toast.type) {
            case 'success': return <CheckCircle className="h-4 w-4 text-emerald-300" />;
            case 'error': return <AlertCircle className="h-4 w-4 text-red-300" />;
            default: return <Info className="h-4 w-4 text-sky-300" />;
        }
    };

    const tone = toast.type === 'success' ? 'border-emerald-400/25' : toast.type === 'error' ? 'border-red-400/30' : 'border-sky-400/25';
    const bar = toast.type === 'success' ? 'bg-emerald-400' : toast.type === 'error' ? 'bg-red-400' : 'bg-sky-400';
    const startSwipe = (event: React.PointerEvent<HTMLDivElement>) => {
        if ((event.target as HTMLElement).closest('button')) return;
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startedAt: performance.now() };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const moveSwipe = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        setDragX(event.clientX - drag.startX);
    };
    const finishSwipe = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        const elapsed = Math.max(1, performance.now() - drag.startedAt);
        const velocity = Math.abs(dragX) / elapsed;
        if (Math.abs(dragX) >= 72 || (Math.abs(dragX) >= 28 && velocity > .45)) dismiss();
        else setDragX(0);
    };

    return (
        <div dir="rtl" role={toast.type === 'error' ? 'alert' : 'status'} onPointerDown={startSwipe} onPointerMove={moveSwipe} onPointerUp={finishSwipe} onPointerCancel={finishSwipe} style={{ touchAction: 'pan-y', transform: leaving ? undefined : `translateX(${dragX}px)`, opacity: leaving ? undefined : Math.max(.2, 1 - Math.abs(dragX) / 240), transition: dragRef.current ? 'none' : 'transform 180ms ease, opacity 180ms ease' }} className={`app-toast pointer-events-auto relative flex min-h-14 select-none items-center gap-2.5 overflow-hidden rounded-2xl border px-3 py-2.5 ${tone} ${leaving ? '-translate-y-2 opacity-0 md:translate-y-2' : dragX === 0 ? 'animate-slide-up opacity-100' : ''}`}>
            <span className={`absolute inset-y-2 right-0 w-0.5 rounded-full ${bar}`} />
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-white/[.05]">{getIcon()}</span>
            <p className="min-w-0 flex-1 text-right text-xs font-medium leading-6 text-dark-100">{toast.message}</p>
            <button 
                onClick={dismiss}
                aria-label="بستن اعلان"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-dark-500 transition-colors hover:bg-white/[.06] hover:text-white"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </div>
    );
}
