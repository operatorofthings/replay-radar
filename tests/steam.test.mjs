import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestJson} from '../server/steam.mjs';
test('temporary network failures retry once; permanent HTTP failures do not retry',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;if(calls===1)throw new TypeError('network error');return new Response('{"ok":true}');});
 assert.deepEqual(await requestJson('https://example.invalid'),{ok:true});assert.equal(calls,2);
 calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return new Response('',{status:403});});
 await assert.rejects(requestJson('https://example.invalid'),{status:403});assert.equal(calls,1);
 calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;throw new TypeError('network error');});
 await assert.rejects(requestJson('https://example.invalid'));assert.equal(calls,2);
});
