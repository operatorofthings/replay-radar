export const DEFAULT_WEIGHTS = {release:100, dlc:70, major:40, update:15};
export const LABELS = {release:'1.0 / Vollversion',dlc:'Neuer DLC',major:'Großes Update',update:'Content-Update'};
export function classify(item) {
  const title = String(item.title||'').toLowerCase();
  // Publisher headlines are evidence, not a structured release database.
  if (/\b(coming soon|coming on|arrives on|releases on|launches on|roadmap|preview|teaser|wishlist|announc\w*|upcoming|next week|tomorrow|demnächst|angekündigt|erscheint am|bald|sale|discount|% off|livestream|live stream|giveaway|soundtrack|hotfix|bugfix|patch notes)\b/.test(title)) return null;
  // A shop rotation is not new gameplay. Match entire version tokens, never
  // a suffix such as 11.1.0 or 0.1.0. Bare version numbers are not launch proof.
  if (/\b(store|shop|item shop)\s+(update|rotation|refresh)\b|\b(shop|store)-update\b/.test(title)) return null;
  const addon=/\b(dlc|expansion|erweiterung)\b/.test(title);
  if (addon && /\b(out|available|released|launch|live|now|da|verfügbar|erschienen)\b/.test(title)) return 'dlc';
  const versionOne=/(?<![\w.])v?1\.0(?:\.0)?(?![\w.]|[- ]?(?:beta|alpha|rc)\b)/.test(title);
  const launch=/\b(release|released|launch|launched|out now|is out|available now|now available|is live|veröffentlicht|erschienen|jetzt verfügbar)\b/.test(title);
  if (!addon && (/\b(full release|full launch|leav(?:es|ing|e) early access|out of early access|vollversion)\b/.test(title) || versionOne&&launch)) return 'release';
  if (/\b(major|massive|biggest|content|großes) update|new (biome|chapter|campaign)|neues kapitel/.test(title)) return 'major';
  if (/\b(update|new content|new map|new season|neue inhalte)\b/.test(title)) return 'update';
  return null;
}
// Re-evaluate stored headlines as well as new ones; no Steam refetch needed.
export function reclassifyEvents(events=[]) {
  return events.flatMap(event=>{const kind=classify(event);return kind?[{...event,kind}]:[];});
}
export function refreshGameEvents(games=[]) {
  return games.flatMap(game=>{if(!Array.isArray(game.events))return [game];const events=reclassifyEvents(game.events);return events.length?[{...game,events}]:[];});
}
export function relevantEvents(items,lastPlayed,now=Date.now()/1000) {
  if (!lastPlayed) return [];
  const seen = new Set();
  return items.filter(n=>n.date>lastPlayed && n.date<=now && n.feedname==='steam_community_announcements')
    .flatMap(n=> { const kind=classify(n); const key=n.gid || `${n.title}:${n.date}`; if(!kind || seen.has(key)) return []; seen.add(key); return [{id:key,title:n.title,date:n.date,url:n.url,kind}]; });
}
// Bonuses are bounded below the gap between default content tiers.
export function scoreGame(game,weights=DEFAULT_WEIGHTS,recentGenres={},now=Date.now()/1000){
 const events=game.events||[],values=events.map(e=>Math.max(0,Number(weights[e.kind])||0)).sort((a,b)=>b-a);
 const base=values[0]||0;
 const depth=base?6*(1-Math.exp(-values.slice(1).reduce((s,v)=>s+v,0)/150)):0;
 const latest=Math.max(0,...events.map(e=>e.date||0));
 const freshness=base&&latest?4*Math.exp(-Math.max(0,now-latest)/(180*86400)):0;
 const total=Object.values(recentGenres).reduce((s,v)=>s+v,0);
 const familiarity=total&&game.genres?.length?Math.max(...game.genres.map(g=>(recentGenres[g]||0)/total)):null;
 const variety=base&&familiarity!==null?3*(1-familiarity):0;
 const score=Math.round((base+depth+freshness+variety)*10)/10;
 return {score,base,depth,freshness,variety,hasGenreData:familiarity!==null};
}
export function scoreEvents(events,weights=DEFAULT_WEIGHTS){return scoreGame({events},weights).score;}
// The same cumulative intervals drive rendering and selection.
export function wheelSegments(games,weighted=false){
 const values=games.map(g=>weighted?1+Math.max(0,Number(g.score)||0)/50:1),total=values.reduce((a,b)=>a+b,0);let start=0;
 return games.map((game,i)=>{const end=start+values[i]/total,segment={game,start,end,chance:values[i]/total};start=end;return segment;});
}
export function pickSegment(segments,random){return segments.find(s=>random<s.end)||segments.at(-1);}
export function commonCoop(mine,theirs,metadata,mode='online') {
  const owned=new Set(theirs.map(g=>g.appid));
  return mine.filter(g=>owned.has(g.appid)).filter(g=> {
    const categories=metadata.get(g.appid)?.categories || [];
    return mode==='online' ? categories.includes(38) : categories.some(c=>[9,38,39].includes(c));
  });
}
