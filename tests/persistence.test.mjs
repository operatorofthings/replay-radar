import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {FileStore,DynamoStore,DAY} from '../server/storage.mjs';
import {makePreference,isSuppressed} from '../server/preferences.mjs';
import {createApp} from '../server/app.mjs';
import {step,startJob} from '../server/jobs.mjs';
import {userAlias} from '../server/config.mjs';
async function temporaryStore(t){const dir=await mkdtemp(path.join(os.tmpdir(),'replay-test-'));t.after(()=>rm(dir,{recursive:true,force:true}));return new FileStore(dir);}
test('preferences expire exactly and invalid durations are rejected',()=>{
 const p=makePreference({appid:1,name:'Game',action:'snooze',days:3},1000);
 assert.equal(p.until,1000+3*DAY*1000);assert.equal(isSuppressed(p,p.until-1),true);assert.equal(isSuppressed(p,p.until),false);
 assert.equal(makePreference({appid:1,name:'Game',action:'hide'},1000).until,1000+7*DAY*1000);
 assert.throws(()=>makePreference({appid:1,name:'Game',action:'snooze',days:8}));
});
test('persistent store survives a new instance, ignores expired data and claims atomically',async t=>{
 const db=await temporaryStore(t);await db.put('u1','scan',{games:[1]});
 assert.deepEqual(await new FileStore(db.directory).get('u1','scan'),{games:[1]});
 await db.put('u1','expired',{secret:true},-1);assert.equal(await db.get('u1','expired'),null);
 const results=await Promise.all(Array.from({length:8},()=>db.claim('u1','lease',{ok:true},60)));assert.equal(results.filter(Boolean).length,1);
 assert.deepEqual(await db.take('u1','lease'),{ok:true});assert.equal(await db.take('u1','lease'),null);
});
test('DynamoDB TTL is enforced before asynchronous physical deletion',()=>{
 const db=new DynamoStore(null,null,'test');
 const current=db.encode('u','s',{hello:'world'},60);assert.deepEqual(db.decode(current),{hello:'world'});
 current.expiresAt=1;assert.equal(db.decode(current),null);
 assert.notEqual(userAlias('123','salt'),userAlias('123','other'));
});
test('preferences are authenticated and isolated between users',async t=>{
 const db=await temporaryStore(t),token='a'.repeat(64),token2='b'.repeat(64);
 for(const [value,alias]of [[token,'first'],[token2,'second']])await db.put('sessions',createHash('sha256').update(value).digest('hex'),{user:{name:alias},alias},3600);
 const server=createServer();server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));t.after(()=>new Promise(r=>server.close(r)));
 const origin=`http://127.0.0.1:${server.address().port}`;server.on('request',await createApp({db,config:{origin,key:'key',salt:'salt',allowlist:[]}}));
 const request=(route,body,cookie=token)=>fetch(origin+route,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:`rr_session=${cookie}`},body:body?JSON.stringify(body):undefined});
 assert.equal((await request('/api/preferences',undefined,'')).status,401);
 assert.equal((await request('/api/preferences',{appid:123,name:'Test',action:'snooze',days:3})).status,200);
 assert.equal((await(await request('/api/preferences')).json()).preferences.length,1);
 assert.equal((await(await request('/api/preferences',undefined,token2)).json()).preferences.length,0);
 await request('/api/preferences',{appid:123,name:'Test',action:'snooze',days:1,scope:'coop'});
 assert.equal((await(await request('/api/preferences')).json()).preferences.length,2);
 assert.equal((await request('/api/preferences',{appid:123,name:'Test',action:'snooze',days:1,scope:'invalid'})).status,400);
 await request('/api/preferences',{appid:123,action:'restore'});
 const remaining=(await(await request('/api/preferences')).json()).preferences;
 assert.equal(remaining.length,1);assert.equal(remaining[0].scope,'coop');
 await request('/api/preferences',{appid:123,action:'restore',scope:'coop'});assert.equal((await(await request('/api/preferences')).json()).preferences.length,0);
});
test('durable scan checkpoints recover after publish failure without duplicating games',async t=>{
 const db=await temporaryStore(t),messages=[];let fail=false,ownedCalls=0,newsCalls=0;
 await db.put('sessions','s',{user:{steamid:'1'}});
 await db.put('user:a','job:scan',{jobId:'j',sessionId:'s',status:'running',cursor:-1,failed:0,truncated:0,metadataFailed:0,games:[],startedAt:Date.now()});
 const dependencies={db,config:{key:'k'},steam:{owned:async()=>{ownedCalls++;return [{appid:1,name:'Game',playtime_forever:60,rtime_last_played:100}];},updates:async()=>{newsCalls++;return {events:[{kind:'release'}],truncated:false};},metadata:async()=>({genres:['Action'],categories:[38]})},enqueue:async m=>{if(fail)throw new Error('queue unavailable');messages.push(m);}};
 const initial={alias:'a',type:'scan',jobId:'j',cursor:-1};fail=true;await assert.rejects(step(initial,dependencies));
 fail=false;await step(initial,dependencies);assert.equal(ownedCalls,1);assert.equal(messages[0].cursor,0);
 await step(messages[0],dependencies);await step(messages[0],dependencies);
 const job=await db.get('user:a','job:scan');assert.equal(job.status,'complete');assert.equal(job.games.length,1);assert.equal(newsCalls,1);assert.ok(job.refreshAfter>Date.now());
});


