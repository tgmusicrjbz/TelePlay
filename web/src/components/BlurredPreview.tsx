import { EyeOff } from 'lucide-react';

export default function BlurredPreview({ active, compact = false, card = false }: { active: boolean; compact?: boolean; card?: boolean }) {
    if (!active) return null;
    if (card) {
        return (
            <span
                aria-label="کارت محو شده"
                className="pointer-events-none absolute inset-0 z-[25] rounded-[inherit]"
                style={{
                    background: 'linear-gradient(135deg, rgba(24, 33, 57, 0.97), rgba(7, 12, 29, 0.985))',
                    backdropFilter: 'blur(32px) brightness(0.08) saturate(0)',
                    WebkitBackdropFilter: 'blur(32px) brightness(0.08) saturate(0)',
                    boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.045), inset 0 0 44px rgba(3,7,18,0.82)',
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
