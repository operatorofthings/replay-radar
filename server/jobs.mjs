import {randomUUID,createHash} from 'node:crypto';
import {storage,DAY,RETENTION} from './storage.mjs';
import {config} from './config.mjs';
import * as steam from './steam.mjs';
import {commonCoop} from './ranking.mjs';

let localTail=Promise.resolve();
const publicJob=j=>j?Object.fromEntries(Object.entries(j).filter(([k])=>!['todo','sessionId','friend','friendKey','jobId','cursor'].includes(k))):{status:'idle',games:[]};
export async function readJob(alias,type){const db=await storage();const job=await db.get(`user:${alias}`,`job:${type}`);if(job?.status==='running'&&Date.now()-job.updatedAt>30*60000){job.status='error';job.error='Der Scan wurde unterbrochen. Bitte erneut starten.';}return publicJob(job);}
async function enqueueBatch(messages){
 if(process.env.QUEUE_URL){
   const {SQSClient,SendMessageBatchCommand}=await import('@aws-sdk/client-sqs');const client=new SQSClient({});
   for(let i=0;i<messages.length;i+=10){const result=await client.send(new SendMessageBatchCommand({QueueUrl:process.env.QUEUE_URL,Entries:messages.slice(i,i+10).map((message,j)=>({Id:String(j),MessageBody:JSON.stringify(message),MessageGroupId:'steam-scans',MessageDeduplicationId:`${message.jobId}:fanout:${message.cursor}`}))}));if(result.Failed?.length)throw new Error('Scan-Pakete konnten nicht vollständig eingeplant werden.');}
 }else{for(const message of messages){const task=localTail.then(()=>step(message));localTail=task.catch(()=>{});}}
}
async function enqueue(message){return enqueueBatch([message]);}
async function dispatch(message,job,send){
 // One initialization fans out finite chunks. Chunk workers NEVER enqueue work.
 const messages=[];for(let cursor=job.cursor;cursor<job.total;cursor+=3)messages.push({...message,cursor});
 if(send){for(const item of messages)await send(item);}else await enqueueBatch(messages);
}
export async function startJob(account,type,{friend,mode='online'}={}){
 const db=await storage(),pk=`user:${account.alias}`,sk=`job:${type}`;
 const previous=await db.get(pk,sk),now=Date.now(),friendKey=friend?createHash('sha256').update(account.alias+friend).digest('hex'):undefined;
 if(previous?.status==='running'&&now-previous.updatedAt<30*60000){if(type==='coop'&&(previous.friendKey!==friendKey||previous.mode!==mode))throw new Error('Der bisherige Freundesvergleich läuft noch. Bitte kurz warten.');return publicJob(previous);}
 if(type==='scan'&&previous?.status==='complete'&&now-previous.startedAt<DAY*1000)return {...publicJob(previous),cached:true};
 if(type==='coop'&&previous?.status==='complete'&&previous.friendKey===friendKey&&previous.mode===mode&&now-previous.startedAt<DAY*1000)return {...publicJob(previous),cached:true};
 if(!await db.claim(pk,`admission:${type}`,{at:now},type==='scan'&&previous?.status==='complete'?DAY:60))throw new Error('Dieser Scan wurde gerade gestartet. Bitte kurz warten.');
 const job={jobId:randomUUID(),sessionId:account.sessionId,friend,friendKey,mode,cursor:-1,todo:[],status:'running',total:0,done:0,failed:0,truncated:0,metadataFailed:0,games:[],startedAt:now,updatedAt:now};
 await db.put(pk,sk,job);try{await enqueue({alias:account.alias,type,jobId:job.jobId,cursor:-1});}catch(e){job.status='error';job.error='Der Scan konnte nicht gestartet werden.';await db.put(pk,sk,job);await db.delete(pk,`admission:${type}`);throw e;}
 return publicJob(job);
}
export async function step(message,dependencies={}){
 const db=dependencies.db||await storage(),remote=dependencies.steam||steam;
 const {alias,type,jobId}=message,pk=`user:${alias}`,sk=`job:${type}`;const job=await db.get(pk,sk);
 if(!job||job.jobId!==jobId||job.status!=='running')return;
 if(message.cursor===-1&&job.cursor>=0){await dispatch(message,job,dependencies.enqueue);return;}
 if(message.cursor<job.cursor)return;
 if(message.cursor!==job.cursor)throw new Error('Ungültiger Scan-Fortschritt.');
 try {
   if(job.cursor===-1){
     const account=await db.get('sessions',job.sessionId);if(!account)throw new Error('Deine Sitzung ist abgelaufen. Bitte erneut anmelden.');
     const cfg=dependencies.config||await config(),key=account.key||cfg.key;
     let library=await db.get(pk,'library');
     if(!library||Date.now()-library.at>DAY*1000){library={at:Date.now(),games:await remote.owned(account.user.steamid,key)};await db.put(pk,'library',library);}
     if(type==='scan'){
       job.recentGenres={};job.recentGenreGames=0;job.libraryCount=library.games.length;job.unknownCount=library.games.filter(g=>g.playtime_forever>0&&!g.rtime_last_played).length;job.unplayedCount=library.games.filter(g=>!g.playtime_forever&&!g.rtime_last_played).length;
       job.todo=library.games.filter(g=>g.rtime_last_played>0).sort((a,b)=>b.playtime_forever-a.playtime_forever);
     }else{
       const ownedByFriend=new Set((await remote.owned(job.friend,key)).map(g=>g.appid));job.todo=library.games.filter(g=>ownedByFriend.has(g.appid));
     }
     job.total=job.todo.length;job.cursor=0;job.queueMode='fanout-v1';delete job.sessionId;delete job.friend;
   }else{
     // A bounded group reduces queue round trips; Store requests remain serialized.
     const started=Date.now(),batch=job.todo.slice(job.cursor,job.cursor+3);
     const results=await Promise.all(batch.map(async game=>{
       const result={failed:0,truncated:0,metadataFailed:0,recentGenres:{},recentGenreGames:0};
       try{
         let meta;
         if(type==='scan'){
           if(game.playtime_2weeks>0){try{meta=await remote.metadata(game.appid);for(const genre of meta.genres||[])result.recentGenres[genre]=game.playtime_2weeks/Math.max(1,meta.genres.length);result.recentGenreGames=1;}catch{result.metadataFailed++;}}
           const news=await remote.updates(game);if(news.truncated)result.truncated++;
           if(news.events.length){if(!meta)try{meta=await remote.metadata(game.appid);}catch{result.metadataFailed++;}
             result.game={appid:game.appid,name:game.name,icon:game.icon,lastPlayed:game.rtime_last_played,minutes:game.playtime_forever,genres:[],categories:[],...meta,...news};}
         }else{meta=await remote.metadata(game.appid);if(commonCoop([game],[game],new Map([[game.appid,meta]]),job.mode).length)result.game={appid:game.appid,name:game.name,icon:game.icon,...meta};}
       }catch{result.failed++;}
       return result;
     }));
     for(const result of results){
       for(const field of ['failed','truncated','metadataFailed','recentGenreGames'])job[field]=(job[field]||0)+result[field];
       job.recentGenres ||= {};for(const [genre,minutes] of Object.entries(result.recentGenres))job.recentGenres[genre]=(job.recentGenres[genre]||0)+minutes;
       if(result.game)job.games.push(result.game);
     }
     job.processingMs=(job.processingMs||0)+Date.now()-started;
     job.timedGames=(job.timedGames||0)+batch.length;
     job.cursor+=batch.length;job.done=job.cursor;
   }
   if(job.cursor>=job.total){job.status='complete';job.finishedAt=Date.now();job.refreshAfter=job.startedAt+DAY*1000;job.expiresAt=Date.now()+RETENTION*1000;delete job.todo;}
   job.updatedAt=Date.now();await db.put(pk,sk,job);
 }catch(e){job.status='error';job.error=e.message;delete job.todo;await db.put(pk,sk,job);await db.delete(pk,`admission:${type}`);return;}
 // Only the initializer publishes chunks. Retrying it resumes at the persisted
 // cursor; completed/duplicate chunks cannot create another invocation chain.
 if(message.cursor===-1&&job.status==='running')await dispatch(message,job,dependencies.enqueue);
}
export async function worker(event){for(const record of event.Records)await step(JSON.parse(record.body));}
