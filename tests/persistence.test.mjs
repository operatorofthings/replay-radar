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
import {step} from '../server/jobs.mjs';
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
 await request('/api/preferences',{appid:123,action:'restore'});assert.equal((await(await request('/api/preferences')).json()).preferences.length,0);
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
