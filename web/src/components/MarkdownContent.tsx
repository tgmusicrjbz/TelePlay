import { Fragment, useEffect, useMemo, useState } from 'react';
import { Copy } from 'lucide-react';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import { api, TelegramFile } from '../lib/api';
import { useAppStore } from '../lib/store';
import { getMarkdownPalette, MarkdownPalette } from '../lib/markdownSettings';

type ReaderTone = string;
function inlineMarkdown(text: string) {
    return text.split(/(!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\)|<a\s+href=["'][^"']+["'][^>]*>.*?<\/a>|<(?:strong|b)>.*?<\/(?:strong|b)>|<(?:em|i)>.*?<\/(?:em|i)>|https?:\/\/[^\s<]+|\{\{[^{}]+\}\}|\$[^$\n]+\$|\*\*[^*]+\*\*|__[^_]+__|<u>.*?<\/u>|~~[^~]+~~|`[^`]+`|\*[^*]+\*)/gi).map((part, index) => {
        const image = part.match(/^!\[([^\]]*)\]\(([^)]+)\)$/); if (image) { const token=localStorage.getItem('access_token')||''; const source=image[2].startsWith('/api/')?`${image[2]}${image[2].includes('?')?'&':'?'}token=${encodeURIComponent(token)}`:image[2]; return <img key={index} src={source} alt={image[1]} loading="lazy" decoding="async" className="my-4 max-h-[70vh] max-w-full rounded-2xl border border-white/[.07] object-contain shadow-xl"/>; }
        const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/); if (link) {
            const internal=link[2].match(/^komod:\/\/file\/(\d+)$/i);
            if(internal)return <button type="button" key={index} onClick={()=>void openInternalFile(Number(internal[1]))} className="inline-flex max-w-full items-center gap-1 break-words font-medium text-primary-200 underline decoration-primary-400/40 underline-offset-4 transition hover:text-primary-100">{link[1]}</button>;
            return <a key={index} href={link[2]} target="_blank" rel="noreferrer" className="break-all font-medium text-sky-300 underline decoration-sky-500/40 underline-offset-4 transition hover:text-sky-200">{link[1]}</a>;
        }
        const htmlLink=part.match(/^<a\s+href=["']([^"']+)["'][^>]*>(.*?)<\/a>$/i); if(htmlLink)return <a key={index} href={htmlLink[1]} target="_blank" rel="noreferrer" className="break-words font-medium text-sky-300 underline decoration-sky-500/40 underline-offset-4 transition hover:text-sky-200">{htmlLink[2]}</a>;
        if(/^https?:\/\//i.test(part))return <a key={index} href={part} target="_blank" rel="noreferrer" className="break-all font-medium text-sky-300 underline decoration-sky-500/40 underline-offset-4 transition hover:text-sky-200">{part}</a>;
        const htmlStrong=part.match(/^<(?:strong|b)>(.*?)<\/(?:strong|b)>$/i); if(htmlStrong)return <strong key={index} className="font-extrabold text-amber-200">{htmlStrong[1]}</strong>;
        const htmlEmphasis=part.match(/^<(?:em|i)>(.*?)<\/(?:em|i)>$/i); if(htmlEmphasis)return <em key={index} className="text-violet-200">{htmlEmphasis[1]}</em>;
        if (part.startsWith('**') || part.startsWith('__')) return <strong key={index} className="font-extrabold text-amber-200">{part.slice(2, -2)}</strong>;
        if (part.startsWith('~~')) return <del key={index} className="text-rose-300/70 decoration-rose-400/70">{part.slice(2, -2)}</del>;
        if (part.startsWith('<u>')) return <u key={index} className="decoration-primary-400/70 decoration-2 underline-offset-4">{part.slice(3, -4)}</u>;
        if (part.startsWith('`')) return <code key={index} dir="ltr" className="mx-0.5 break-all rounded-md border border-cyan-400/15 bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[.9em] text-cyan-200">{part.slice(1, -1)}</code>;
        if (part.startsWith('{{')) return <span key={index} dir="ltr" className="mx-1 inline-flex rounded-md border border-fuchsia-400/20 bg-fuchsia-400/10 px-1.5 py-0.5 font-mono text-[.9em] text-fuchsia-200">{part.slice(2, -2)}</span>;
        if (part.startsWith('$')) return <MathFormula key={index} source={part.slice(1, -1)}/>;
        if (part.startsWith('*')) return <em key={index} className="text-violet-200">{part.slice(1, -1)}</em>;
        return <Fragment key={index}>{part}</Fragment>;
    });
}

