import test from 'node:test';
import assert from 'node:assert/strict';
import handler,{authenticated} from '../api/night-summary.js';
const key='test-only-'.repeat(5);
const res=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.value=v;return this;}});
test('night summary uses its own token and production stays disabled',async()=>{
 assert.equal(authenticated('Bearer '+key,key),true);assert.equal(authenticated('Bearer other',key),false);assert.equal(authenticated('',undefined),false);
 process.env.NIGHT_SUMMARY_TOKEN=key;process.env.NIGHT_AI_ENABLED='false';process.env.NIGHT_SUMMARY_TEST='true';
 const historyId='night_'+'1'.repeat(64),request={method:'POST',headers:{authorization:'Bearer '+key,'idempotency-key':historyId},body:{historyId,to:'+420777000000',text:'FALCONI | AI shrnutí | TEST — testovací zpráva'}};
 const r=res();await handler(request,r);assert.equal(r.code,409);
 const unauth=res();await handler({...request,headers:{}},unauth);assert.equal(unauth.code,401);
 const wrongId=res();await handler({...request,headers:{...request.headers,'idempotency-key':'other'}},wrongId);assert.equal(wrongId.code,400);
 delete process.env.NIGHT_SUMMARY_TOKEN;delete process.env.NIGHT_AI_ENABLED;delete process.env.NIGHT_SUMMARY_TEST;
});
