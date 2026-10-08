import { useState } from 'react';

export const TAG_PRESETS = ['مهم', 'بعداً', 'کاری', 'شخصی', 'آموزش', 'موسیقی', 'فیلم', 'آرشیو'];
const palette = ['#a855f7','#0ea5e9','#14b8a6','#22c55e','#eab308','#f97316','#ef4444','#ec4899'];

function storedColors(): Record<string,string> {
    try { return JSON.parse(localStorage.getItem('komod-tag-colors') || '{}'); } catch { return {}; }
}

export function tagColor(tag: string): string {
    const saved = storedColors()[tag.toLocaleLowerCase('fa')];
    if (saved) return saved;
    let hash = 0; for (const char of tag) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
    return palette[Math.abs(hash) % palette.length];
}

export function saveTagColor(tag: string, color: string) {
    const colors = storedColors(); colors[tag.toLocaleLowerCase('fa')] = color;
    localStorage.setItem('komod-tag-colors', JSON.stringify(colors));
    window.dispatchEvent(new Event('komod-tag-colors-changed'));
}

export default function TagChips({ tags, editable = false }: { tags?: string[]; editable?: boolean }) {
    const [, rerender] = useState(0);
    if (!tags?.length) return null;
    return <div className="mt-2 flex flex-wrap gap-1.5">{tags.map(tag => {
        const color = tagColor(tag);
        return <span key={tag} className="relative inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-semibold" style={{color,borderColor:`${color}55`,backgroundColor:`${color}18`}}>
            <span className="ml-1 h-1.5 w-1.5 rounded-full" style={{backgroundColor:color}}/>#{tag}
            {editable && <input type="color" value={color} aria-label={`رنگ تگ ${tag}`} title={`انتخاب رنگ ${tag}`} className="absolute inset-0 cursor-pointer opacity-0" onChange={event=>{saveTagColor(tag,event.target.value);rerender(value=>value+1);}}/>}
        </span>;
    })}</div>;
}
