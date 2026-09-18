import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseSearch,rankDiscover} from '../server/discovery.mjs';
test('search parser accepts numeric game IDs and tag arrays only, deduplicating results',()=>{
 const html='<a data-ds-appid="12" data-ds-tagids="[1,2,3]" class="search_result_row">Game</a>';
 assert.deepEqual(parseSearch(html+html+'<a data-ds-appid="4,5" data-ds-tagids="[1]">Bundle</a>'),[{appid:12,tags:['1','2','3']}]);
 assert.deepEqual(parseSearch('<a data-ds-appid="12" data-ds-tagids="broken">Bad</a>'),[]);
});
test('matches exclude owned games and explain real overlap; missing play history has no invented matches',()=>{
 const profile=[{appid:1,name:'Builder',playtime_forever:600,tags:['build','craft']}];
 const candidates=[{appid:1,tags:['build','craft']},{appid:2,tags:['build','craft']},{appid:3,tags:['racing']}];
 const result=rankDiscover(profile,candidates,new Set([1]));assert.equal(result[0].appid,2);assert.equal(result[0].match,100);assert.equal(result[0].reasons[0].name,'Builder');assert.equal(result.length,1);
 assert.deepEqual(rankDiscover([],candidates,new Set()),[]);
 assert.deepEqual(rankDiscover([{...profile[0],playtime_forever:0}],candidates,new Set()),[]);
});
test('log weighting prevents an idle-time outlier from eliminating other interests',()=>{
 const profile=[{appid:1,name:'Idle shooter',playtime_forever:120000,tags:['shoot']},{appid:2,name:'Builder',playtime_forever:6000,tags:['build']}];
 const candidates=[{appid:3,tags:['shoot']},{appid:4,tags:['build']}];
 const result=rankDiscover(profile,candidates,new Set([1,2]));assert.equal(result.length,2);assert.ok(result.find(g=>g.appid===4).match>40);
 assert.ok(result.find(g=>g.appid===3).match<95);
});
