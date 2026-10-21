import { useEffect, useRef, useState } from 'react';
import { Braces, Check, RotateCcw } from 'lucide-react';
import { useAccountPreferences, useUpdateAccountPreferences } from '../lib/api';
import { useAppStore } from '../lib/store';

const defaults = {
    youtube: '📝 [عنوان]\n📺 [سازنده]\n🔗 [لینک]',
    instagram: '📝 [عنوان]\n📷 [سازنده]\n🔗 [لینک]',
};
const variables = ['[عنوان]', '[سازنده]', '[لینک]', '[پلتفرم]', '[نوع]', '[کیفیت]'];

export default function LinkCaptionSettings() {
    const { data } = useAccountPreferences();
    const update = useUpdateAccountPreferences();
    const addToast = useAppStore(state => state.addToast);
    const [platform, setPlatform] = useState<'youtube'|'instagram'>('youtube');
    const [youtube, setYoutube] = useState(defaults.youtube);
    const [instagram, setInstagram] = useState(defaults.instagram);
    const editor = useRef<HTMLTextAreaElement>(null);
    useEffect(() => {
        if (!data) return;
        setYoutube(data.youtube_caption_template || '');
        setInstagram(data.instagram_caption_template || '');
    }, [data]);
    const value = platform === 'youtube' ? youtube : instagram;
    const setValue = platform === 'youtube' ? setYoutube : setInstagram;
    const insert = (token:string) => {
        const input = editor.current;
        const start = input?.selectionStart ?? value.length;
        const end = input?.selectionEnd ?? start;
        setValue(`${value.slice(0,start)}${token}${value.slice(end)}`);
        requestAnimationFrame(() => { input?.focus(); input?.setSelectionRange(start+token.length,start+token.length); });
    };
    const save = async () => {
        try {
            await update.mutateAsync({youtube_caption_template:youtube, instagram_caption_template:instagram});
            addToast('قالب توضیحات لینک‌ها ذخیره شد.','success');
        } catch { addToast('ذخیره قالب انجام نشد.','error'); }
    };
    return <section id="files-link-caption" className="rounded-2xl border border-white/[.07] bg-dark-900/70 p-5">
        <div className="flex items-center gap-3"><span className="text-primary-300"><Braces className="h-5 w-5"/></span><div><h2 className="font-bold">توضیحات فایل‌های لینک‌شده</h2><p className="mt-1 text-xs text-dark-400">متن زیر فایل‌های یوتیوب و اینستاگرام را خودت بچین.</p></div></div>
        <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl border border-white/[.07] bg-dark-950/50 p-1">
            <button onClick={()=>setPlatform('youtube')} className={`min-h-10 rounded-lg text-sm transition ${platform==='youtube'?'bg-primary-500 text-white':'text-dark-400 hover:bg-white/[.04]'}`}>یوتیوب</button>
            <button onClick={()=>setPlatform('instagram')} className={`min-h-10 rounded-lg text-sm transition ${platform==='instagram'?'bg-primary-500 text-white':'text-dark-400 hover:bg-white/[.04]'}`}>اینستاگرام</button>
        </div>
        <textarea ref={editor} dir="rtl" value={value} onChange={event=>setValue(event.target.value)} className="input mt-3 min-h-32 resize-none text-right leading-7" maxLength={1000}/>
        <div className="mt-3 flex flex-wrap gap-2">{variables.map(item=><button key={item} type="button" onClick={()=>insert(item)} className="rounded-lg border border-primary-400/15 bg-primary-500/[.08] px-2.5 py-1.5 text-xs text-primary-100 transition hover:bg-primary-500/15">{item}</button>)}</div>
        <p className="mt-3 text-xs leading-6 text-dark-500">می‌توانی قبل و بعد متغیرها هر متن یا ایموجی دلخواهی بنویسی. اطلاعات خالی از خروجی حذف می‌شوند.</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2"><button type="button" onClick={()=>setValue(defaults[platform])} className="btn-secondary min-h-10 px-3 text-xs"><RotateCcw className="h-4 w-4"/>پیش‌فرض</button><button type="button" disabled={update.isPending} onClick={()=>void save()} className="btn-primary min-h-10 px-4 text-xs"><Check className="h-4 w-4"/>{update.isPending?'در حال ذخیره…':'ذخیره قالب'}</button></div>
    </section>;
}
