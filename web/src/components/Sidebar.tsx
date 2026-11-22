import { useEffect, useState } from 'react';
import { AudioLines, Download, ListMusic, Settings, Warehouse } from 'lucide-react';
import { useAppStore } from '../lib/store';

type NavSection = 'files' | 'playlists' | 'rooms' | 'speech' | 'downloads' | 'settings';
type NavItem = { section: NavSection; label: string; shortLabel: string; icon: typeof Warehouse };

const items: NavItem[] = [
    { section: 'files', label: 'کمد من', shortLabel: 'کمد', icon: Warehouse },
    { section: 'playlists', label: 'پلی‌لیست‌ها', shortLabel: 'پلی‌لیست', icon: ListMusic },
    { section: 'speech', label: 'متن و صدا', shortLabel: 'متن و صدا', icon: AudioLines },
    { section: 'downloads', label: 'دانلودها', shortLabel: 'دانلود', icon: Download },
    { section: 'settings', label: 'تنظیمات', shortLabel: 'تنظیمات', icon: Settings },
];

export default function Sidebar() {
    const { activeSection, setActiveSection } = useAppStore();
    const [settingsView, setSettingsView] = useState('home');

    useEffect(() => {
        const sync = (event: Event) => setSettingsView((event as CustomEvent<{ view: string }>).detail?.view || 'home');
        window.addEventListener('komod-settings-view', sync);
        return () => window.removeEventListener('komod-settings-view', sync);
    }, []);

    const isSharedWorkspace = Boolean(localStorage.getItem('komod-active-workspace'));
    // هم‌پخش موقتاً از ناوبری ثابت برداشته شده و از ابزارها/منوهای مربوط
    // به پلی‌لیست قابل دسترسی می‌ماند. این کار در موبایل افقی هم جا را آزاد می‌کند.
    const visibleItems = isSharedWorkspace ? items.filter(item => item.section !== 'playlists') : items;
    const isSelected = (section: NavSection) => section === 'speech'
        ? activeSection === 'settings' && settingsView === 'tts'
        : activeSection === section && (section !== 'settings' || settingsView !== 'tts');

    const selectSection = (section: NavSection) => {
        if (section === 'speech') {
            localStorage.setItem('komod-settings-target', 'tts');
            const url = new URL(window.location.href);
            url.pathname = '/';
            url.searchParams.set('settings','tts');
            url.searchParams.delete('section');
            window.history.pushState({}, '', `${url.pathname}${url.search}${url.hash}`);
            setActiveSection('settings');
            window.dispatchEvent(new PopStateEvent('popstate'));
            window.setTimeout(() => window.dispatchEvent(new Event('komod-open-tts')), 0);
            return;
        }
        if (section === 'settings') localStorage.setItem('komod-settings-target', 'home');
        setActiveSection(section);
        const path = section === 'playlists' ? '/playlists' : section === 'rooms' ? '/rooms' : section === 'downloads' ? '/downloads' : '/';
        if (window.location.pathname !== path) window.history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
        if (section === 'settings') window.dispatchEvent(new Event('komod-open-settings-home'));
    };

    return <>
        <aside className="komod-side-rail fixed inset-y-0 right-0 z-40 hidden w-24 flex-col items-center py-4 md:flex">
            <button type="button" onClick={() => selectSection('files')} className="komod-side-brand" aria-label="کمد من">
                <span className="komod-side-brand-mark"><img src="/komod.svg" alt="" className="h-9 w-9 object-contain" /></span>
                <span className="text-[11px] font-black tracking-tight">کمد</span>
            </button>
            <nav className="mt-5 flex w-full flex-1 flex-col gap-1.5 px-2.5" aria-label="بخش‌های اصلی">
                {visibleItems.map(({ section, label, icon: Icon }) => {
                    const selected = isSelected(section);
                    return <button type="button" key={section} aria-current={selected ? 'page' : undefined} onClick={() => selectSection(section)} className={`komod-side-item group ${selected ? 'is-active' : ''}`}>
                        <span className="komod-side-icon"><Icon className="h-5 w-5" strokeWidth={selected ? 2.35 : 1.9} /></span>
                        <span>{label}</span>
                    </button>;
                })}
            </nav>
            <span className="mb-1 h-1 w-8 rounded-full bg-white/10" aria-hidden="true" />
        </aside>

        <nav className={`komod-bottom-dock ${isSharedWorkspace ? 'grid-cols-4' : 'grid-cols-5'} md:hidden`} aria-label="نوار اصلی">
            {visibleItems.map(({ section, shortLabel, label, icon: Icon }) => {
                const selected = isSelected(section);
                return <button type="button" key={section} aria-label={label} aria-current={selected ? 'page' : undefined} onClick={() => selectSection(section)} className={`komod-dock-item ${selected ? 'is-active' : ''}`}>
                    <span className="komod-dock-icon"><Icon className="h-[1.35rem] w-[1.35rem]" strokeWidth={selected ? 2.45 : 1.9} /></span>
                    <span className="komod-dock-label">{shortLabel}</span>
                    <span className="komod-dock-dot" aria-hidden="true" />
                </button>;
            })}
        </nav>
    </>;
}
