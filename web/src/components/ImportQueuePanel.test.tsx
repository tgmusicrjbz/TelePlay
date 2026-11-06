import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ImportQueuePanel from './ImportQueuePanel';
import type { ImportStatus } from '../lib/importQueue';

const jobs: ImportStatus[] = [
    { id: 'active', source: 'link', url: 'https://youtu.be/one', title: 'ویدیوی اول', state: 'downloading', message: 'در حال دریافت', progress: 45 },
    { id: 'failed', source: 'link', url: 'https://pin.it/two', state: 'error', message: 'دریافت نشد', progress: 130 },
];

describe('ImportQueuePanel', () => {
    it('shows active count when collapsed and restores the panel', () => {
        const onModeChange = vi.fn();
        render(<ImportQueuePanel jobs={jobs} mode="collapsed" onModeChange={onModeChange} onCancelAll={vi.fn()} onClearFinished={vi.fn()} onControl={vi.fn()} />);
        fireEvent.click(screen.getByTitle('نمایش صف لینک‌ها'));
        expect(screen.getByText('۱ فعال')).toBeInTheDocument();
        expect(onModeChange).toHaveBeenCalledWith('open');
    });

    it('keeps queue actions available without blocking the page', () => {
        const onControl = vi.fn();
        const onClearFinished = vi.fn();
        render(<ImportQueuePanel jobs={jobs} mode="open" onModeChange={vi.fn()} onCancelAll={vi.fn()} onClearFinished={onClearFinished} onControl={onControl} />);
        fireEvent.click(screen.getByTitle('تلاش دوباره'));
        fireEvent.click(screen.getByTitle('پاک‌کردن موارد پایان‌یافته'));
        expect(onControl).toHaveBeenCalledWith('failed', 'retry');
        expect(onClearFinished).toHaveBeenCalledOnce();
        expect(screen.getByText('۱۰۰٪')).toBeInTheDocument();
    });
});