test('finite fanout completes a large scan with bounded concurrency and no recursive chunk publishing',async t=>{
 const db=await temporaryStore(t),messages=[],games=Array.from({length:60},(_,i)=>({appid:i+1,name:`Game ${i+1}`,rtime_last_played:100,playtime_forever:60}));
 await db.put('sessions','batch-session',{user:{steamid:'1'}});
 await db.put('user:batch','job:scan',{jobId:'batch',sessionId:'batch-session',status:'running',cursor:-1,games:[],startedAt:Date.now()});
 let active=0,maxActive=0;
 const dependencies={db,config:{key:'test'},steam:{owned:async()=>games,updates:async g=>{active++;maxActive=Math.max(active,maxActive);await new Promise(r=>setTimeout(r,2));active--;if(g.appid===2)throw new Error('Steam unavailable');return {events:[{kind:'release'}]};},metadata:async()=>({genres:['Action'],categories:[38]})},enqueue:async m=>messages.push(m)};
 const initial={alias:'batch',type:'scan',jobId:'batch',cursor:-1};await step(initial,dependencies);assert.equal(messages.length,20);
 const chunks=messages.splice(0);for(const chunk of chunks){await step(chunk,dependencies);await step(chunk,dependencies);}
 assert.equal(messages.length,0,'Chunk workers must never publish more messages');
 const job=await db.get('user:batch','job:scan');assert.equal(job.status,'complete');assert.equal(job.done,60);assert.equal(job.failed,1);assert.equal(job.games.length,59);assert.equal(new Set(job.games.map(g=>g.appid)).size,59);assert.equal(maxActive,3);
 await step(initial,dependencies);assert.equal(messages.length,0);
});
test('initializer retry schedules only remaining work after partial fanout',async t=>{
 const db=await temporaryStore(t),messages=[];
 await db.put('user:retry','job:scan',{jobId:'retry',status:'running',cursor:6,total:15,games:[]});
 await step({alias:'retry',type:'scan',jobId:'retry',cursor:-1},{db,enqueue:async m=>messages.push(m)});
 assert.deepEqual(messages.map(m=>m.cursor),[6,9,12]);
});