export function MarkdownInline({content}:{content:string}) {
    return <>{content.split(/\r?\n/).map((line,index)=><Fragment key={index}>{index>0&&<br/>}{inlineMarkdown(line)}</Fragment>)}</>;
}

async function openInternalFile(id:number) {
    const store=useAppStore.getState();
    try {
        const {data}=await api.get<TelegramFile>(`/files/${id}`);
        if(data.file_type==='audio'||data.file_type==='video')store.setPreviewFile(data);
        else store.openLinkedContentFile(data);
    } catch {
        store.addToast('این فایل پیدا نشد یا دیگر به آن دسترسی نداری.','error');
    }
}

function MathFormula({source,displayMode=false}:{source:string;displayMode?:boolean}) {
    const html = useMemo(() => katex.renderToString(source, { displayMode, throwOnError: false, strict: 'warn', trust: false }), [displayMode, source]);
    return <span dir="ltr" className={displayMode?'my-5 block max-w-full overflow-x-auto rounded-xl bg-white/[.025] p-4 text-center':'inline-block max-w-full overflow-x-auto align-middle'} dangerouslySetInnerHTML={{__html:html}}/>;
}

const languageAliases:Record<string,string>={
    js:'javascript',jsx:'javascript',ts:'typescript',tsx:'typescript',py:'python',sh:'bash',shell:'bash',zsh:'bash',
    cs:'csharp','c#':'csharp',htm:'html',yml:'yaml',jsonc:'json',
};
const languageLabels:Record<string,string>={javascript:'JavaScript',typescript:'TypeScript',python:'Python',bash:'Bash',c:'C',csharp:'C#',html:'HTML',css:'CSS',json:'JSON',yaml:'YAML',xml:'XML'};
const commonKeywords=new Set('as async await break case catch class const continue default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch throw try typeof var void while with yield true false null undefined'.split(' '));
const languageKeywords:Record<string,Set<string>>={
    javascript:commonKeywords,
    typescript:new Set([...commonKeywords,...'abstract any boolean declare enum implements interface keyof namespace never number private protected public readonly string type unknown'.split(' ')]),
    python:new Set('and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield'.split(' ')),
    bash:new Set('case do done elif else esac export fi for function if in local readonly return select then time until while'.split(' ')),
    c:new Set('auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while _Bool _Complex _Imaginary'.split(' ')),
    csharp:new Set('abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly record ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while async await var'.split(' ')),
    json:new Set(['true','false','null']), yaml:new Set(['true','false','null','yes','no','on','off']),
};

function normalizeLanguage(language='') {
    const clean=language.toLowerCase().trim().replace(/^language-/,'');
    return languageAliases[clean]||clean;
}

