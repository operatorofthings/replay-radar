import {test} from 'node:test';
import assert from 'node:assert/strict';
import {classify,reclassifyEvents,refreshGameEvents,relevantEvents,scoreEvents,commonCoop,scoreGame,wheelSegments,pickSegment} from '../server/ranking.mjs';
test('release outranks DLC, major and ordinary updates even when many small updates arrive',()=>{
 assert.equal(classify({title:'Version 1.0 is out now!'}),'release');
 assert.equal(classify({title:'New expansion available now'}),'dlc');
 assert.equal(classify({title:'Major update is live'}),'major');
 assert.equal(classify({title:'0.7 update'}),'update');
 assert.ok(scoreEvents([{kind:'release'}])>scoreEvents(Array(60).fill({kind:'dlc'})));
 assert.ok(scoreEvents([{kind:'dlc'}])>scoreEvents(Array(60).fill({kind:'major'})));
 assert.ok(scoreEvents([{kind:'major'}])>scoreEvents(Array(60).fill({kind:'update'})));
});
test('excludes promotions, future announcements and maintenance headlines',()=>{
 for(const title of ['1.0 coming soon','Expansion launches on October 1','1.0 preview','1.0 announcement','Update roadmap','New update sale','Hotfix 1.0.3','DLC soundtrack released','Update next week'])assert.equal(classify({title}),null,title);
 assert.equal(classify({title:'Update 1.0.3'}),'update');
});
test('only official news strictly after last played, without future items or duplicates',()=>{
 const row={gid:'1',title:'1.0 is out now',date:200,feedname:'steam_community_announcements'};
 assert.equal(relevantEvents([row,row,{...row,gid:'2',date:100},{...row,gid:'3',date:400},{...row,gid:'4',feedname:'pcgamer'}],100,300).length,1);
 assert.deepEqual(relevantEvents([row],0,300),[]);
});
test('custom weights change the score predictably',()=>assert.equal(scoreEvents([{kind:'release'},{kind:'dlc'}],{release:10,dlc:90}),90.4));
test('coop requires ownership by both and correct game category',()=>{
 const mine=[{appid:1},{appid:2},{appid:3},{appid:4}];const theirs=[{appid:1},{appid:2},{appid:3}];
 const metadata=new Map([[1,{categories:[38]}],[2,{categories:[39]}],[3,{categories:[1]}],[4,{categories:[38]}]]);
 assert.deepEqual(commonCoop(mine,theirs,metadata),[{appid:1}]);
 assert.deepEqual(commonCoop(mine,theirs,metadata,'all'),[{appid:1},{appid:2}]);
});

test('score differentiates freshness and rewards variety only with real recent data',()=>{
 const now=1800000000,base={genres:['Simulation'],events:[{kind:'release',date:now-86400}]};
 const plain=scoreGame(base,undefined,{},now),varied=scoreGame(base,undefined,{Action:120},now);
 assert.equal(plain.variety,0);assert.equal(varied.variety,3);
 assert.ok(varied.score>scoreGame(base,undefined,{Simulation:120},now).score);
 assert.ok(plain.score>scoreGame({...base,events:[{kind:'release',date:now-86400*365}]},undefined,{},now).score);
 assert.ok(scoreGame({events:Array.from({length:500},()=>({kind:'dlc',date:now})),genres:['Simulation']},undefined,{Action:1},now).score<100);
});
test('weighted wheel intervals, selection and displayed probabilities agree including hundreds of games',()=>{
 const segments=wheelSegments([{appid:1,score:100},{appid:2,score:0}],true);
 assert.equal(segments[0].chance,.75);assert.equal(pickSegment(segments,.749).game.appid,1);assert.equal(pickSegment(segments,.75).game.appid,2);
 const many=wheelSegments(Array.from({length:500},(_,appid)=>({appid,score:appid%110})),true);
 assert.equal(many.length,500);assert.ok(Math.abs(many.at(-1).end-1)<1e-12);
 for(const s of many)assert.equal(pickSegment(many,(s.start+s.end)/2).game.appid,s.game.appid);
});

test('release detection uses whole versions and launch evidence, excluding store rotations',()=>{
 for(const title of ['Store Update 11.1.0','Store Update 11.2.0','Store Update 1.0','Shop Update 1.0 is out now','Item Shop rotation'])assert.equal(classify({title}),null,title);
 for(const version of ['11.1.0','0.1.0','2.1.0','101.0','1.0.1','1.0.0.1','1.0-beta','1.0rc1'])assert.equal(classify({title:`Update ${version} is out now`}),'update',version);
 for(const title of ['Version 1.0 is out now!','v1.0 has launched','Update 1.0.0 released','Full release is live','We are out of early access!'])assert.equal(classify({title}),'release',title);
 assert.equal(classify({title:'Update 1.0'}),null);
 assert.equal(classify({title:'DLC 1.0 available now'}),'dlc');
 assert.equal(classify({title:'Version 1.0 coming soon'}),null);
});
test('stored misclassifications are corrected without fetching news or changing coop ownership',()=>{
 const events=[{id:'shop',title:'Store Update 11.1.0',kind:'release',date:100},{id:'patch',title:'Update 11.1.0',kind:'release',date:200}];
 const games=refreshGameEvents([{appid:1,events},{appid:2,events:[events[0]]},{appid:3,categories:[38]}]);
 assert.deepEqual(games.map(g=>g.appid),[1,3]);assert.equal(games[0].events[0].kind,'update');assert.equal(games[0].events.length,1);
 assert.equal(scoreGame(games[0]).base,15);assert.equal(events[1].kind,'release','Do not mutate persisted snapshots');
 assert.deepEqual(reclassifyEvents(games[0].events),games[0].events);
});

test('Dragonwilds announcements and surveys do not score; actual full release still counts',()=>{
 const excluded=["Dragonwilds Is Leaving Early Access. Our Price Isn't.","We're leaving Early Access and launching on consoles on September 15th!",'Our 0.12.1 Update Survey is now live!',"Kuldra’s Saga - An Update From Mod Dutch",'Our 0.12 Update Survey is now live!','Our 0.11 Update Survey is now live!','Full release','1.0 release','Update 1.0 will be available soon','Our 1.0 release date','1.0 launches in October','DLC launch','Full release next month'];
 for(const title of excluded)assert.equal(classify({title}),null,title);
 const title='Eye on Ashenfall | Our 1.0 Release is live!';assert.equal(classify({title}),'release');
 const events=reclassifyEvents([...excluded.map(title=>({title,kind:'release',date:100})),{title,kind:'release',date:200}]);
 assert.equal(events.length,1);assert.equal(scoreGame({events},undefined,{},200).depth,0);assert.equal(scoreGame({events},undefined,{},200).score,104);
});
