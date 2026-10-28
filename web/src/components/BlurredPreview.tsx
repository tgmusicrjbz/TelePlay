import { EyeOff } from 'lucide-react';
import type { CSSProperties } from 'react';

export const blurredPreviewStyle = (active: boolean): CSSProperties | undefined => active ? {
    filter: 'blur(9px) brightness(0.42) saturate(0.65)',
    transform: 'scale(1.16)',
} : undefined;

export default function BlurredPreview({ active, compact = false }: { active: boolean; compact?: boolean }) {
    if (!active) return null;
    return (
        <span
            aria-label="پیش‌نمایش محو شده"
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-dark-950/35 text-white"
        >
            <span className={`flex items-center justify-center rounded-full border border-white/15 bg-dark-950/75 shadow-lg ${compact ? 'h-7 w-7' : 'h-10 w-10'}`}>
                <EyeOff className={compact ? 'h-3.5 w-3.5' : 'h-5 w-5'} />
            </span>
        </span>
    );
}
