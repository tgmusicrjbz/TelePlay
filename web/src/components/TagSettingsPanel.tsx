import { useEffect, useMemo, useState } from 'react';
import { Ban, Check, ChevronDown, ChevronLeft, ChevronRight, FileText, FolderClosed, Pencil, Plus, Search, Tags, Trash2, X } from 'lucide-react';
import { TagDefinition, getFileIcon, useDeleteTag, useFiles, useTagSettings, useUpdateFile, useUpdateTagSettings } from '../lib/api';
import CustomSelect from './CustomSelect';

const typeOptions = [{value:'',label:'همهٔ نوع‌ها'},{value:'audio',label:'صدا'},{value:'video',label:'ویدیو'},{value:'image',label:'عکس'},{value:'text',label:'متن'},{value:'document',label:'فایل'}];
const sortOptions = [{value:'created:desc',label:'تازه‌ترین'},{value:'created:asc',label:'قدیمی‌ترین'},{value:'name:asc',label:'نام؛ صعودی'},{value:'name:desc',label:'نام؛ نزولی'},{value:'size:desc',label:'بزرگ‌ترین'},{value:'size:asc',label:'کوچک‌ترین'}];

export default function TagSettingsPanel({activeSection}:{activeSection?:string|null}) {
    const {data,isLoading}=useTagSettings();
    const update=useUpdateTagSettings();
    const deleteTag=useDeleteTag();
    const updateFile=useUpdateFile();
    const [tags,setTags]=useState<TagDefinition[]>([]);
    const [excludedTags,setExcludedTags]=useState<string[]>([]);
    const [excludedInput,setExcludedInput]=useState('');
    const [name,setName]=useState('');
    const [color,setColor]=useState('#a855f7');
    const [category,setCategory]=useState('');
    const [editing,setEditing]=useState<string|null>(null);
    const [show,setShow]=useState(false);
    const [limit,setLimit]=useState(2);
    const [collapsed,setCollapsed]=useState<Set<string>>(new Set());
    const [activeTag,setActiveTag]=useState<TagDefinition|null>(null);
    const [query,setQuery]=useState('');
    const [type,setType]=useState('');
    const [sort,setSort]=useState('created:desc');
    const [page,setPage]=useState(1);
    const [deletingTag,setDeletingTag]=useState<TagDefinition|null>(null);
    const [deleteError,setDeleteError]=useState('');
    const tagSearch=useMemo(()=>activeTag?`#${activeTag.name}${query.trim()?`,`+query.trim():''}`:'__no_tag_selected__',[activeTag,query]);
    const groupedTags=useMemo(()=>{
        const groups=new Map<string,TagDefinition[]>();
        [...tags].sort((a,b)=>a.name.localeCompare(b.name,'fa')).forEach(tag=>{
            const group=tag.category?.trim()||'بدون دسته';
            groups.set(group,[...(groups.get(group)||[]),tag]);
        });
        return [...groups.entries()].sort(([a],[b])=>a==='بدون دسته'?1:b==='بدون دسته'?-1:a.localeCompare(b,'fa'));
    },[tags]);
    const categoryOptions=useMemo(()=>[...new Set(tags.map(tag=>tag.category?.trim()).filter(Boolean) as string[])].sort((a,b)=>a.localeCompare(b,'fa')),[tags]);
    const {data:tagFiles,isLoading:filesLoading}=useFiles(undefined,type||undefined,tagSearch,page,sort);

    useEffect(()=>{if(data){setTags(data.tags);setExcludedTags(data.excluded_tags||[]);setShow(data.show_file_tags);setLimit(data.display_limit)}},[data]);
    useEffect(()=>setPage(1),[activeTag,query,type,sort]);

    const save=async(next=tags,nextShow=show,nextLimit=limit,nextExcluded=excludedTags)=>{
        const result=await update.mutateAsync({tags:next.map(({name,color,category})=>({name,color,category:category||''})),excluded_tags:nextExcluded,show_file_tags:nextShow,display_limit:nextLimit});
        setTags(result.tags);setExcludedTags(result.excluded_tags||[]);setShow(result.show_file_tags);setLimit(result.display_limit);
    };
    const add=()=>{
        const clean=name.trim().replace(/^#/,'').slice(0,40);if(!clean)return;
        const next=[...tags.filter(tag=>tag.name.toLocaleLowerCase('fa')!==clean.toLocaleLowerCase('fa')),{name:clean,color,category:category.trim().slice(0,40),file_count:editing?tags.find(tag=>tag.name===editing)?.file_count||0:0}];
        void save(next);setName('');setCategory('');setEditing(null);
    };
    const beginEdit=(tag:TagDefinition)=>{setEditing(tag.name);setName(tag.name);setColor(tag.color);setCategory(tag.category||'')};
    const addExclusion=()=>{
        const clean=excludedInput.trim().replace(/^#/,'').slice(0,40);if(!clean)return;
        const next=[...excludedTags.filter(tag=>tag.toLocaleLowerCase('fa')!==clean.toLocaleLowerCase('fa')),clean];
        setExcludedTags(next);setExcludedInput('');void save(tags,show,limit,next);
    };
    const removeExclusion=(value:string)=>{const next=excludedTags.filter(tag=>tag!==value);setExcludedTags(next);void save(tags,show,limit,next)};
    const removeTagFromFile=async(fileId:number,fileTags:string[]=[])=>{if(activeTag)await updateFile.mutateAsync({id:fileId,tags:fileTags.filter(item=>item.toLocaleLowerCase('fa')!==activeTag.name.toLocaleLowerCase('fa'))})};
    const toggleCategory=(value:string)=>setCollapsed(current=>{const next=new Set(current);next.has(value)?next.delete(value):next.add(value);return next});
    const confirmDeleteTag=async()=>{
        if(!deletingTag)return;
        setDeleteError('');
        try {
            const result=await deleteTag.mutateAsync(deletingTag.name);
            setTags(result.tags); setDeletingTag(null);
            if(activeTag?.name===deletingTag.name)setActiveTag(null);
        } catch(error:any) {
            setDeleteError(error?.response?.data?.detail||'حذف تگ انجام نشد. دوباره تلاش کن.');
        }
    };

    return <div className="space-y-4">
        {(!activeSection||activeSection==='tags-library')&&<>
            <section id="tags-library" className="scroll-mt-24 rounded-3xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5">
                <div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary-500/15 text-primary-200"><Tags className="h-5 w-5"/></span><div><h2 className="font-bold">تگ‌های من</h2><p className="text-xs text-dark-400">تگ‌ها را داخل دسته‌های دلخواهت مرتب کن.</p></div></div>
                <div className="mt-4 flex flex-wrap items-center gap-2"><label className="relative h-11 w-11 shrink-0 overflow-hidden rounded-xl border border-white/15" style={{backgroundColor:color}}><input type="color" value={color} onChange={event=>setColor(event.target.value)} className="absolute inset-[-10px] h-16 w-16 cursor-pointer opacity-0"/></label><input value={name} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')add()}} className="input min-w-[9rem] flex-1" placeholder="نام تگ"/><input list="tag-category-list" value={category} onChange={event=>setCategory(event.target.value)} className="input min-w-[9rem] flex-1" placeholder="نام دسته"/><datalist id="tag-category-list">{categoryOptions.map(item=><option key={item} value={item}/>)}</datalist><button className="btn-primary flex h-11 items-center gap-1.5 px-3" onClick={add}>{editing?<Check className="h-4 w-4"/>:<Plus className="h-4 w-4"/>}<span className="hidden sm:inline">{editing?'ذخیره':'افزودن'}</span></button>{editing&&<button className="btn-icon" onClick={()=>{setEditing(null);setName('');setCategory('')}}><X className="h-4 w-4"/></button>}</div>
                {isLoading?<p className="mt-4 text-sm text-dark-500">در حال دریافت…</p>:tags.length===0?<p className="mt-4 rounded-2xl bg-white/[.035] p-4 text-center text-sm text-dark-500">هنوز تگی نساختی.</p>:<div className="mt-4 space-y-3">{groupedTags.map(([group,items])=><section key={group} className="overflow-hidden rounded-2xl border border-white/[.06] bg-dark-800/35"><button onClick={()=>toggleCategory(group)} className="flex min-h-12 w-full items-center gap-2 px-3 text-right"><FolderClosed className="h-4 w-4 text-primary-300"/><strong className="min-w-0 flex-1 truncate text-sm">{group}</strong><span className="rounded-full bg-white/[.05] px-2 py-0.5 text-[10px] text-dark-400">{items.length.toLocaleString('fa-IR')} تگ</span><ChevronDown className={`h-4 w-4 text-dark-500 transition ${collapsed.has(group)?'rotate-90':''}`}/></button>{!collapsed.has(group)&&<div className="grid gap-2 border-t border-white/[.05] p-2 sm:grid-cols-2">{items.map(tag=><div key={tag.name} className="flex items-center gap-2 rounded-xl bg-dark-900/55 p-2"><button onClick={()=>setActiveTag(tag)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-right transition hover:bg-white/[.04]"><span className="h-3 w-3 shrink-0 rounded-full" style={{backgroundColor:tag.color}}/><span className="min-w-0 flex-1 truncate text-sm">#{tag.name}</span><span className="rounded-full bg-white/[.05] px-2 py-1 text-[10px] text-dark-400">{(tag.file_count||0).toLocaleString('fa-IR')}</span></button><button className="btn-icon h-8 w-8" onClick={()=>beginEdit(tag)} aria-label="ویرایش تگ"><Pencil className="h-3.5 w-3.5"/></button><button className="flex h-8 items-center gap-1 rounded-lg px-2 text-[10px] text-red-300 transition hover:bg-red-500/10" onClick={()=>{setDeleteError('');setDeletingTag(tag)}} aria-label="حذف تگ از همه فایل‌ها"><Trash2 className="h-3.5 w-3.5"/><span>حذف</span></button></div>)}</div>}</section>)}</div>}
            </section>
            <section className="rounded-3xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-300"><Ban className="h-5 w-5"/></span><div><h2 className="font-bold">استثناهای تشخیص خودکار</h2><p className="text-xs text-dark-400">این واژه‌ها اگر در توضیحات باشند، خودکار به تگ تبدیل نمی‌شوند.</p></div></div><div className="mt-4 flex gap-2"><input value={excludedInput} onChange={event=>setExcludedInput(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();addExclusion()}}} className="input min-w-0 flex-1" placeholder="مثلاً تبلیغ"/><button onClick={addExclusion} className="btn-secondary min-h-11 px-4">افزودن</button></div>{excludedTags.length>0&&<div className="mt-3 flex flex-wrap gap-2">{excludedTags.map(tag=><span key={tag} className="flex items-center gap-1 rounded-full border border-amber-400/15 bg-amber-500/[.07] py-1 pr-3 pl-1 text-xs text-amber-100">#{tag}<button onClick={()=>removeExclusion(tag)} className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-white/10" aria-label={`حذف ${tag}`}><X className="h-3 w-3"/></button></span>)}</div>}</section>
        </>}
        {(!activeSection||activeSection==='tags-display')&&<section id="tags-display" className="scroll-mt-24 rounded-3xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5"><h2 className="font-bold">نمایش زیر فایل‌ها</h2><button type="button" onClick={()=>{const next=!show;setShow(next);void save(tags,next,limit)}} className="mt-4 flex w-full items-center justify-between rounded-2xl bg-dark-800/55 p-3 text-right"><span className="text-sm">نمایش تگ‌ها روی کارت فایل</span><span className={`relative h-7 w-12 rounded-full p-1 transition ${show?'bg-primary-500':'bg-dark-700'}`}><span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${show?'-translate-x-5':'translate-x-0'}`}/></span></button><CustomSelect className="mt-3" label="حداکثر تعداد قابل نمایش" value={limit} onChange={value=>{setLimit(Number(value));void save(tags,show,Number(value))}} options={[1,2,3,4,5,6].map(value=>({value,label:`${value.toLocaleString('fa-IR')} تگ`}))}/></section>}
        {activeTag&&<div className="fixed inset-0 z-[210] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-5" onClick={()=>setActiveTag(null)}><section className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-dark-900 shadow-2xl sm:rounded-3xl" onClick={event=>event.stopPropagation()}><header className="flex items-center gap-3 border-b border-white/[.07] p-4"><span className="h-4 w-4 rounded-full" style={{backgroundColor:activeTag.color}}/><div className="min-w-0 flex-1"><h2 className="truncate font-bold">#{activeTag.name}</h2><p className="text-xs text-dark-400">فایل‌های این تگ را پیدا یا از تگ خارج کن.</p></div><button className="btn-icon" onClick={()=>setActiveTag(null)}><X className="h-5 w-5"/></button></header><div className="grid gap-2 border-b border-white/[.06] p-3 sm:grid-cols-[1fr_10rem_11rem]"><label className="relative"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-500"/><input className="input w-full !pr-10" value={query} onChange={event=>setQuery(event.target.value)} placeholder="جست‌وجو"/></label><CustomSelect value={type} onChange={setType} options={typeOptions}/><CustomSelect value={sort} onChange={setSort} options={sortOptions}/></div><div className="min-h-0 flex-1 overflow-y-auto p-3">{filesLoading?<p className="p-8 text-center text-sm text-dark-500">در حال دریافت…</p>:tagFiles?.files.length?tagFiles.files.map(file=><article key={file.id} className="mb-2 flex items-center gap-3 rounded-2xl bg-white/[.035] p-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[.05] text-lg">{getFileIcon(file.file_type)}</span><span className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm">{file.file_name}</strong><small className="text-dark-500">{file.file_type==='audio'?'صدا':file.file_type==='video'?'ویدیو':file.file_type==='image'?'عکس':file.file_type==='text'?'متن':'فایل'}</small></span><button disabled={updateFile.isPending} onClick={()=>void removeTagFromFile(file.id,file.tags)} className="btn-secondary flex min-h-9 items-center gap-1 px-2.5 text-xs text-red-300"><X className="h-3.5 w-3.5"/>حذف تگ</button></article>):<div className="p-10 text-center text-dark-500"><FileText className="mx-auto mb-3 h-8 w-8"/><p className="text-sm">فایلی پیدا نشد.</p></div>}</div>{tagFiles&&tagFiles.total>tagFiles.per_page&&<footer className="flex items-center justify-center gap-3 border-t border-white/[.07] p-3"><button disabled={page<=1} className="btn-icon disabled:opacity-30" onClick={()=>setPage(value=>value-1)}><ChevronRight className="h-4 w-4"/></button><span className="text-xs text-dark-400">صفحه {page.toLocaleString('fa-IR')}</span><button disabled={page*tagFiles.per_page>=tagFiles.total} className="btn-icon disabled:opacity-30" onClick={()=>setPage(value=>value+1)}><ChevronLeft className="h-4 w-4"/></button></footer>}</section></div>}
        {deletingTag&&<div className="fixed inset-0 z-[230] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" onClick={()=>setDeletingTag(null)}><section dir="rtl" className="w-full max-w-sm rounded-3xl border border-white/10 bg-dark-900 p-5 text-right shadow-2xl" onClick={event=>event.stopPropagation()}><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/10 text-red-300"><Trash2 className="h-5 w-5"/></span><h3 className="mt-4 font-bold">حذف #{deletingTag.name}؟</h3><p className="mt-2 text-sm leading-6 text-dark-400">این تگ از فهرست و از روی تمام فایل‌هایی که دارند برداشته می‌شود.</p>{deleteError&&<p className="mt-3 rounded-xl bg-red-500/10 p-2.5 text-xs text-red-300">{deleteError}</p>}<div className="mt-5 flex gap-2"><button disabled={deleteTag.isPending} className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-red-500 px-4 text-sm font-semibold text-white disabled:opacity-50" onClick={()=>void confirmDeleteTag()}>{deleteTag.isPending?'در حال حذف…':'حذف تگ'}</button><button className="btn-secondary flex-1" onClick={()=>setDeletingTag(null)}>بی‌خیال</button></div></section></div>}
    </div>;
}
