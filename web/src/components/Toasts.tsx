import { useCallback, useEffect, useRef, useState } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { useAppStore } from '../lib/store';

export default function Toasts() {
    const toasts = useAppStore(state=>state.toasts);
    const removeToast = useAppStore(state=>state.removeToast);
    const isPlayerMinimized = useAppStore(state=>state.isPlayerMinimized);
    const previewFile = useAppStore(state=>state.previewFile);
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
    const [paused, setPaused] = useState(false);
    const [dragX, setDragX] = useState(0);
    const duration = toast.type === 'error' ? 4800 : toast.type === 'info' ? 2800 : 2300;
    const dragRef = useRef<{ pointerId: number; startX: number; startedAt: number; currentX: number } | null>(null);
    const dismissRef = useRef(onDismiss);
    const dismissedRef = useRef(false);
    const timerRef = useRef<number | null>(null);
    const timerStartedAtRef = useRef(0);
    const remainingRef = useRef(duration);
    const pauseReasonsRef = useRef(new Set<string>());
    useEffect(() => { dismissRef.current = onDismiss; }, [onDismiss]);
    const dismiss = useCallback(() => {
        if (dismissedRef.current) return;
        dismissedRef.current = true;
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        setLeaving(true);
        setTimeout(() => dismissRef.current(), 180);
    }, []);
    const scheduleDismiss = useCallback(() => {
        if (dismissedRef.current || pauseReasonsRef.current.size) return;
        if (timerRef.current !== null) window.clearTimeout(timerRef.current);
        timerStartedAtRef.current = performance.now();
        timerRef.current = window.setTimeout(dismiss, remainingRef.current);
    }, [dismiss]);
    useEffect(() => {
        remainingRef.current = duration;
        pauseReasonsRef.current.clear();
        scheduleDismiss();
        return () => { if (timerRef.current !== null) window.clearTimeout(timerRef.current); };
    }, [duration, scheduleDismiss, toast.id]);
    const pauseDismiss = useCallback((reason: string) => {
        if (dismissedRef.current || pauseReasonsRef.current.has(reason)) return;
        const wasRunning = pauseReasonsRef.current.size === 0;
        pauseReasonsRef.current.add(reason);
        if (wasRunning) {
            remainingRef.current = Math.max(0, remainingRef.current - (performance.now() - timerStartedAtRef.current));
            if (timerRef.current !== null) window.clearTimeout(timerRef.current);
            timerRef.current = null;
            setPaused(true);
        }
    }, []);
    const resumeDismiss = useCallback((reason: string) => {
        pauseReasonsRef.current.delete(reason);
        if (!pauseReasonsRef.current.size && !dismissedRef.current) {
            setPaused(false);
            scheduleDismiss();
        }
    }, [scheduleDismiss]);

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
        pauseDismiss('drag');
        dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startedAt: performance.now(), currentX: 0 };
        event.currentTarget.setPointerCapture(event.pointerId);
    };
    const moveSwipe = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        drag.currentX = event.clientX - drag.startX;
        setDragX(drag.currentX);
    };
    const finishSwipe = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        const elapsed = Math.max(1, performance.now() - drag.startedAt);
        const velocity = Math.abs(drag.currentX) / elapsed;
        if (Math.abs(drag.currentX) >= 72 || (Math.abs(drag.currentX) >= 28 && velocity > .45)) dismiss();
        else setDragX(0);
        resumeDismiss('drag');
    };

    return (
        <div dir="rtl" role={toast.type === 'error' ? 'alert' : 'status'} aria-atomic="true" onMouseEnter={() => pauseDismiss('hover')} onMouseLeave={() => resumeDismiss('hover')} onFocusCapture={() => pauseDismiss('focus')} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) resumeDismiss('focus'); }} onPointerDown={startSwipe} onPointerMove={moveSwipe} onPointerUp={finishSwipe} onPointerCancel={finishSwipe} style={{ touchAction: 'pan-y', transform: leaving ? undefined : `translateX(${dragX}px)`, opacity: leaving ? undefined : Math.max(.2, 1 - Math.abs(dragX) / 240), transition: dragRef.current ? 'none' : 'transform 180ms ease, opacity 180ms ease' }} className={`app-toast pointer-events-auto relative flex min-h-14 select-none items-center gap-2.5 overflow-hidden rounded-2xl border px-3 py-2.5 ${tone} ${leaving ? '-translate-y-2 opacity-0 md:translate-y-2' : dragX === 0 ? 'animate-slide-up opacity-100' : ''}`}>
            <span className={`absolute inset-y-2 right-0 w-0.5 rounded-full ${bar}`} />
            <span aria-hidden="true" className={`toast-lifetime absolute inset-x-0 bottom-0 h-0.5 origin-right ${bar}`} style={{ animationDuration: `${duration}ms`, animationPlayState: paused ? 'paused' : 'running' }} />
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
