import express from 'express';
import openid from 'openid';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {storage,DAY} from './storage.mjs';
import {config,userAlias} from './config.mjs';
import {players,steam} from './steam.mjs';
import {readJob,startJob} from './jobs.mjs';
import {makePreference} from './preferences.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').filter(x=>x.includes('=')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i).trim(),x.slice(i+1)];}));
export async function createApp(overrides={}){
 const cfg=overrides.config||await config(),db=overrides.db||await storage();
 const {origin}=cfg,secure=new URL(origin).protocol==='https:',app=express();
 app.disable('x-powered-by');
 app.use((req,res,next)=>{
   // Hosted requests are authenticated by CloudFront OAC. Check Host locally too.
   if(!process.env.AWS_LAMBDA_FUNCTION_NAME&&req.get('host')!==new URL(origin).host)return res.status(403).send('Unbekannter Host');
   res.set({'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Cache-Control':'no-store'});
   if(!['GET','HEAD'].includes(req.method)&&req.get('origin')!==origin)return res.status(403).json({error:'Ungültiger Ursprung.'});
   next();
 });
 app.use(express.json({limit:'4kb'}));
 async function session(req){const token=cookies(req).rr_session;if(!token||!/^[a-f0-9]{64}$/.test(token))return null;const sessionId=hash(token);const value=await db.get('sessions',sessionId);return value?{...value,sessionId}:null;}
 async function requireSession(req,res,next){const account=await session(req);if(!account)return res.status(401).json({error:'Bitte zuerst mit Steam verbinden.'});req.account=account;next();}
 app.get('/api/session',async(req,res)=>{const s=await session(req);res.json({user:s?.user||null,keyConfigured:Boolean(cfg.key),hasKey:Boolean(s?.key||cfg.key)});});
 app.get('/auth/steam',async(req,res)=>{
   const state=randomBytes(24).toString('hex');const returnTo=`${origin}/auth/callback?state=${state}`;
   await db.put('login',hash(state),{returnTo},600);
   const rp=new openid.RelyingParty(returnTo,origin,true,false,[]);
   res.cookie('rr_login',state,{httpOnly:true,sameSite:'lax',secure,maxAge:600000});
   rp.authenticate('https://steamcommunity.com/openid',false,(err,url)=>res.redirect(err||!url?'/?authError=steam':url));
 });
 app.get('/auth/callback',async(req,res)=>{
   const state=String(req.query.state||''),cookie=cookies(req).rr_login||'';
   if(!/^[a-f0-9]{48}$/.test(state)||cookie.length!==state.length||!timingSafeEqual(Buffer.from(cookie),Buffer.from(state)))return res.redirect('/?authError=invalid');
   const flow=await db.take('login',hash(state));res.clearCookie('rr_login');if(!flow)return res.redirect('/?authError=invalid');
   const rp=new openid.RelyingParty(flow.returnTo,origin,true,false,[]);
   const result=await new Promise(resolve=>rp.verifyAssertion(`${origin}${req.originalUrl}`,(err,r)=>resolve(err?null:r)));
   const match=result?.claimedIdentifier?.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/);
   if(!result?.authenticated||!match)return res.redirect('/?authError=invalid');
   const steamid=match[1];if(cfg.allowlist.length&&!cfg.allowlist.includes(steamid))return res.redirect('/?authError=not-invited');
   let user={steamid,name:'Steam-Spieler'};try{if(cfg.key)user=(await players([steamid],cfg.key))[0]||user;}catch{}
   const token=randomBytes(32).toString('hex');await db.put('sessions',hash(token),{user,alias:userAlias(steamid,cfg.salt)},12*3600);
   res.cookie('rr_session',token,{httpOnly:true,sameSite:'lax',secure,maxAge:12*3600000});res.redirect('/');
 });
 app.post('/api/key',requireSession,async(req,res)=>{
   if(process.env.AWS_LAMBDA_FUNCTION_NAME)return res.status(400).json({error:'Der Steam-Key wird vom Betreiber hinterlegt.'});
   const key=String(req.body.key||'').trim();if(!/^[a-fA-F0-9]{32}$/.test(key))return res.status(400).json({error:'Bitte einen gültigen Steam Web-API-Key eingeben.'});
   const s=req.account;s.user=(await players([s.user.steamid],key))[0]||s.user;s.key=key;await db.put('sessions',s.sessionId,s,12*3600);res.json({ok:true});
 });
 app.post('/api/logout',async(req,res)=>{const s=await session(req);if(s)await db.delete('sessions',s.sessionId);res.clearCookie('rr_session');res.json({ok:true});});
 app.get('/api/preferences',requireSession,async(req,res)=>res.json({preferences:[...await db.list(`user:${req.account.alias}`,'preference:'),...await db.list(`user:${req.account.alias}`,'coop-preference:')]}));
 app.post('/api/preferences',requireSession,async(req,res)=>{
   const pk=`user:${req.account.alias}`,scope=req.body.scope||'radar';if(!['radar','coop'].includes(scope))return res.status(400).json({error:'Ungültiger Bereich.'});const prefix=scope==='coop'?'coop-preference':'preference';if(req.body.action==='restore'){
     if(!Number.isSafeInteger(req.body.appid)||req.body.appid<=0)return res.status(400).json({error:'Ungültiges Spiel.'});
     await db.delete(pk,`${prefix}:${req.body.appid}`);return res.json({ok:true});
   }
   let preference;try{preference=makePreference(req.body);}catch(e){return res.status(400).json({error:e.message});}
   await db.put(pk,`${prefix}:${preference.appid}`,preference,Math.ceil((preference.until-Date.now())/1000));res.json({preference});
 });
 app.post('/api/scan',requireSession,async(req,res)=>{if(!req.account.key&&!cfg.key)return res.status(400).json({error:'Bitte zuerst einen API-Key hinterlegen.'});res.json(await startJob(req.account,'scan'));});
 app.get('/api/scan',requireSession,async(req,res)=>res.json(await readJob(req.account.alias,'scan')));
 app.get('/api/friends',requireSession,async(req,res)=>{
   const s=req.account,pk=`user:${s.alias}`;let cached=await db.get(pk,'friends');
   if(!cached||Date.now()-cached.at>DAY*1000){
     const result=await steam('ISteamUser/GetFriendList/v1',{steamid:s.user.steamid,relationship:'friend'},s.key||cfg.key);
     if(!result.friendslist)throw new Error('Deine Freundesliste ist nicht sichtbar. Prüfe deine Steam-Privatsphäre.');
     cached={at:Date.now(),friends:await players(result.friendslist.friends.map(f=>f.steamid),s.key||cfg.key)};await db.put(pk,'friends',cached,DAY);
   }
   res.json({friends:cached.friends});
 });
 app.post('/api/coop',requireSession,async(req,res)=>{
   const s=req.account,friend=String(req.body.friend||''),mode=req.body.mode==='all'?'all':'online';const list=await db.get(`user:${s.alias}`,'friends');
   if(!list?.friends.some(f=>f.steamid===friend))return res.status(400).json({error:'Bitte einen Freund aus deiner Freundesliste wählen.'});
   const result=await startJob(s,'coop',{friend,mode});res.json(result);
 });
 app.get('/api/coop',requireSession,async(req,res)=>res.json(await readJob(req.account.alias,'coop')));
 app.use('/api',(req,res)=>res.status(404).json({error:'Unbekannte Anfrage.'}));
 app.use((err,req,res,next)=>res.status(err.status===401||err.status===403?403:500).json({error:err.message||'Die Anfrage ist fehlgeschlagen.'}));
 return app;
}
