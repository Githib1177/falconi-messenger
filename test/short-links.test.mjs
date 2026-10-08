import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {PGlite} from '@electric-sql/pglite';import {JSDOM} from 'jsdom';
import {createGuestLinkHandler} from '../api/guest-link.js';import {createSessionCookie} from '../api/_auth.js';
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;},end(v){this.body=v;return this;}});
test('Falconi short links preserve all page/state combinations, immutable targets and expiry',async()=>{
 const old=process.env.SESSION_SECRET;process.env.SESSION_SECRET='test-only';const db=new PGlite();
 const sql=async(strings,...values)=>(await db.query(strings.reduce((s,p,i)=>s+(i?'$'+i:'')+p,''),values)).rows;
 const handler=createGuestLinkHandler({connect:()=>sql});const cookie=createSessionCookie().split(';')[0];
 const call=async(method,body,query={},auth=true)=>{const r=response();await handler({method,body,query,headers:{cookie:auth?cookie:''}},r);return r;};
 try{
 assert.equal((await call('POST',{urls:[]},{},false)).code,401);assert.equal((await call('POST',{urls:['https://evil.test/cs/checkin/']})).code,400);
 const pairs=[];
 for(const path of ['checkin','codes'])for(const done of [false,true])for(const unpaid of [false,true])for(const box of [false,true]){
  const urls=['cs','en','de'].map(l=>{const u=new URL('https://www.pensionfalconi.cz/'+l+'/'+path+'/');u.searchParams.set('alf','https://alfred.previo.app/login/DEMOXX');if(done)u.searchParams.set('done','1');if(unpaid)u.searchParams.set('unpaid','1');if(box)u.searchParams.set('box','482751');u.hash='wallet-synthetic';return u.href;});
  const r=await call('POST',{urls});assert.equal(r.code,200);pairs.push(...r.body.urls.map((u,i)=>[u.split('/').at(-1),urls[i]]));
 }
 for(const [id,url] of pairs){const r=await call('GET',null,{id});assert.equal(r.code,302);assert.equal(r.headers.Location,url);assert.equal(r.headers['Cache-Control'],'no-store');}
 await sql`UPDATE guest_short_links SET expires_at=1`;assert.equal((await call('GET',null,{id:pairs[0][0]})).code,404);
 }finally{await db.close();if(old===undefined)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=old;}
});
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8'),short=fs.readFileSync(new URL('../short-links.js',import.meta.url),'utf8');
test('short link UI preserves history data, fails closed and rejects changed guest responses',async()=>{
 const dom=new JSDOM(html,{runScripts:'outside-only',url:'https://falconi-messenger.vercel.app'}),w=dom.window,q=id=>w.document.getElementById(id);let reply,requests=0;
 w.fetch=async(url)=>{if(url==='/api/guest-link'){requests++;return new Promise(r=>reply=r);}return {ok:true,json:async()=>[]};};
 for(const script of w.document.querySelectorAll('script:not([src])'))w.eval(script.textContent);
 q('alf').value='DEMOXX';q('done').checked=true;q('unpaid').checked=false;q('noSendBoxInLink').checked=false;q('box').value='482751';
 w.eval(short);
 const pending=w.falconiPrepareLinks();const urls=['A','B','C'].map(c=>'https://falconi-messenger.vercel.app/s/'+c.repeat(22));
 reply({ok:true,json:async()=>({urls})});await pending;
 assert.ok(q('smsCZ').value.includes(urls[0]));assert.ok(!q('smsCZ').value.includes('box='));assert.ok(w.falconiOriginalLink(urls[0]).includes('box=482751'));assert.ok(w.falconiOriginalLink(urls[0]).includes('done=1'));
 await w.falconiPrepareLinks();assert.equal(requests,1);
 q('alf').value='OTHERX';const late=w.falconiPrepareLinks();q('alf').value='THIRDX';reply({ok:true,json:async()=>({urls})});await assert.rejects(late,/změnily/);assert.equal(q('smsCZ').value,'');
 const failed=w.falconiPrepareLinks();reply({ok:false,json:async()=>({error:'Storage offline'})});await assert.rejects(failed,/offline/);assert.equal(q('smsCZ').value,'');
 w.close();
});
