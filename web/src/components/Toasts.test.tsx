import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Toasts from './Toasts';
import { useAppStore } from '../lib/store';

describe('Toasts', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        useAppStore.setState({
            toasts: [{ id: 'notice', message: 'عملیات انجام شد', type: 'success' }],
            previewFile: null,
            isPlayerMinimized: false,
        });
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        useAppStore.setState({ toasts: [] });
    });

    it('pauses automatic dismissal while the user is reading it', () => {
        render(<Toasts />);
        const toast = screen.getByRole('status');

        fireEvent.mouseEnter(toast);
        act(() => vi.advanceTimersByTime(5000));
        expect(screen.getByText('عملیات انجام شد')).toBeInTheDocument();

        fireEvent.mouseLeave(toast);
        act(() => vi.advanceTimersByTime(2500));
        expect(screen.queryByText('عملیات انجام شد')).not.toBeInTheDocument();
    });

    it('can still be dismissed immediately with its close button', () => {
        render(<Toasts />);
        fireEvent.click(screen.getByRole('button', { name: 'بستن اعلان' }));
        act(() => vi.advanceTimersByTime(200));
        expect(screen.queryByText('عملیات انجام شد')).not.toBeInTheDocument();
    });
});
