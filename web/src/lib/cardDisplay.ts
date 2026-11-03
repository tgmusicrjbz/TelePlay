import { useSyncExternalStore } from 'react';

export type CardDisplayPreferences={fileDescription:boolean;fileTags:boolean;fileType:boolean;fileSize:boolean;fileDuration:boolean;fileProgress:boolean;folderCount:boolean;folderDescription:boolean;statusBadges:boolean};
export const defaultCardDisplay:CardDisplayPreferences={fileDescription:true,fileTags:true,fileType:true,fileSize:true,fileDuration:true,fileProgress:true,folderCount:true,folderDescription:true,statusBadges:true};
const key='komod-card-display';
function readPreferences():CardDisplayPreferences{try{return {...defaultCardDisplay,...JSON.parse(localStorage.getItem(key)||'{}')}}catch{return defaultCardDisplay}}
let snapshot=readPreferences();
const subscribers=new Set<()=>void>();
const refresh=()=>{snapshot=readPreferences();subscribers.forEach(listener=>listener())};
const storageRefresh=(event:StorageEvent)=>{if(event.key===key)refresh()};
const subscribe=(listener:()=>void)=>{
    subscribers.add(listener);
    if(subscribers.size===1){window.addEventListener('komod-card-display-changed',refresh);window.addEventListener('storage',storageRefresh)}
    return()=>{subscribers.delete(listener);if(!subscribers.size){window.removeEventListener('komod-card-display-changed',refresh);window.removeEventListener('storage',storageRefresh)}};
};
export function getCardDisplayPreferences():CardDisplayPreferences{return snapshot}
export function saveCardDisplayPreferences(value:CardDisplayPreferences){snapshot={...defaultCardDisplay,...value};localStorage.setItem(key,JSON.stringify(snapshot));window.dispatchEvent(new Event('komod-card-display-changed'))}
export function useCardDisplayPreferences(){return useSyncExternalStore(subscribe,()=>snapshot,()=>snapshot)}
