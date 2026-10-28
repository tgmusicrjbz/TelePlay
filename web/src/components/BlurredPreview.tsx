import { EyeOff } from 'lucide-react';

export default function BlurredPreview({ active, compact = false, card = false }: { active: boolean; compact?: boolean; card?: boolean }) {
    if (!active) return null;
    return (
        <span
            aria-label="پیش‌نمایش محو شده"
            className={`pointer-events-none absolute inset-0 flex items-center justify-center text-white ${card ? 'z-[5] rounded-[inherit] bg-dark-950/35' : 'z-10 bg-dark-950/35'}`}
            style={card ? { backdropFilter: 'blur(12px) brightness(0.48) saturate(0.6)', WebkitBackdropFilter: 'blur(12px) brightness(0.48) saturate(0.6)' } : undefined}
        >
            <span className={`flex items-center justify-center rounded-full border border-white/15 bg-dark-950/80 shadow-lg ${compact ? 'h-7 w-7' : 'h-10 w-10'}`}>
                <EyeOff className={compact ? 'h-3.5 w-3.5' : 'h-5 w-5'} />
            </span>
        </span>
    );
}
