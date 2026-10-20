import { useEffect, useMemo, useState } from 'react';
import { Ban, Check, CheckCircle2, CheckSquare, ChevronDown, ChevronLeft, ChevronRight, Circle, FileText, FolderClosed, FolderInput, Pencil, Plus, Search, Square, Tags, Trash2, X } from 'lucide-react';
import { TagDefinition, getFileIcon, useBatchUpdateFiles, useDeleteTag, useDeleteTags, useFiles, useTagSettings, useUpdateFile, useUpdateTagSettings } from '../lib/api';
import CustomSelect from './CustomSelect';

const typeOptions = [{value:'',label:'همهٔ نوع‌ها'},{value:'audio',label:'صدا'},{value:'video',label:'ویدیو'},{value:'image',label:'عکس'},{value:'text',label:'متن'},{value:'document',label:'فایل'}];
const sortOptions = [{value:'created:desc',label:'تازه‌ترین'},{value:'created:asc',label:'قدیمی‌ترین'},{value:'name:asc',label:'نام؛ صعودی'},{value:'name:desc',label:'نام؛ نزولی'},{value:'size:desc',label:'بزرگ‌ترین'},{value:'size:asc',label:'کوچک‌ترین'}];

export default function TagSettingsPanel({activeSection}:{activeSection?:string|null}) {
    const {data,isLoading}=useTagSettings();
    const update=useUpdateTagSettings();
    const deleteTag=useDeleteTag();
    const deleteTags=useDeleteTags();
    const batchUpdate=useBatchUpdateFiles();
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
    const [selectedTags,setSelectedTags]=useState<Set<string>>(new Set());
    const [batchCategory,setBatchCategory]=useState('');
    const [selectedFileIds,setSelectedFileIds]=useState<Set<number>>(new Set());
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
    useEffect(()=>{setPage(1);setSelectedFileIds(new Set())},[activeTag,query,type,sort]);

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
    const toggleTagSelection=(name:string)=>setSelectedTags(current=>{const next=new Set(current);next.has(name)?next.delete(name):next.add(name);return next});
    const toggleFileSelection=(id:number)=>setSelectedFileIds(current=>{const next=new Set(current);next.has(id)?next.delete(id):next.add(id);return next});
    const deleteSelectedTags=async()=>{if(!selectedTags.size)return;const result=await deleteTags.mutateAsync([...selectedTags]);setTags(result.tags);setSelectedTags(new Set())};
    const moveSelectedTags=async()=>{if(!selectedTags.size)return;const next=tags.map(tag=>selectedTags.has(tag.name)?{...tag,category:batchCategory.trim().slice(0,40)}:tag);await save(next);setSelectedTags(new Set());setBatchCategory('')};
    const removeTagFromSelected=async()=>{if(!activeTag||!selectedFileIds.size)return;await batchUpdate.mutateAsync({ids:[...selectedFileIds],tags_remove:[activeTag.name]});setSelectedFileIds(new Set())};
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
                <div className="mt-4 flex items-start gap-2"><div className="flex shrink-0 flex-col gap-2"><label className="relative h-11 w-11 overflow-hidden rounded-xl border border-white/15" style={{backgroundColor:color}} title="انتخاب رنگ"><input type="color" value={color} onChange={event=>setColor(event.target.value)} className="absolute inset-[-10px] h-16 w-16 cursor-pointer opacity-0"/></label><button className="btn-primary flex h-11 w-11 items-center justify-center p-0" onClick={add} title={editing?'ذخیره تغییرات':'افزودن تگ'}>{editing?<Check className="h-4 w-4"/>:<Plus className="h-4 w-4"/>}</button></div><div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2"><input value={name} onChange={event=>setName(event.target.value)} onKeyDown={event=>{if(event.key==='Enter')add()}} className="input min-w-0" placeholder="نام تگ"/><input list="tag-category-list" value={category} onChange={event=>setCategory(event.target.value)} className="input min-w-0" placeholder="نام دسته"/><datalist id="tag-category-list">{categoryOptions.map(item=><option key={item} value={item}/>)}</datalist>{editing&&<button className="btn-secondary min-h-11 sm:col-span-2" onClick={()=>{setEditing(null);setName('');setCategory('')}}><X className="h-4 w-4"/> لغو ویرایش</button>}</div></div>
                {selectedTags.size>0&&<div className="mt-4 rounded-2xl border border-primary-400/15 bg-primary-500/[.06] p-2.5"><div className="flex items-center gap-2"><span className="min-w-0 flex-1 text-xs text-primary-100">{selectedTags.size.toLocaleString('fa-IR')} تگ انتخاب شده</span><button disabled={deleteTags.isPending} onClick={()=>void deleteSelectedTags()} className="btn-icon h-9 w-9 text-red-300" title="حذف تگ‌های انتخاب‌شده"><Trash2 className="h-4 w-4"/></button><button className="btn-icon h-9 w-9" onClick={()=>setSelectedTags(new Set())}><X className="h-4 w-4"/></button></div><div className="mt-2 flex gap-2"><input list="tag-category-list" value={batchCategory} onChange={event=>setBatchCategory(event.target.value)} className="input h-10 min-w-0 flex-1 text-xs" placeholder="دستهٔ موجود یا دستهٔ تازه"/><button disabled={update.isPending} onClick={()=>void moveSelectedTags()} className="flex min-h-10 shrink-0 items-center gap-1.5 rounded-xl bg-primary-500 px-3 text-xs font-semibold text-white"><FolderInput className="h-4 w-4"/>انتقال</button></div></div>}
                {isLoading?<p className="mt-4 text-sm text-dark-500">در حال دریافت…</p>:tags.length===0?<p className="mt-4 rounded-2xl bg-white/[.035] p-4 text-center text-sm text-dark-500">هنوز تگی نساختی.</p>:<div className="mt-4 space-y-3">{groupedTags.map(([group,items])=><section key={group} className="overflow-hidden rounded-2xl border border-white/[.06] bg-dark-800/35"><button onClick={()=>toggleCategory(group)} className="flex min-h-12 w-full items-center gap-2 px-3 text-right"><FolderClosed className="h-4 w-4 text-primary-300"/><strong className="min-w-0 flex-1 truncate text-sm">{group}</strong><span className="rounded-full bg-white/[.05] px-2 py-0.5 text-[10px] text-dark-400">{items.length.toLocaleString('fa-IR')} تگ</span><ChevronDown className={`h-4 w-4 text-dark-500 transition ${collapsed.has(group)?'rotate-90':''}`}/></button>{!collapsed.has(group)&&<div className="grid gap-2 border-t border-white/[.05] p-2 sm:grid-cols-2">{items.map(tag=><div key={tag.name} className={`flex items-center gap-1 rounded-xl p-2 ${selectedTags.has(tag.name)?'bg-primary-500/10 ring-1 ring-primary-400/25':'bg-dark-900/55'}`}><button className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition ${selectedTags.has(tag.name)?'bg-primary-500/15 text-primary-200':'text-dark-500 hover:bg-white/[.05] hover:text-dark-300'}`} onClick={()=>toggleTagSelection(tag.name)} aria-label={`انتخاب ${tag.name}`}>{selectedTags.has(tag.name)?<CheckCircle2 className="h-4 w-4"/>:<Circle className="h-4 w-4"/>}</button><button onClick={()=>setActiveTag(tag)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg p-1 text-right transition hover:bg-white/[.04]"><span className="h-3 w-3 shrink-0 rounded-full" style={{backgroundColor:tag.color}}/><span className="min-w-0 flex-1 truncate text-sm">#{tag.name}</span><span className="rounded-full bg-white/[.05] px-2 py-1 text-[10px] text-dark-400">{(tag.file_count||0).toLocaleString('fa-IR')}</span></button><button className="btn-icon h-8 w-8 shrink-0" onClick={()=>beginEdit(tag)} aria-label="ویرایش تگ"><Pencil className="h-3.5 w-3.5"/></button><button className="btn-icon h-8 w-8 shrink-0 text-red-300" onClick={()=>{setDeleteError('');setDeletingTag(tag)}} aria-label="حذف تگ از همه فایل‌ها"><Trash2 className="h-3.5 w-3.5"/></button></div>)}</div>}</section>)}</div>}
            </section>
            <section className="rounded-3xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5"><div className="flex items-center gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-300"><Ban className="h-5 w-5"/></span><div><h2 className="font-bold">استثناهای تشخیص خودکار</h2><p className="text-xs text-dark-400">این واژه‌ها اگر در توضیحات باشند، خودکار به تگ تبدیل نمی‌شوند.</p></div></div><div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto] gap-2"><input value={excludedInput} onChange={event=>setExcludedInput(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();addExclusion()}}} className="input min-w-0" placeholder="مثلاً تبلیغ"/><button onClick={addExclusion} className="btn-secondary min-h-11 px-4">افزودن</button></div>{excludedTags.length>0&&<div className="mt-3 grid gap-2 sm:grid-cols-2">{[...excludedTags].sort((a,b)=>a.localeCompare(b,'fa')).map(tag=><span key={tag} className="flex min-w-0 items-center gap-2 rounded-xl border border-amber-400/12 bg-amber-500/[.055] py-2 pr-3 pl-2 text-xs text-amber-100"><span className="min-w-0 flex-1 truncate">#{tag}</span><button onClick={()=>removeExclusion(tag)} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-amber-300 transition hover:bg-red-500/10 hover:text-red-300" aria-label={`حذف ${tag}`}><X className="h-3.5 w-3.5"/></button></span>)}</div>}</section>
        </>}
        {(!activeSection||activeSection==='tags-display')&&<section id="tags-display" className="scroll-mt-24 rounded-3xl border border-white/[.07] bg-dark-900/70 p-4 sm:p-5"><h2 className="font-bold">نمایش زیر فایل‌ها</h2><button type="button" onClick={()=>{const next=!show;setShow(next);void save(tags,next,limit)}} className="mt-4 flex w-full items-center justify-between rounded-2xl bg-dark-800/55 p-3 text-right"><span className="text-sm">نمایش تگ‌ها روی کارت فایل</span><span className={`relative h-7 w-12 rounded-full p-1 transition ${show?'bg-primary-500':'bg-dark-700'}`}><span className={`block h-5 w-5 rounded-full bg-white shadow transition-transform ${show?'-translate-x-5':'translate-x-0'}`}/></span></button><CustomSelect className="mt-3" label="حداکثر تعداد قابل نمایش" value={limit} onChange={value=>{setLimit(Number(value));void save(tags,show,Number(value))}} options={[1,2,3,4,5,6].map(value=>({value,label:`${value.toLocaleString('fa-IR')} تگ`}))}/></section>}
        {activeTag&&<div className="fixed inset-0 z-[210] flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center sm:p-5" onClick={()=>setActiveTag(null)}><section className="flex max-h-[90dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-dark-900 shadow-2xl sm:rounded-3xl" onClick={event=>event.stopPropagation()}><header className="flex items-center gap-3 border-b border-white/[.07] p-4"><span className="h-4 w-4 rounded-full" style={{backgroundColor:activeTag.color}}/><div className="min-w-0 flex-1"><h2 className="truncate font-bold">#{activeTag.name}</h2><p className="text-xs text-dark-400">فایل‌های این تگ را پیدا یا از تگ خارج کن.</p></div><button className="btn-icon" onClick={()=>setActiveTag(null)}><X className="h-5 w-5"/></button></header><div className="grid gap-2 border-b border-white/[.06] p-3 sm:grid-cols-[1fr_10rem_11rem]"><label className="relative"><Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-dark-500"/><input className="input w-full !pr-10" value={query} onChange={event=>setQuery(event.target.value)} placeholder="جست‌وجو"/></label><CustomSelect value={type} onChange={setType} options={typeOptions}/><CustomSelect value={sort} onChange={setSort} options={sortOptions}/></div>{tagFiles?.files.length?<div className="flex items-center gap-2 border-b border-white/[.06] px-3 py-2"><button className="btn-secondary flex min-h-9 items-center gap-1.5 px-3 text-xs" onClick={()=>setSelectedFileIds(current=>current.size===tagFiles.files.length?new Set():new Set(tagFiles.files.map(file=>file.id)))}>{selectedFileIds.size===tagFiles.files.length?<CheckSquare className="h-4 w-4"/>:<Square className="h-4 w-4"/>}انتخاب این صفحه</button>{selectedFileIds.size>0&&<button disabled={batchUpdate.isPending} className="flex min-h-9 items-center gap-1.5 rounded-xl bg-red-500/10 px-3 text-xs text-red-300" onClick={()=>void removeTagFromSelected()}><X className="h-4 w-4"/>برداشتن تگ از {selectedFileIds.size.toLocaleString('fa-IR')} فایل</button>}</div>:null}<div className="min-h-0 flex-1 overflow-y-auto p-3">{filesLoading?<p className="p-8 text-center text-sm text-dark-500">در حال دریافت…</p>:tagFiles?.files.length?tagFiles.files.map(file=><article key={file.id} className={`mb-2 flex items-center gap-2 rounded-2xl p-3 ${selectedFileIds.has(file.id)?'bg-primary-500/10 ring-1 ring-primary-400/20':'bg-white/[.035]'}`}><button className={`btn-icon h-9 w-9 shrink-0 ${selectedFileIds.has(file.id)?'text-primary-200':'text-dark-500'}`} onClick={()=>toggleFileSelection(file.id)}>{selectedFileIds.has(file.id)?<CheckSquare className="h-4 w-4"/>:<Square className="h-4 w-4"/>}</button><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[.05] text-lg">{getFileIcon(file.file_type)}</span><span className="min-w-0 flex-1"><strong dir="auto" className="block truncate text-sm">{file.file_name}</strong><small className="text-dark-500">{file.file_type==='audio'?'صدا':file.file_type==='video'?'ویدیو':file.file_type==='image'?'عکس':file.file_type==='text'?'متن':'فایل'}</small></span><button disabled={updateFile.isPending} onClick={()=>void removeTagFromFile(file.id,file.tags)} className="btn-icon h-9 w-9 shrink-0 text-red-300" title="برداشتن تگ"><X className="h-4 w-4"/></button></article>):<div className="p-10 text-center text-dark-500"><FileText className="mx-auto mb-3 h-8 w-8"/><p className="text-sm">فایلی پیدا نشد.</p></div>}</div>{tagFiles&&tagFiles.total>tagFiles.per_page&&<footer className="flex items-center justify-center gap-3 border-t border-white/[.07] p-3"><button disabled={page<=1} className="btn-icon disabled:opacity-30" onClick={()=>setPage(value=>value-1)}><ChevronRight className="h-4 w-4"/></button><span className="text-xs text-dark-400">صفحه {page.toLocaleString('fa-IR')}</span><button disabled={page*tagFiles.per_page>=tagFiles.total} className="btn-icon disabled:opacity-30" onClick={()=>setPage(value=>value+1)}><ChevronLeft className="h-4 w-4"/></button></footer>}</section></div>}
        {deletingTag&&<div className="fixed inset-0 z-[230] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" onClick={()=>setDeletingTag(null)}><section dir="rtl" className="w-full max-w-sm rounded-3xl border border-white/10 bg-dark-900 p-5 text-right shadow-2xl" onClick={event=>event.stopPropagation()}><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/10 text-red-300"><Trash2 className="h-5 w-5"/></span><h3 className="mt-4 font-bold">حذف #{deletingTag.name}؟</h3><p className="mt-2 text-sm leading-6 text-dark-400">این تگ از فهرست و از روی تمام فایل‌هایی که دارند برداشته می‌شود.</p>{deleteError&&<p className="mt-3 rounded-xl bg-red-500/10 p-2.5 text-xs text-red-300">{deleteError}</p>}<div className="mt-5 flex gap-2"><button disabled={deleteTag.isPending} className="flex min-h-11 flex-1 items-center justify-center rounded-xl bg-red-500 px-4 text-sm font-semibold text-white disabled:opacity-50" onClick={()=>void confirmDeleteTag()}>{deleteTag.isPending?'در حال حذف…':'حذف تگ'}</button><button className="btn-secondary flex-1" onClick={()=>setDeletingTag(null)}>بی‌خیال</button></div></section></div>}
    </div>;
}