function highlightedCode(code:string,language?:string) {
    const normalized=normalizeLanguage(language);
    const hashComments=['python','bash','yaml'].includes(normalized);
    const expression=new RegExp(`(<!--[\\s\\S]*?-->|\\/\\*[\\s\\S]*?\\*\\/|\\/\\/[^\\n]*${hashComments?'|#[^\\n]*':''}|\`(?:\\\\.|[^\`\\\\])*\`|"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|@?[A-Za-z_$][\\w$-]*|\\b\\d+(?:\\.\\d+)?\\b|[{}\\[\\]();,.<>:=+\\-*\\/%!&|?]+)`,'g');
    const nodes:JSX.Element[]=[];
    let cursor=0;
    let match:RegExpExecArray|null;
    while((match=expression.exec(code))!==null){
        if(match.index>cursor)nodes.push(<span key={`plain-${cursor}`}>{code.slice(cursor,match.index)}</span>);
        const token=match[0];
        const rest=code.slice(expression.lastIndex);
        const before=code.slice(0,match.index);
        let kind='plain';
        if(token.startsWith('//')||token.startsWith('/*')||token.startsWith('<!--')||(hashComments&&token.startsWith('#')))kind='comment';
        else if(/^['"`]/.test(token))kind='string';
        else if(/^\d/.test(token))kind='number';
        else if((languageKeywords[normalized]||commonKeywords).has(token))kind='keyword';
        else if(['true','false','null','undefined','None','True','False'].includes(token))kind='constant';
        else if(['html','xml'].includes(normalized)&&(/<\/?\s*$/.test(before)||/^\s*=/.test(rest)))kind=/^\s*=/.test(rest)?'attribute':'tag';
        else if(['json','yaml'].includes(normalized)&&/^\s*:/.test(rest))kind='property';
        else if(normalized==='css'&&(/^\s*:/.test(rest)||token.startsWith('@')))kind=token.startsWith('@')?'keyword':'property';
        else if(/^\s*\(/.test(rest))kind='function';
        else if(/^[{}[\]();,.<>:=+\-*/%!&|?]+$/.test(token))kind='operator';
        nodes.push(<span key={`token-${match.index}`} className={`syntax-${kind}`}>{token}</span>);
        cursor=expression.lastIndex;
    }
    if(cursor<code.length)nodes.push(<span key={`plain-${cursor}`}>{code.slice(cursor)}</span>);
    return {nodes,normalized,label:languageLabels[normalized]||language||'Code'};
}

function MarkdownCodeBlock({ code, language }: { code: string; language?: string }) {
    const [copied, setCopied] = useState(false);
    const highlighted=useMemo(()=>highlightedCode(code,language),[code,language]);
    const copy = async () => {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
    };
    return <div dir="ltr" className="my-5 min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-700/70 bg-[#10141d] shadow-[0_14px_36px_rgba(0,0,0,.22)]">
        <div className="grid min-w-0 grid-cols-[auto_1fr_auto] items-center gap-3 border-b border-white/[.06] bg-white/[.035] px-3 py-2">
            <div className="flex items-center gap-1.5" aria-hidden="true"><span className="h-2.5 w-2.5 rounded-full bg-rose-400/80"/><span className="h-2.5 w-2.5 rounded-full bg-amber-300/80"/><span className="h-2.5 w-2.5 rounded-full bg-emerald-400/80"/></div>
            <span className="min-w-0 truncate text-center font-mono text-[11px] tracking-wider text-slate-400">{highlighted.label}</span>
            <button dir="rtl" onClick={() => void copy()} className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] text-dark-300 transition hover:bg-white/[.06] hover:text-white"><Copy className="h-3.5 w-3.5"/>{copied ? 'کپی شد' : 'کپی'}</button>
        </div>
        <div className="max-w-full overflow-x-auto overscroll-x-contain">
            <pre className="m-0 w-max min-w-full whitespace-pre p-4 text-left font-mono text-sm leading-7 text-slate-200 selection:bg-primary-400/25" style={{ tabSize: 4 }}><code className={`syntax-highlight language-${highlighted.normalized||'plain'} block`}>{highlighted.nodes}</code></pre>
        </div>
    </div>;
}

export default function MarkdownContent({ content, fontSize = 15, lineHeight = 2, theme = 'dark', fontFamily = 'vazir', wrap = true, wide = false, align = 'right', direction = 'rtl', customPalette }: { content: string; fontSize?: number; lineHeight?: number; theme?: ReaderTone; fontFamily?: string; wrap?: boolean; wide?: boolean; align?: 'right' | 'left' | 'center' | 'justify'; direction?:'rtl'|'ltr'; customPalette?:MarkdownPalette }) {
    const [,setThemeRevision]=useState(0);
    useEffect(()=>{
        const refresh=()=>setThemeRevision(value=>value+1);
        window.addEventListener('komod-markdown-themes-changed',refresh);
        return()=>window.removeEventListener('komod-markdown-themes-changed',refresh);
    },[]);
    const normalizedContent=useMemo(()=>content
        .replace(/<h([1-6])>(.*?)<\/h\1>/gi,(_,level,text)=>`${'#'.repeat(Number(level))} ${text}`)
        .replace(/<(?:strong|b)>(.*?)<\/(?:strong|b)>/gi,'**$1**')
        .replace(/<(?:em|i)>(.*?)<\/(?:em|i)>/gi,'*$1*')
        .replace(/<u>(.*?)<\/u>/gi,'[$1](komod-style://underline)')
        .replace(/<a\s+href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gi,'[$2]($1)'),[content]);
    const palette=customPalette||getMarkdownPalette(theme);
    const paletteStyle=palette?({
        '--md-background':palette.background,'--md-surface':palette.surface,'--md-text':palette.text,'--md-border':palette.border,
        '--md-h1':palette.heading1,'--md-h2':palette.heading2,'--md-h3':palette.heading3,'--md-bold':palette.bold,'--md-italic':palette.italic,
        '--md-link':palette.link,'--md-quote':palette.quote,'--md-formula':palette.formula,'--md-inline-code':palette.inlineCodeText,
        '--md-inline-code-bg':palette.inlineCodeBackground,'--md-code':palette.codeText,'--md-code-bg':palette.codeBackground,
    } as React.CSSProperties):undefined;
    return <div className={`markdown-reader-canvas ${palette?'markdown-reader-canvas--custom p-2 sm:p-3':''} mx-auto w-full ${wide?'max-w-none':'max-w-3xl'} overflow-hidden rounded-2xl transition-colors`} style={paletteStyle}>
        <article dir={direction} className={`markdown-article ${palette?'markdown-article--custom':`markdown-article--${theme}`} markdown-font--${fontFamily} w-full max-w-none overflow-hidden rounded-2xl border p-4 shadow-inner transition-colors sm:p-6 ${wrap ? 'break-words' : 'overflow-x-auto whitespace-pre'}`} style={{fontSize, lineHeight, textAlign: align}}>
            <ReactMarkdown
                remarkPlugins={[remarkGfm,remarkMath,remarkBreaks]}
                rehypePlugins={[rehypeKatex]}
                urlTransform={(url)=>/^(?:komod:\/\/file\/\d+|komod-style:\/\/underline)$/i.test(url)?url:defaultUrlTransform(url)}
                components={{
                    h1:({children})=><h1 className="mb-2 mt-7 break-words border-b border-white/[.05] pb-2 text-3xl font-black leading-tight text-primary-200">{children}</h1>,
                    h2:({children})=><h2 className="mb-2 mt-7 break-words border-b border-white/[.05] pb-2 text-2xl font-black leading-tight text-sky-200">{children}</h2>,
                    h3:({children})=><h3 className="mb-2 mt-7 break-words border-b border-white/[.05] pb-2 text-xl font-black leading-tight text-violet-200">{children}</h3>,
                    h4:({children})=><h4 className="mb-2 mt-7 break-words border-b border-white/[.05] pb-2 text-lg font-black leading-tight text-emerald-200">{children}</h4>,
                    p:({children})=><p className="my-2 whitespace-pre-wrap break-words">{children}</p>,
                    a:({href='',children})=>{if(href==='komod-style://underline')return <u className="decoration-primary-400/70 decoration-2 underline-offset-4">{children}</u>;const internal=href.match(/^komod:\/\/file\/(\d+)$/i);return internal?<button type="button" onClick={()=>void openInternalFile(Number(internal[1]))} className="inline-flex max-w-full items-center gap-1 break-words font-medium text-primary-200 underline decoration-primary-400/40 underline-offset-4">{children}</button>:<a href={href} target="_blank" rel="noreferrer" className="break-all font-medium text-sky-300 underline decoration-sky-500/40 underline-offset-4">{children}</a>},
                    img:({src='',alt=''})=>{const token=localStorage.getItem('access_token')||'';const source=src.startsWith('/api/')?`${src}${src.includes('?')?'&':'?'}token=${encodeURIComponent(token)}`:src;return <img src={source} alt={alt} loading="lazy" decoding="async" className="my-4 max-h-[70vh] max-w-full rounded-2xl border border-white/[.07] object-contain shadow-xl"/>},
                    pre:({children})=><>{children}</>,
                    code:({className,children})=>{const raw=String(children);const language=className?.replace(/^language-/,'');if(className||raw.includes('\n'))return <MarkdownCodeBlock code={raw.replace(/\n$/,'')} language={language}/>;return <code dir="ltr" className="mx-0.5 break-all rounded-md border border-cyan-400/15 bg-cyan-400/10 px-1.5 py-0.5 font-mono text-[.9em] text-cyan-200">{children}</code>},
                    blockquote:({children})=><blockquote className="my-3 rounded-l-xl border-r-4 border-violet-400/60 bg-violet-400/[.07] px-4 py-2 italic text-violet-100/90">{children}</blockquote>,
                    ul:({children,className})=><ul className={`my-3 list-disc space-y-1 pr-6 marker:text-primary-300 ${className||''}`}>{children}</ul>,
                    ol:({children})=><ol className="my-3 list-decimal space-y-1 pr-7 marker:font-bold marker:text-primary-200">{children}</ol>,
                    li:({children,className})=><li className={`break-words pr-1 ${className||''}`}>{children}</li>,
                    table:({children})=><div className="my-5 max-w-full overflow-x-auto rounded-2xl border border-white/[.08] shadow-lg"><table className="w-full min-w-max border-collapse text-sm">{children}</table></div>,
                    thead:({children})=><thead className="bg-primary-500/12 text-primary-100">{children}</thead>,
                    tr:({children})=><tr className="border-t border-white/[.06] odd:bg-white/[.018]">{children}</tr>,
                    th:({children})=><th className="min-w-32 border-l border-white/[.07] px-4 py-3 text-right font-bold last:border-l-0">{children}</th>,
                    td:({children})=><td className="max-w-sm break-words border-l border-white/[.05] px-4 py-3 align-top last:border-l-0">{children}</td>,
                    hr:()=> <div className="my-7 h-px bg-gradient-to-r from-transparent via-primary-400/45 to-transparent"/>,
                }}
            >{normalizedContent}</ReactMarkdown>
        </article>
    </div>;
}
