import { useEffect, useState } from 'react';

const palette = ['#a855f7','#0ea5e9','#14b8a6','#22c55e','#eab308','#f97316','#ef4444','#ec4899'];
type CachedTagSettings = { tags:Array<{name:string;color:string}>; show_file_tags:boolean; display_limit:number };

function settings(): CachedTagSettings {
    try { return JSON.parse(localStorage.getItem('komod-tag-settings') || '{"tags":[],"show_file_tags":false,"display_limit":2}'); }
    catch { return {tags:[],show_file_tags:false,display_limit:2}; }
}

function storedColors(): Record<string,string> {
    try { return JSON.parse(localStorage.getItem('komod-tag-colors') || '{}'); } catch { return {}; }
}

export function tagColor(tag: string): string {
    const configured=settings().tags.find(item=>item.name.toLocaleLowerCase('fa')===tag.toLocaleLowerCase('fa'))?.color;
    if(configured)return configured;
    const saved = storedColors()[tag.toLocaleLowerCase('fa')];
    if (saved) return saved;
    let hash = 0; for (const char of tag) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return palette[Math.abs(hash) % palette.length];
}

export const getTagPresets = () => settings().tags.map(item => item.name);

export function saveTagColor(tag: string, color: string) {
    const colors = storedColors(); colors[tag.toLocaleLowerCase('fa')] = color;
    localStorage.setItem('komod-tag-colors', JSON.stringify(colors));
    window.dispatchEvent(new Event('komod-tag-colors-changed'));
}

export default function TagChips({ tags, editable = false, compact = false }: { tags?: string[]; editable?: boolean; compact?: boolean }) {
    const [, rerender] = useState(0);
    useEffect(()=>{const update=()=>rerender(value=>value+1);window.addEventListener('komod-tag-settings-changed',update);return()=>window.removeEventListener('komod-tag-settings-changed',update)},[]);
    if (!tags?.length) return null;
    const prefs=settings();
    if(compact&&!prefs.show_file_tags)return null;
    const visible=compact?tags.slice(0,Math.max(1,prefs.display_limit||2)):tags;
    return <div className="mt-2 flex min-w-0 flex-wrap gap-1.5">{visible.map(tag => {
        const color = tagColor(tag);
        return <span key={tag} className="relative inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold" style={{color,borderColor:`${color}55`,backgroundColor:`${color}18`}}>
            <span className="ml-1 h-1.5 w-1.5 rounded-full" style={{backgroundColor:color}}/>#{tag}
            {editable && <input type="color" value={color} aria-label={`رنگ تگ ${tag}`} title={`انتخاب رنگ ${tag}`} className="absolute inset-0 cursor-pointer opacity-0" onChange={event=>{saveTagColor(tag,event.target.value);rerender(value=>value+1);}}/>}
        </span>;
    })}{compact&&tags.length>visible.length&&<span className="rounded-full bg-white/[.06] px-2 py-1 text-[10px] text-dark-400">+{tags.length-visible.length}</span>}</div>;
}
