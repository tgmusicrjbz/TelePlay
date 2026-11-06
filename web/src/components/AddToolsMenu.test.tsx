import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AddToolsMenu from './AddToolsMenu';

const renderMenu = (overrides: Partial<Parameters<typeof AddToolsMenu>[0]> = {}) => {
    const props: Parameters<typeof AddToolsMenu>[0] = {
        open: true,
        onClose: vi.fn(),
        onUpload: vi.fn(),
        onCreateText: vi.fn(),
        onCreateFolder: vi.fn(),
        onImportLink: vi.fn(),
        onImportDrive: vi.fn(),
        onOpenTTS: vi.fn(),
        onOpenSTT: vi.fn(),
        onWatchTogether: vi.fn(),
        ...overrides,
    };
    render(<AddToolsMenu {...props} />);
    return props;
};

describe('AddToolsMenu', () => {
    it('does not mount a dialog while closed', () => {
        renderMenu({ open: false });
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    it('closes before starting the selected tool', () => {
        const calls: string[] = [];
        renderMenu({ onClose: () => calls.push('close'), onImportLink: () => calls.push('import') });
        fireEvent.click(screen.getByRole('button', { name: 'ذخیره از لینک' }));
        expect(calls).toEqual(['close', 'import']);
    });
});
