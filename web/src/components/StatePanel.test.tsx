import { fireEvent, render, screen } from '@testing-library/react';
import { CircleOff } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';
import { EmptyState, LoadingState } from './StatePanel';

describe('StatePanel', () => {
    it('announces loading state to assistive technology', () => {
        render(<LoadingState label="در حال دریافت فایل‌ها" />);
        expect(screen.getByRole('status')).toHaveTextContent('در حال دریافت فایل‌ها');
    });

    it('renders and runs an empty-state action', () => {
        const onRetry = vi.fn();
        render(<EmptyState icon={<CircleOff />} title="فایلی پیدا نشد" action={<button onClick={onRetry}>تلاش دوباره</button>} />);
        fireEvent.click(screen.getByRole('button', { name: 'تلاش دوباره' }));
        expect(onRetry).toHaveBeenCalledOnce();
    });
});
