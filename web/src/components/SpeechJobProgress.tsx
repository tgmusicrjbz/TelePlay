import { clampSpeechProgress, SpeechJobState } from '../lib/speechJobs';

interface SpeechJobProgressProps {
    progress: number | null | undefined;
    state: SpeechJobState;
    className?: string;
}

export default function SpeechJobProgress({ progress, state, className = 'mt-3' }: SpeechJobProgressProps) {
    const value = clampSpeechProgress(progress);
    const color = state === 'error' ? 'bg-red-500' : state === 'cancelled' ? 'bg-dark-500' : 'bg-primary-500';

    return <div
        className={`${className} h-1.5 overflow-hidden rounded-full bg-dark-950`}
        role="progressbar"
        aria-label="پیشرفت پردازش"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={value}
    >
        <div className={`h-full rounded-full transition-[width] ${color}`} style={{ width: `${value}%` }} />
    </div>;
}
