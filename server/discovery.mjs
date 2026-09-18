import {requestJson,metadata} from './steam.mjs';
import {storage,DAY} from './storage.mjs';
let tail=Promise.resolve();
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function search(params){
 const task=tail.then(async()=>{try{const url=new URL('https://store.steampowered.com/search/results/');for(const [key,value]of Object.entries({start:0,count:100,infinite:1,json:1,category1:998,l:'english',cc:'us',...params}))url.searchParams.set(key,value);const result=await requestJson(url);if(!result.success||typeof result.results_html!=='string')throw new Error('Steam discovery data is temporarily unavailable.');return parseSearch(result.results_html);}finally{await wait(1600);}});tail=task.catch(()=>{});return task;
}
export function parseSearch(html){
 const result=[];
 for(const match of html.matchAll(/<a\b([^>]*class="[^"]*search_result_row[^>]*|[^>]*data-ds-appid=[^>]*)>([\s\S]*?)<\/a>/g)){
  const attrs=match[1],id=attrs.match(/data-ds-appid="(\d+)"/),tags=attrs.match(/data-ds-tagids="([^"<>]+)"/);if(!id||!tags)continue;
  let values;try{values=JSON.parse(tags[1]);}catch{continue;}if(!Array.isArray(values))continue;
  result.push({appid:Number(id[1]),tags:values.filter(Number.isSafeInteger).slice(0,20).map(String)});
 }return [...new Map(result.map(game=>[game.appid,game])).values()];
}
async function cached(key,seconds,fetcher){const db=await storage();const old=await db.get('public-cache',key);if(old?.until>Date.now())return old.value;const value=await fetcher();await db.put('public-cache',key,{until:Date.now()+seconds*1000,value});return value;}
export async function catalogue(){return cached('discovery-catalogue-v1',DAY,async()=>{const top=await search({filter:'topsellers'}),recent=await search({sort_by:'Released_DESC'});const games=[...new Map([...top,...recent].map(g=>[g.appid,g])).values()].slice(0,200);if(!games.length)throw new Error('Steam discovery data is temporarily unavailable.');return games;});}
async function tags(game){return cached(`discovery-tags-v1-${game.appid}`,7*DAY,async()=>{const rows=await search({term:game.name,count:10});return rows.find(row=>row.appid===game.appid)?.tags||[];});}
export function rankDiscover(profile,catalogue,owned){
 const eligible=profile.filter(g=>g.tags?.length&&g.playtime_forever>0),frequency=new Map();
 for(const game of catalogue)for(const tag of new Set(game.tags))frequency.set(tag,(frequency.get(tag)||0)+1);
 const idf=tag=>1+Math.log((catalogue.length+1)/((frequency.get(tag)||0)+1));
 const vector=g=>{const result=new Map();for(const tag of g.tags||[])result.set(tag,idf(tag));const norm=Math.hypot(...result.values())||1;return new Map([...result].map(([tag,w])=>[tag,w/norm]));};
 const vectors=eligible.map(game=>({game,v:vector(game),weight:Math.log1p(game.playtime_forever/60)}));
 const taste=new Map();for(const {v,weight}of vectors)for(const [tag,w]of v)taste.set(tag,(taste.get(tag)||0)+w*weight);
 const norm=Math.hypot(...taste.values());if(!norm)return [];
 const similar=(a,b)=>[...a].reduce((sum,[tag,w])=>sum+w*(b.get(tag)||0),0);
 const scored=catalogue.filter(g=>!owned.has(g.appid)).map(game=>{const v=vector(game),match=similar(v,taste)/norm;const reasons=vectors.map(x=>({appid:x.game.appid,name:x.game.name,affinity:similar(v,x.v)})).filter(x=>x.affinity>.15).sort((a,b)=>b.affinity-a.affinity).slice(0,2);return {...game,match:Math.round(match*100),reasons,v};}).filter(g=>g.match>=15&&g.reasons.length);
 const result=[];while(scored.length&&result.length<30){scored.sort((a,b)=>(b.match-15*Math.max(0,...result.map(g=>similar(b.v,g.v))))-(a.match-15*Math.max(0,...result.map(g=>similar(a.v,g.v))))||a.appid-b.appid);result.push(scored.shift());}
 return result.map(({v,...game})=>game);
}
export async function prepareDiscovery(library,exclusions){
 const started=Date.now(),candidates=await catalogue();const selected=library.filter(g=>g.playtime_forever>0&&!exclusions.has(g.appid)).sort((a,b)=>b.playtime_forever-a.playtime_forever).slice(0,16);
 const profile=[];for(const game of selected){if(Date.now()-started>70000)break;try{profile.push({...game,tags:await tags(game)});}catch{profile.push({...game,tags:[]});}}
 const usable=profile.filter(g=>g.tags.length);if(!usable.length)throw new Error('Not enough Steam tag data to build your taste profile yet. Please try again later.');
 return {todo:rankDiscover(usable,candidates,new Set(library.map(g=>g.appid))),profile:profile.map(g=>({appid:g.appid,name:g.name,hours:Math.round(g.playtime_forever/60),usable:g.tags.length>0})),catalogueSize:candidates.length};
}
export async function discoveryGame(game){const meta=await metadata(game.appid,true);if(meta.type!=='game'||meta.comingSoon)return null;return {...game,...meta};}
