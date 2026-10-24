import { cachedCurrentUser } from './accounts';
import { isEffectivelyOnline } from './connectivity';

export type OfflineEntity = 'folder'|'tag'|'playlist';
export type OfflineMutation = {
    id:string;
    userId:number;
    entity:OfflineEntity;
    method:'post'|'put'|'patch'|'delete';
    url:string;
    payload?:unknown;
    baseUpdatedAt?:string|null;
    conflictUrl?:string;
    createdAt:string;
    tempId?:number;
    state:'queued'|'conflict'|'error';
    message?:string;
};

const STORAGE_KEY='komod-offline-mutations-v1';
const MAP_KEY='komod-offline-id-map-v1';
export const OFFLINE_MUTATIONS_CHANGED='komod-offline-mutations-changed';
let syncing=false;

const readAll=():OfflineMutation[]=>{try{return JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]')}catch{return[]}};
const writeAll=(items:OfflineMutation[])=>{localStorage.setItem(STORAGE_KEY,JSON.stringify(items));window.dispatchEvent(new Event(OFFLINE_MUTATIONS_CHANGED))};
const idMap=():Record<string,number>=>{try{return JSON.parse(localStorage.getItem(MAP_KEY)||'{}')}catch{return{}}};
const saveIdMap=(value:Record<string,number>)=>localStorage.setItem(MAP_KEY,JSON.stringify(value));
export const listOfflineMutations=()=>{const userId=cachedCurrentUser()?.id;return readAll().filter(item=>item.userId===userId)};
export const hasQueuedOfflineMutations=()=>listOfflineMutations().some(item=>item.state==='queued');

export function queueOfflineMutation(input:Omit<OfflineMutation,'id'|'userId'|'createdAt'|'state'>):OfflineMutation{
    const userId=cachedCurrentUser()?.id;
    if(!userId)throw new Error('حساب فعال پیدا نشد.');
    const id=typeof crypto.randomUUID==='function'?crypto.randomUUID():`${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const item:OfflineMutation={...input,id,userId,createdAt:new Date().toISOString(),state:'queued'};
    const items=readAll();items.push(item);writeAll(items);return item;
}

export const shouldQueueOffline=(error:unknown)=>!isEffectivelyOnline()||!(error as any)?.response;

function resolveValue(value:unknown,map:Record<string,number>):unknown{
    if(typeof value==='number'&&value<0)return map[String(value)]??value;
    if(Array.isArray(value))return value.map(item=>resolveValue(item,map));
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value as Record<string,unknown>).map(([key,item])=>[key,resolveValue(item,map)]));
    return value;
}
function resolveUrl(url:string,map:Record<string,number>){return url.replace(/\/-\d+(?=\/|$)/g,value=>`/${map[value.slice(1)]??value.slice(1)}`)}

/** Flush queued metadata changes in order. Newer server edits win conflicts. */
type MutationRequester=(config:{method:string;url:string;data?:unknown})=>Promise<{data:any}>;
export async function syncOfflineMutations(request:MutationRequester):Promise<{synced:number;conflicts:number;failed:number}>{
    if(syncing||!isEffectivelyOnline())return{synced:0,conflicts:0,failed:0};
    const userId=cachedCurrentUser()?.id;if(!userId)return{synced:0,conflicts:0,failed:0};
    syncing=true;let synced=0,conflicts=0,failed=0;
    try{
        const all=readAll();const map=idMap();
        for(const item of all.filter(value=>value.userId===userId&&value.state==='queued')){
            const url=resolveUrl(item.url,map);const payload=resolveValue(item.payload,map);
            try{
                if(item.baseUpdatedAt&&item.method!=='post'){
                    try{
                        const current=(await request({method:'get',url:resolveUrl(item.conflictUrl||url,map)})).data;
                        const serverTime=Date.parse(current?.updated_at||'');
                        if(Number.isFinite(serverTime)&&serverTime>Date.parse(item.createdAt)){
                            item.state='conflict';item.message='نسخه آنلاین جدیدتر بود و نگه داشته شد.';conflicts+=1;continue;
                        }
                    }catch(error:any){if(error?.response?.status!==404)throw error}
                }
                const response=await request({method:item.method,url,data:payload});
                if(item.tempId&&response.data?.id){map[String(item.tempId)]=Number(response.data.id);saveIdMap(map)}
                const index=all.findIndex(value=>value.id===item.id);if(index>=0)all.splice(index,1);
                synced+=1;
            }catch(error:any){
                if(!error?.response)break;
                if(error.response.status===404&&item.method==='delete'){
                    const index=all.findIndex(value=>value.id===item.id);if(index>=0)all.splice(index,1);synced+=1;continue;
                }
                item.state='error';item.message=error?.response?.data?.detail||'اعمال تغییر انجام نشد.';failed+=1;
            }
        }
        writeAll(all);saveIdMap(map);
        if(synced||conflicts)window.dispatchEvent(new CustomEvent('komod-offline-sync-finished',{detail:{synced,conflicts,failed}}));
        return{synced,conflicts,failed};
    }finally{syncing=false}
}

export function clearResolvedOfflineMutations(){writeAll(readAll().filter(item=>item.state==='queued'))}
