import { useEffect, useState } from 'react';
import { Check, ClipboardCopy, MessageCircle, Send, Sparkles, Tags } from 'lucide-react';
import { FileInsights, FileQuestionTurn, useAskFileQuestion, useFileInsights, useSuggestFileMetadata, useUpdateFile } from '../lib/api';
import { useAppStore } from '../lib/store';
import ModalShell from './ModalShell';

type Tool = 'summary' | 'ask' | 'metadata';

export default function FileAIToolsModal() {
    const { aiToolsFile: file, setAIToolsFile, addToast } = useAppStore();
    const [tool, setTool] = useState<Tool>('summary');
    const insightsMutation = useFileInsights();
    const askMutation = useAskFileQuestion();
    const metadataMutation = useSuggestFileMetadata();
    const updateFile = useUpdateFile();
    const [insights, setInsights] = useState<FileInsights | null>(null);
    const [suggestion, setSuggestion] = useState<{title:string;description:string;tags:string[]}|null>(null);
    const [question, setQuestion] = useState('');
    const [history, setHistory] = useState<FileQuestionTurn[]>([]);
    const [error, setError] = useState('');
    useEffect(() => { setTool('summary'); setInsights(null); setSuggestion(null); setQuestion(''); setHistory([]); setError(''); }, [file?.id]);
    if (!file) return null;
    const fail = (reason: any, fallback: string) => setError(reason?.response?.data?.detail || reason?.message || fallback);
    const ask = async () => {
        const value = question.trim(); if (value.length < 2) return;
        const previous = history.slice(-6); setHistory(items => [...items, {role:'user', content:value}]); setQuestion(''); setError('');
        try { const result = await askMutation.mutateAsync({id:file.id, question:value, history:previous}); setHistory(items => [...items, {role:'assistant', content:result.answer}]); }
        catch (reason) { fail(reason, 'پاسخ آماده نشد.'); }
    };
    return <ModalShell title="ابزارهای هوش مصنوعی" subtitle={file.file_name} icon={<Sparkles/>} onClose={()=>setAIToolsFile(null)} width="lg" bodyClassName="p-0 sm:p-0" zIndex={230}>
            <nav className="grid grid-cols-3 gap-1 border-b border-white/[.06] p-2">{([{id:'summary',label:'خلاصه'}, {id:'ask',label:'پرسش از فایل'}, {id:'metadata',label:'نام و تگ'}] as const).map(item=><button key={item.id} onClick={()=>{setTool(item.id);setError('')}} className={`min-h-10 rounded-xl text-xs ${tool===item.id?'bg-primary-500 text-white':'text-dark-300 hover:bg-white/[.05]'}`}>{item.label}</button>)}</nav>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {error&&<p className="mb-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs leading-6 text-red-300">{error}</p>}
                {tool==='summary'&&<div><button disabled={insightsMutation.isPending} onClick={async()=>{setError('');try{setInsights(await insightsMutation.mutateAsync(file.id))}catch(reason){fail(reason,'خلاصه آماده نشد.')}}} className="btn-primary w-full disabled:opacity-40">{insightsMutation.isPending?'در حال بررسی…':insights?'ساخت دوباره':'ساخت خلاصه و نکته‌های مهم'}</button>{insights&&<div className="mt-4 space-y-3"><div className="relative rounded-2xl bg-dark-800/65 p-4 pl-11"><p dir="auto" className="whitespace-pre-wrap text-sm leading-8">{insights.summary}</p><button onClick={()=>void navigator.clipboard.writeText([insights.summary,...insights.key_points].join('\n\n'))} className="btn-icon absolute left-2 top-2 h-8 w-8"><ClipboardCopy className="h-4 w-4"/></button></div><ul className="space-y-2">{insights.key_points.map((point,index)=><li key={index} className="flex gap-2 text-sm leading-7 text-dark-300"><span className="mt-3 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400"/>{point}</li>)}</ul></div>}</div>}
                {tool==='ask'&&<div><div className="max-h-[48dvh] space-y-2 overflow-y-auto">{history.length===0&&<div className="rounded-2xl border border-dashed border-white/10 p-8 text-center text-dark-500"><MessageCircle className="mx-auto mb-3 h-7 w-7"/><p className="text-sm">درباره محتوای همین فایل سؤال بپرس.</p></div>}{history.map((turn,index)=><div key={index} dir="auto" className={`max-w-[90%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-7 ${turn.role==='user'?'mr-auto bg-primary-500/15':'ml-auto bg-dark-800'}`}>{turn.content}</div>)}</div><div className="mt-3 flex items-end gap-2"><textarea value={question} onChange={event=>setQuestion(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();void ask()}}} className="input min-h-11 max-h-28 min-w-0 flex-1 resize-none" placeholder="سؤال را بنویس…"/><button disabled={askMutation.isPending||question.trim().length<2} onClick={()=>void ask()} className="btn-primary flex h-11 w-11 items-center justify-center p-0 disabled:opacity-40"><Send className="h-4 w-4"/></button></div></div>}
                {tool==='metadata'&&<div><button disabled={metadataMutation.isPending} onClick={async()=>{setError('');try{setSuggestion(await metadataMutation.mutateAsync(file.id))}catch(reason){fail(reason,'پیشنهاد آماده نشد.')}}} className="btn-primary w-full disabled:opacity-40">{metadataMutation.isPending?'در حال بررسی…':'پیشنهاد نام، توضیح و تگ'}</button>{suggestion&&<div className="mt-4 space-y-3"><label className="block text-xs text-dark-400">نام فایل<input dir="auto" value={suggestion.title} onChange={event=>setSuggestion({...suggestion,title:event.target.value})} className="input mt-1 w-full text-right"/></label><label className="block text-xs text-dark-400">توضیحات<textarea dir="auto" value={suggestion.description} onChange={event=>setSuggestion({...suggestion,description:event.target.value})} className="input mt-1 min-h-28 w-full resize-y text-right" maxLength={20000}/></label><label className="block text-xs text-dark-400">تگ‌ها<div className="relative mt-1"><Tags className="absolute right-3 top-3.5 h-4 w-4 text-dark-500"/><input value={suggestion.tags.join('، ')} onChange={event=>setSuggestion({...suggestion,tags:event.target.value.split(/[،,]+/).map(value=>value.trim()).filter(Boolean)})} className="input w-full pr-10"/></div></label><button disabled={updateFile.isPending} onClick={async()=>{try{const tags=[...(file.tags||[])];suggestion.tags.forEach(tag=>{if(!tags.some(value=>value.toLowerCase()===tag.toLowerCase()))tags.push(tag)});await updateFile.mutateAsync({id:file.id,file_name:suggestion.title,description:suggestion.description,tags});addToast('پیشنهادهای انتخاب‌شده ذخیره شد.');setAIToolsFile(null)}catch(reason){fail(reason,'ذخیره پیشنهادها انجام نشد.')}}} className="btn-primary flex w-full items-center justify-center gap-2 disabled:opacity-40"><Check className="h-4 w-4"/>ذخیره روی فایل</button></div>}</div>}
            </div>
    </ModalShell>;
}