test('friend A/B/A reuses isolated comparisons and releases admission after completion',async t=>{
 const db=await temporaryStore(t),messages=[],account={alias:'cache',sessionId:'cache-session'};
 const games=Array.from({length:135},(_,i)=>({appid:i+1,name:`Game ${i+1}`}));
 await db.put('sessions',account.sessionId,{user:{steamid:'me'}});
 const dependencies={db,config:{key:'test'},enqueue:async m=>messages.push(m),steam:{owned:async id=>id==='B'?games.slice(0,35):games,cachedMetadata:async()=>({genres:[],categories:[38]}),metadata:async()=>{throw new Error('warm comparisons must not call Steam Store');}}};
 for(const [friend,total] of [['A',135],['B',35]]){
   await startJob(account,'coop',{friend},dependencies);
   assert.equal(messages.length,1);await step(messages.shift(),dependencies);
   const result=await db.get('user:cache','job:coop');assert.equal(result.status,'complete');assert.equal(result.done,total);assert.equal(result.games.length,total);assert.equal(messages.length,0);
   assert.equal(await db.get('user:cache','admission:coop'),null);
 }
 const cached=await startJob(account,'coop',{friend:'A'},dependencies);
 assert.equal(cached.cached,true);assert.equal(cached.games.length,135);assert.equal(messages.length,0);
 await startJob(account,'coop',{friend:'A',mode:'all'},dependencies);assert.equal(messages.length,1);await step(messages.shift(),dependencies);
 await startJob({...account,alias:'other'},'coop',{friend:'A'},dependencies);assert.equal(messages.length,1,'another user cannot reuse this private comparison');
});
test('mixed cache hits and misses keep complete progress and bounded nonrecursive fanout',async t=>{
 const db=await temporaryStore(t),messages=[],account={alias:'mixed',sessionId:'mixed-session'};
 const games=Array.from({length:10},(_,i)=>({appid:i+1,name:`Game ${i+1}`}));let storeCalls=0;
 await db.put('sessions',account.sessionId,{user:{steamid:'me'}});
 const dependencies={db,config:{key:'test'},enqueue:async m=>messages.push(m),steam:{owned:async()=>games,cachedMetadata:async id=>id<=6?{categories:id===1?[]:[38]}:null,metadata:async id=>{storeCalls++;if(id===10)throw new Error('Store-Metadaten fehlen');return {categories:[38]};}}};
 await startJob(account,'coop',{friend:'A'},dependencies);await step(messages.shift(),dependencies);
 let job=await db.get('user:mixed','job:coop');assert.equal(job.total,10);assert.equal(job.done,6);assert.deepEqual(messages.map(m=>m.cursor),[0,3]);
 const chunks=messages.splice(0);for(const m of chunks){await step(m,dependencies);await step(m,dependencies);}
 job=await db.get('user:mixed','job:coop');assert.equal(job.status,'complete');assert.equal(job.done,10);assert.equal(job.failed,1);assert.equal(job.failures[0].appid,10);assert.equal(job.games.length,8);assert.equal(storeCalls,4);assert.equal(messages.length,0);
 assert.equal((await startJob(account,'coop',{friend:'A'},dependencies)).cached,true);
 job.startedAt=Date.now()-6*60000;await db.put('user:mixed','job:coop',job);await db.put('user:mixed',`coop-result:${job.friendKey}:online`,job);
 assert.equal((await startJob(account,'coop',{friend:'A'},dependencies)).status,'running');assert.equal(messages.length,1);
});

test('existing scan snapshots get corrected on a cache hit without starting another scan',async t=>{
 const db=await temporaryStore(t),account={alias:'old-news'},messages=[];
 await db.put('user:old-news','job:scan',{status:'complete',startedAt:Date.now(),games:[{appid:1,events:[{title:'Store Update 11.1.0',kind:'release'},{title:'Update 11.3.0',kind:'update'}]},{appid:2,events:[{title:'Store Update 11.1.0',kind:'release'}]}]});
 const result=await startJob(account,'scan',{}, {db,enqueue:async m=>messages.push(m)});
 assert.equal(result.cached,true);assert.equal(result.games.length,1);assert.equal(result.games[0].events.length,1);assert.equal(result.games[0].events[0].kind,'update');assert.equal(messages.length,0);
});
