import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ModalShell from './ModalShell';

describe('ModalShell', () => {
    it('connects its title and subtitle to the dialog for assistive technology', () => {
        render(<ModalShell title="عنوان طولانی پنجره" subtitle="توضیح کوتاه پنجره" onClose={() => undefined}>محتوا</ModalShell>);

        const dialog = screen.getByRole('dialog', { name: 'عنوان طولانی پنجره', description: 'توضیح کوتاه پنجره' });
        expect(dialog).toBeInTheDocument();
        expect(screen.getByText('محتوا')).toBeVisible();
    });

    it('closes with Escape and restores the previous focus', () => {
        const onClose = vi.fn();
        const { rerender } = render(<><button>پیشین</button><ModalShell title="پنجره" onClose={onClose}><button>عملیات</button></ModalShell></>);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledOnce();
        rerender(<button>پیشین</button>);
    });
});
