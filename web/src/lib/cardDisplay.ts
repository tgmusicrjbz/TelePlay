import { useEffect, useState } from 'react';

export type CardDisplayPreferences={fileDescription:boolean;fileTags:boolean;fileType:boolean;fileSize:boolean;fileDuration:boolean;fileProgress:boolean;folderCount:boolean;folderDescription:boolean;statusBadges:boolean};
export const defaultCardDisplay:CardDisplayPreferences={fileDescription:true,fileTags:true,fileType:true,fileSize:true,fileDuration:true,fileProgress:true,folderCount:true,folderDescription:true,statusBadges:true};
const key='komod-card-display';
export function getCardDisplayPreferences():CardDisplayPreferences{try{return {...defaultCardDisplay,...JSON.parse(localStorage.getItem(key)||'{}')}}catch{return defaultCardDisplay}}
export function saveCardDisplayPreferences(value:CardDisplayPreferences){localStorage.setItem(key,JSON.stringify(value));window.dispatchEvent(new Event('komod-card-display-changed'))}
export function useCardDisplayPreferences(){const [value,setValue]=useState(getCardDisplayPreferences);useEffect(()=>{const sync=()=>setValue(getCardDisplayPreferences());window.addEventListener('komod-card-display-changed',sync);return()=>window.removeEventListener('komod-card-display-changed',sync)},[]);return value}
