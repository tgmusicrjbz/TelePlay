import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PublicMediaPlayer } from './PublicSharePage';

const info = {
    file_name: 'نمونه.mp4', file_type: 'video' as const, file_size: 1024,
    password_required: false, allow_download: true,
};

afterEach(() => vi.useRealTimers());

describe('PublicMediaPlayer', () => {
    it('offers audio-only playback without replacing the media element', () => {
        const {container} = render(<PublicMediaPlayer info={info} streamUrl="/video.mp4"/>);
        fireEvent.click(screen.getByTitle('فقط صدا'));
        expect(screen.getByText('حالت فقط صدا')).toBeInTheDocument();
        expect(container.querySelector('video')).toHaveClass('invisible');
        expect(screen.getByTitle('بازگشت به ویدیو')).toBeInTheDocument();
    });

    it('hides video controls shortly after interaction stops', () => {
        vi.useFakeTimers();
        const {container} = render(<PublicMediaPlayer info={info} streamUrl="/video.mp4"/>);
        const overlay = container.querySelector('[data-player-tools]')?.parentElement;
        expect(overlay).toHaveClass('opacity-100');
        act(() => vi.advanceTimersByTime(2300));
        expect(overlay).toHaveClass('opacity-0');
        fireEvent.pointerMove(container.firstElementChild as Element);
        expect(overlay).toHaveClass('opacity-100');
    });

    it('cycles through horizontal and vertical orientation controls', () => {
        render(<PublicMediaPlayer info={info} streamUrl="/video.mp4"/>);
        fireEvent.click(screen.getByTitle('چرخش خودکار؛ بعدی افقی'));
        expect(screen.getByTitle('قفل افقی؛ بعدی عمودی')).toBeInTheDocument();
        fireEvent.click(screen.getByTitle('قفل افقی؛ بعدی عمودی'));
        expect(screen.getByTitle('قفل عمودی؛ بعدی خودکار')).toBeInTheDocument();
    });

    it('shows unclipped speed options and applies double speed to the media element', () => {
        const {container}=render(<PublicMediaPlayer info={info} streamUrl="/video.mp4"/>);
        fireEvent.click(screen.getByTitle('سرعت پخش'));
        const menu=screen.getByRole('menu',{name:'سرعت پخش'});
        expect(menu).toHaveAttribute('data-speed-menu');
        expect(menu.closest('[data-player-tools]')).toBeNull();
        fireEvent.click(screen.getByRole('menuitem',{name:'2×'}));
        expect((container.querySelector('video') as HTMLVideoElement).playbackRate).toBe(2);
        expect(screen.getByTitle('سرعت پخش')).toHaveTextContent('2×');
    });
});
