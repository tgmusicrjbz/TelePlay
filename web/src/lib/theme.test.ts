import { beforeEach, describe, expect, it } from 'vitest';
import { applyAppearanceMode, applyCustomTheme, applyTheme, getStoredAppearanceMode, getStoredTheme, isLightAppearance } from './theme';

describe('theme settings', () => {
    beforeEach(() => {
        localStorage.clear();
        document.documentElement.className = '';
        document.documentElement.removeAttribute('data-appearance');
        document.documentElement.removeAttribute('style');
    });

    it('falls back safely when stored values are invalid', () => {
        localStorage.setItem('komod-appearance-mode', 'unknown');
        localStorage.setItem('komod-color-theme', 'unknown');
        expect(getStoredAppearanceMode()).toBe('dark');
        expect(getStoredTheme()).toBe('violet');
    });

    it('applies light and dark appearance classes consistently', () => {
        applyAppearanceMode('paper');
        expect(isLightAppearance('paper')).toBe(true);
        expect(document.documentElement).toHaveClass('light');
        expect(document.documentElement).not.toHaveClass('dark');
        expect(document.documentElement.dataset.appearance).toBe('paper');
        expect(document.documentElement.style.colorScheme).toBe('light');
        applyAppearanceMode('black');
        expect(document.documentElement).toHaveClass('dark');
        expect(document.documentElement).not.toHaveClass('light');
    });

    it('applies prepared and custom color shades', () => {
        applyTheme('blue');
        expect(document.documentElement.style.getPropertyValue('--primary-500')).toBe('59 130 246');
        applyCustomTheme('#336699');
        expect(document.documentElement.style.getPropertyValue('--primary-500')).toBe('51 102 153');
        expect(localStorage.getItem('komod-custom-color')).toBe('#336699');
    });
});
