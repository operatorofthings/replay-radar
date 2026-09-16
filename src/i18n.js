import {useSyncExternalStore} from 'react';
import english from './locales/en.json';
let language='en';try{if(localStorage.getItem('rr_language')==='de')language='de';}catch{}
const listeners=new Set();
export function setLanguage(value){if(!['en','de'].includes(value))return;language=value;try{localStorage.setItem('rr_language',value);}catch{}for(const listener of listeners)listener();}
export function useLanguage(){return useSyncExternalStore(callback=>{listeners.add(callback);return()=>listeners.delete(callback);},()=>language);}
export const locale=()=>language==='de'?'de-DE':'en-GB';
export function t(source,...values){
 const key=Array.isArray(source)?source.reduce((text,part,i)=>text+(i?`{${i-1}}`:'')+part,''):source;
 if(language==='de')return Array.isArray(source)?source.reduce((text,part,i)=>text+(i?values[i-1]:'')+part,''):source;
 let translated=english[key];
 if(translated===undefined&&typeof key==='string'){
   // Server errors may include an HTTP status. Never translate game/news titles.
   const match=key.match(/^(Steam antwortet mit HTTP |Steam ist momentan nicht erreichbar \(HTTP )(\d+)(\)?)\.$/);
   if(match)return match[1].includes('antwortet')?`Steam returned HTTP ${match[2]}.`:`Steam is currently unavailable (HTTP ${match[2]}).`;
 }
 return (translated??key)?.replace?.(/\{(\d+)\}/g,(_,index)=>values[index]??`{${index}}`)??source;
}
