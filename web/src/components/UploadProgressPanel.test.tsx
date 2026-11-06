import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import UploadProgressPanel from './UploadProgressPanel';

describe('UploadProgressPanel', () => {
    it('normalizes progress and exposes it to assistive technology', () => {
        render(<UploadProgressPanel progress={{ name: 'video.mp4', index: 1, total: 2, percent: 140, phase: 'uploading' }} mode="open" onModeChange={vi.fn()} onCancel={vi.fn()} />);
        expect(screen.getByRole('progressbar', { name: 'پیشرفت آپلود' })).toHaveAttribute('aria-valuenow', '100');
        expect(screen.getByText('1/2 · 100%')).toBeInTheDocument();
    });

    it('collapses and cancels without waiting for the upload', () => {
        const onModeChange = vi.fn();
        const onCancel = vi.fn();
        render(<UploadProgressPanel progress={{ name: 'audio.mp3', index: 1, total: 1, percent: 30, phase: 'uploading' }} mode="open" onModeChange={onModeChange} onCancel={onCancel} />);
        fireEvent.click(screen.getByTitle('نمایش خیلی کوچک'));
        fireEvent.click(screen.getByTitle('لغو آپلود'));
        expect(onModeChange).toHaveBeenCalledWith('collapsed');
        expect(onCancel).toHaveBeenCalledOnce();
    });
});
