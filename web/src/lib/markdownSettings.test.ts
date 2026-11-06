import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultMarkdownPalette, getMarkdownReaderLayout, getMarkdownSettings, getMarkdownThemeOptions, saveHiddenMarkdownBuiltIns, saveMarkdownCustomThemes, saveMarkdownReaderLayout, saveMarkdownSettings } from './markdownSettings';

describe('markdown settings', () => {
    beforeEach(() => localStorage.clear());

    it('keeps settings isolated between accounts', () => {
        localStorage.setItem('komod-current-account', 'first');
        const first = { ...getMarkdownSettings(), fontSize: 21, theme: 'ocean' };
        saveMarkdownSettings(first);
        localStorage.setItem('komod-current-account', 'second');
        expect(getMarkdownSettings().fontSize).toBe(21);
        expect(getMarkdownSettings().theme).toBe('ocean');
        const second = { ...getMarkdownSettings(), fontSize: 17, theme: 'dark' };
        saveMarkdownSettings(second);
        localStorage.setItem('komod-current-account', 'first');
        expect(getMarkdownSettings()).toEqual(expect.objectContaining({ fontSize: 21, theme: 'ocean' }));
    });

    it('migrates legacy settings into the current account and merges reader actions', () => {
        localStorage.setItem('komod-current-account', 'legacy-user');
        localStorage.setItem('komod-markdown-settings', JSON.stringify({ font: 'serif', readerActions: { ai: true } }));
        const settings = getMarkdownSettings();
        expect(settings.font).toBe('serif');
        expect(settings.readerActions).toEqual(expect.objectContaining({ edit: true, ai: true, fullscreen: true }));
        expect(localStorage.getItem('komod-markdown-settings:legacy-user')).not.toBeNull();
    });

    it('dispatches updates and preserves the remembered reader layout', () => {
        const listener = vi.fn();
        window.addEventListener('komod-markdown-settings-changed', listener);
        const settings = { ...getMarkdownSettings(), showHeaderOnOpen: false };
        saveMarkdownSettings(settings);
        saveMarkdownReaderLayout({ header: true, actions: true, display: false, focus: true });
        expect(listener).toHaveBeenCalledOnce();
        expect(getMarkdownReaderLayout(settings)).toEqual({ header: true, actions: true, display: false, focus: true });
        window.removeEventListener('komod-markdown-settings-changed', listener);
    });

    it('filters hidden presets and includes custom themes', () => {
        saveHiddenMarkdownBuiltIns(['gray']);
        saveMarkdownCustomThemes([{ id: 'personal', name: 'شخصی', palette: defaultMarkdownPalette }]);
        const options = getMarkdownThemeOptions();
        expect(options).not.toContainEqual(expect.objectContaining({ value: 'gray' }));
        expect(options).toContainEqual({ value: 'custom:personal', label: '🎨 شخصی' });
    });
});
