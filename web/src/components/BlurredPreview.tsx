import { EyeOff } from 'lucide-react';

export default function BlurredPreview({ active, compact = false, card = false }: { active: boolean; compact?: boolean; card?: boolean }) {
    if (!active) return null;
    if (card) {
        return (
            <span
                aria-label="کارت محو شده"
                className="pointer-events-none absolute inset-0 z-[5] rounded-[inherit]"
                style={{
                    background: 'rgba(5, 9, 24, 0.38)',
                    backdropFilter: 'blur(18px) brightness(0.42) saturate(0.55)',
                    WebkitBackdropFilter: 'blur(18px) brightness(0.42) saturate(0.55)',
                    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.035)',
                }}
            />
        );
    }
    return (
        <span
            aria-label="پیش‌نمایش محو شده"
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-dark-950/35 text-white"
        >
            <span className={`flex items-center justify-center rounded-full border border-white/15 bg-dark-950/80 shadow-lg ${compact ? 'h-7 w-7' : 'h-10 w-10'}`}>
                <EyeOff className={compact ? 'h-3.5 w-3.5' : 'h-5 w-5'} />
            </span>
        </span>
    );
}
