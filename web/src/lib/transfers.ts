export type TransferState = 'queued'|'downloading'|'paused'|'cancelled'|'done'|'error';
export type TransferKind = 'offline'|'upload';
export interface LocalTransfer {
    id:string; kind:TransferKind; title:string; state:TransferState;
    percent:number; detail?:string; updatedAt:string;
}

const KEY='komod-transfer-snapshots';
export const TRANSFERS_CHANGED_EVENT='komod-transfers-changed';

export function listLocalTransfers():LocalTransfer[]{
    try {
        const parsed=JSON.parse(sessionStorage.getItem(KEY)||'[]') as LocalTransfer[];
        const cutoff=Date.now()-5*60_000;
        return parsed.filter(item=>['queued','downloading','paused'].includes(item.state)||Date.parse(item.updatedAt)>cutoff);
    } catch{return []}
}

export function publishLocalTransfer(item:Omit<LocalTransfer,'updatedAt'>){
    const next=[{...item,updatedAt:new Date().toISOString()},...listLocalTransfers().filter(current=>current.id!==item.id)].slice(0,100);
    sessionStorage.setItem(KEY,JSON.stringify(next));
    window.dispatchEvent(new Event(TRANSFERS_CHANGED_EVENT));
}

export function clearFinishedLocalTransfers(){
    const next=listLocalTransfers().filter(item=>['queued','downloading','paused'].includes(item.state));
    sessionStorage.setItem(KEY,JSON.stringify(next));
    window.dispatchEvent(new Event(TRANSFERS_CHANGED_EVENT));
}
