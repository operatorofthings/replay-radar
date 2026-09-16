import {relevantEvents} from './ranking.mjs';
import {storage,DAY} from './storage.mjs';

let storeTail=Promise.resolve();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function pool(items, concurrency, fn) {
  let i=0; const results=[];
  await Promise.all(Array.from({length:Math.min(concurrency,items.length)},async()=>{while(i<items.length){const index=i++;results[index]=await fn(items[index],index);}}));
  return results;
}
export async function requestJson(url, options={}) {
  for(let attempt=0;attempt<2;attempt++) {
    const response=await fetch(url,{...options,signal:AbortSignal.timeout(8000)});
    if((response.status===429 || response.status>=500) && attempt<1){await pause(1500);continue;}
    if(!response.ok) {const error=new Error(response.status===401||response.status===403?'Steam verweigert den Zugriff. Prüfe API-Key und Profil-Privatsphäre.':`Steam ist momentan nicht erreichbar (HTTP ${response.status}).`);error.status=response.status;throw error;}
    return response.json();
  }
}
export async function steam(path, params={}, key) {
  const url=new URL(`https://api.steampowered.com/${path}/`);
  for(const [k,v] of Object.entries(params)) url.searchParams.set(k,String(v));
  if(key) url.searchParams.set('key',key);
  return requestJson(url);
}
async function cached(key,ttl,fetcher) {
  const db=await storage(),record=await db.get('public-cache',key);
  if(record?.freshUntil>Date.now())return record.value;
  const value=await fetcher();await db.put('public-cache',key,{freshUntil:Date.now()+ttl,value});return value;
}
export async function owned(steamid,key) {
  const {response}=await steam('IPlayerService/GetOwnedGames/v1',{steamid,include_appinfo:1,include_played_free_games:1},key);
  if(!response || !Object.hasOwn(response,'game_count')) throw new Error('Spieledetails sind nicht sichtbar. Stelle unter Steam → Profil → Privatsphäreeinstellungen die Spieledetails auf Öffentlich.');
  return (response.games || []).map(g=>({appid:g.appid,name:g.name,playtime_forever:g.playtime_forever||0,playtime_2weeks:g.playtime_2weeks||0,icon:g.img_icon_url?`https://media.steampowered.com/steamcommunity/public/images/apps/${g.appid}/${g.img_icon_url}.jpg`:undefined,rtime_last_played:g.rtime_last_played||0}));
}
export async function players(ids,key) {
  if(!ids.length)return [];
  const result=[];
  for(let i=0;i<ids.length;i+=100){const r=await steam('ISteamUser/GetPlayerSummaries/v2',{steamids:ids.slice(i,i+100).join(',')},key);result.push(...(r.response?.players||[]));}
  return result.map(p=>({steamid:p.steamid,name:p.personaname,avatar:p.avatarmedium}));
}
export async function metadata(appid) {
  return cached(`store-v1-${appid}`,86400000,()=> {
    const task=storeTail.then(async()=> {
      try {const result=await requestJson(`https://store.steampowered.com/api/appdetails?appids=${appid}&l=german`);const d=result[appid]?.data;if(!d)throw new Error('Store-Metadaten fehlen');return {image:d.header_image,genres:(d.genres||[]).map(g=>g.description),categories:(d.categories||[]).map(c=>c.id)};}
      finally {await pause(1600);}
    });storeTail=task.catch(()=>{});return task;
  });
}
export async function updates(game) {
  return cached(`news-v3-${game.appid}-${game.rtime_last_played}`,DAY*1000,async()=>{
    const items=[];let enddate;let truncated=false;
    for(let page=0;page<5;page++){
      const params={appid:game.appid,count:100,maxlength:0,feeds:'steam_community_announcements'};
      if(enddate)params.enddate=enddate;
      const response=await steam('ISteamNews/GetNewsForApp/v2',params);
      const batch=response.appnews?.newsitems;if(!Array.isArray(batch))throw new Error('Steam hat keine gültigen News geliefert.');
      items.push(...batch);
      if(!batch.length || batch.length<100 || Math.min(...batch.map(n=>n.date))<=game.rtime_last_played)break;
      enddate=Math.min(...batch.map(n=>n.date))-1;
      if(page===4)truncated=true;
      await pause(200);
    }
    return {events:relevantEvents(items,game.rtime_last_played),truncated};
  });
}
