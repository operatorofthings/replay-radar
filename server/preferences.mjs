const DAY=86400;
export function makePreference({appid,name,action,days,scope="radar"},now=Date.now()){
 if(!['radar','coop'].includes(scope))throw new Error('Ungültiger Bereich.');
 if(!Number.isSafeInteger(appid)||appid<=0||typeof name!=='string'||!name.trim()||name.length>180)throw new Error('Ungültiges Spiel.');
 if(!['hide','snooze'].includes(action))throw new Error('Unbekannte Aktion.');
 const duration=action==='hide'?7:Number(days);
 if(![1,3,7].includes(duration))throw new Error('Wähle 1, 3 oder 7 Tage.');
 return {appid,name,action,scope,until:now+duration*DAY*1000};
}
export function isSuppressed(preference,now=Date.now()){return Boolean(preference&&preference.until>now);}
