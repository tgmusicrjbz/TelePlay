import { useEffect, useState } from 'react';
import { AudioLines, Download, ListMusic, Settings, Warehouse, Sparkles } from 'lucide-react';
import { useAppStore } from '../lib/store';

type NavSection = 'files' | 'playlists' | 'speech' | 'studio' | 'downloads' | 'settings';
const items: Array<{ section: NavSection; label: string; shortLabel: string; icon: typeof Warehouse }> = [
    { section: 'files', label: 'کمد من', shortLabel: 'کمد من', icon: Warehouse },
    { section: 'playlists', label: 'پلی‌لیست‌ها', shortLabel: 'پلی‌لیست', icon: ListMusic },
    { section: 'speech', label: 'متن و صدا', shortLabel: 'متن و صدا', icon: AudioLines },
    { section: 'studio', label: 'استودیوی رسانه', shortLabel: 'استودیو', icon: Sparkles },
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
        const path = section === 'playlists' ? '/playlists' : section === 'studio' ? '/studio' : section === 'downloads' ? '/downloads' : '/';
        if (window.location.pathname !== path) window.history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
        if (section === 'settings') window.dispatchEvent(new Event('komod-open-settings-home'));
    };
    return <>
        <aside className="fixed inset-y-0 right-0 z-40 hidden w-24 flex-col items-center border-l border-white/[0.07] bg-dark-900/[.98] py-5 shadow-xl shadow-black/10 md:flex">
            <button onClick={() => selectSection('files')} className="mb-7 flex flex-col items-center gap-2" aria-label="کمد من"><img src="/komod.svg" alt="کمد" className="h-10 w-10 rounded-xl object-contain shadow-lg shadow-primary-500/20" /><span className="text-xs font-bold">کمد</span></button>
            <nav className="flex w-full flex-1 flex-col gap-2 px-2">{visibleItems.map(({ section, label, icon: Icon }) => {const selected=section==='speech'?activeSection==='settings'&&settingsView==='tts':activeSection===section&&(section!=='settings'||settingsView!=='tts');return <button key={section} aria-current={selected?'page':undefined} onClick={() => selectSection(section)} className={`group relative flex min-h-16 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-2xl px-1 text-[11px] transition ${selected ? 'bg-gradient-to-b from-primary-500/20 to-primary-500/[.08] text-primary-100 shadow-inner shadow-white/[.03]' : 'text-dark-400 hover:bg-white/[0.05] hover:text-white'}`}>{selected&&<span className="absolute inset-y-3 right-0 w-0.5 rounded-full bg-primary-400 shadow-[0_0_12px_rgba(192,132,252,.8)]"/>}<Icon className={`h-5 w-5 transition-transform ${selected?'scale-110':'group-hover:scale-105'}`} /><span>{label}</span></button>})}</nav>
        </aside>
        <nav className={`fixed inset-x-2 bottom-[max(.4rem,env(safe-area-inset-bottom))] z-[110] grid h-[4.25rem] ${isSharedWorkspace?'grid-cols-5':'grid-cols-6'} overflow-hidden rounded-2xl border border-white/10 bg-dark-900/[.98] px-1 shadow-xl shadow-black/25 md:hidden`}>{visibleItems.map(({ section, shortLabel, icon: Icon }) => {const selected=section==='speech'?activeSection==='settings'&&settingsView==='tts':activeSection===section&&(section!=='settings'||settingsView!=='tts');return <button key={section} aria-current={selected?'page':undefined} onClick={() => selectSection(section)} className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 text-[9px] transition ${selected ? 'text-primary-200' : 'text-dark-400 active:bg-white/[.04]'}`}>{selected&&<span className="absolute inset-x-2 top-0 h-0.5 rounded-full bg-primary-400"/>}<span className={`flex h-8 w-9 items-center justify-center rounded-xl transition ${selected ? 'bg-primary-500/15' : ''}`}><Icon className={`h-5 w-5 ${selected?'scale-105':''}`} /></span><span className="max-w-full truncate px-0.5">{shortLabel}</span></button>})}</nav>
    </>;
}
