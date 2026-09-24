export const colorThemes = {
    violet: { label: 'بنفش', dot: '#a855f7', shades: ['250 245 255','243 232 255','233 213 255','216 180 254','192 132 252','168 85 247','147 51 234','124 58 237','107 33 168','88 28 135','59 7 100'] },
    blue: { label: 'آبی', dot: '#3b82f6', shades: ['239 246 255','219 234 254','191 219 254','147 197 253','96 165 250','59 130 246','37 99 235','29 78 216','30 64 175','30 58 138','23 37 84'] },
    emerald: { label: 'زمردی', dot: '#10b981', shades: ['236 253 245','209 250 229','167 243 208','110 231 183','52 211 153','16 185 129','5 150 105','4 120 87','6 95 70','6 78 59','2 44 34'] },
    rose: { label: 'رز', dot: '#f43f5e', shades: ['255 241 242','255 228 230','254 205 211','253 164 175','251 113 133','244 63 94','225 29 72','190 18 60','159 18 57','136 19 55','76 5 25'] },
    amber: { label: 'کهربایی', dot: '#f59e0b', shades: ['255 251 235','254 243 199','253 230 138','252 211 77','251 191 36','245 158 11','217 119 6','180 83 9','146 64 14','120 53 15','69 26 3'] },
} as const;

export type ColorTheme = keyof typeof colorThemes;

export const getStoredTheme = (): ColorTheme => {
    const saved = localStorage.getItem('komod-color-theme');
    return saved && saved in colorThemes ? saved as ColorTheme : 'violet';
};

export const applyTheme = (theme: ColorTheme) => {
    colorThemes[theme].shades.forEach((value, index) => {
        const shade = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950][index];
        document.documentElement.style.setProperty(`--primary-${shade}`, value);
    });
};
