import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import SpeechJobProgress from './SpeechJobProgress';

describe('SpeechJobProgress', () => {
    it('exposes accessible progress and clamps invalid percentages', () => {
        const { rerender } = render(<SpeechJobProgress progress={135} state="transcribing" />);
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
        expect(screen.getByRole('progressbar').firstElementChild).toHaveStyle({ width: '100%' });

        rerender(<SpeechJobProgress progress={-5} state="error" />);
        expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0');
        expect(screen.getByRole('progressbar').firstElementChild).toHaveClass('bg-red-500');
    });
});
