import { useEffect, useState } from 'react';
import { AudioLines, Download, ListMusic, Settings, Warehouse } from 'lucide-react';
import { useAppStore } from '../lib/store';

type NavSection = 'files' | 'playlists' | 'speech' | 'downloads' | 'settings';
const items: Array<{ section: NavSection; label: string; shortLabel: string; icon: typeof Warehouse }> = [
    { section: 'files', label: 'کمد من', shortLabel: 'کمد من', icon: Warehouse },
    { section: 'playlists', label: 'پلی‌لیست‌ها', shortLabel: 'پلی‌لیست', icon: ListMusic },
    { section: 'speech', label: 'متن و صدا', shortLabel: 'متن و صدا', icon: AudioLines },
    { section: 'downloads', label: 'دانلودها', shortLabel: 'دانلودها', icon: Download },
    { section: 'settings', label: 'تنظیمات', shortLabel: 'تنظیمات', icon: Settings },
];

export default function Sidebar() {
    const { activeSection, setActiveSection } = useAppStore();
    const [settingsView,setSettingsView]=useState('home');
    useEffect(()=>{const sync=(event:Event)=>setSettingsView((event as CustomEvent<{view:string}>).detail?.view||'home');window.addEventListener('komod-settings-view',sync);return()=>window.removeEventListener('komod-settings-view',sync)},[]);
    const isSharedWorkspace = Boolean(localStorage.getItem('komod-active-workspace'));
    const visibleItems = isSharedWorkspace ? items.filter(item => item.section !== 'playlists') : items;
    const selectSection = (section: NavSection) => {
        if (section === 'speech') {
            localStorage.setItem('komod-settings-target', 'tts');
            setActiveSection('settings');
            if (window.location.pathname !== '/') window.history.pushState({}, '', '/');
            window.dispatchEvent(new PopStateEvent('popstate'));
            window.dispatchEvent(new Event('komod-open-tts'));
            return;
        }
        if (section === 'settings') localStorage.setItem('komod-settings-target', 'home');
        setActiveSection(section);
        const path = section === 'playlists' ? '/playlists' : section === 'downloads' ? '/downloads' : '/';
        if (window.location.pathname !== path) window.history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
        if (section === 'settings') window.dispatchEvent(new Event('komod-open-settings-home'));
    };
    return <>
        <aside className="fixed inset-y-0 right-0 z-40 hidden w-24 flex-col items-center border-l border-white/[0.06] bg-dark-900/95 py-5 backdrop-blur-xl md:flex">
            <button onClick={() => selectSection('files')} className="mb-7 flex flex-col items-center gap-2" aria-label="کمد من"><img src="/komod.svg" alt="کمد" className="h-10 w-10 rounded-xl object-contain shadow-lg shadow-primary-500/20" /><span className="text-xs font-bold">کمد</span></button>
            <nav className="flex w-full flex-1 flex-col gap-2 px-2">{visibleItems.map(({ section, label, icon: Icon }) => {const selected=section==='speech'?activeSection==='settings'&&settingsView==='tts':activeSection===section&&(section!=='settings'||settingsView!=='tts');return <button key={section} onClick={() => selectSection(section)} className={`flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-2xl px-1 text-[11px] transition-colors ${selected ? 'bg-primary-500/15 text-primary-200' : 'text-dark-400 hover:bg-white/[0.05] hover:text-white'}`}><Icon className="h-5 w-5" /><span>{label}</span></button>})}</nav>
        </aside>
        <nav className={`fixed inset-x-0 bottom-0 z-[110] grid h-[calc(5rem+env(safe-area-inset-bottom))] ${isSharedWorkspace?'grid-cols-4':'grid-cols-5'} border-t border-white/10 bg-dark-900/95 px-1 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden`}>{visibleItems.map(({ section, shortLabel, icon: Icon }) => {const selected=section==='speech'?activeSection==='settings'&&settingsView==='tts':activeSection===section&&(section!=='settings'||settingsView!=='tts');return <button key={section} onClick={() => selectSection(section)} className={`flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 text-[10px] transition-colors ${selected ? 'text-primary-300' : 'text-dark-400'}`}><span className={`flex h-8 w-11 items-center justify-center rounded-full ${selected ? 'bg-primary-500/15' : ''}`}><Icon className="h-5 w-5" /></span><span className="truncate">{shortLabel}</span></button>})}</nav>
    </>;
}
