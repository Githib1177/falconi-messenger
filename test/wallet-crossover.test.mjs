import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {PGlite} from '@electric-sql/pglite';
import {guestToken,verifyGuestToken} from '../lib/wallet-guest-token.js';
import {createWalletHandler} from '../api/wallet.js';
import {createWalletSaveHandler} from '../api/wallet-save.js';
import {createSessionCookie} from '../api/_auth.js';
const config={issuerId:'123',classSuffix:'test',key:{private_key:'synthetic-test-key'}};
const widget=readFileSync(new URL('../guest-wallet.js',import.meta.url),'utf8');
const ui=readFileSync(new URL('../wallet.js',import.meta.url),'utf8');
const messenger=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},json(v){this.body=v;return this;},end(v){this.body=v;return this;}});
const settle=()=>new Promise(r=>setTimeout(r,0));

test('guest tokens reject tampering, other keys, invalid types and malformed identifiers',()=>{
 const id=randomUUID(),token=guestToken(id,config);
 assert.equal(verifyGuestToken(token,config),id);
 for(const bad of [null,[],{},'',token+'x',token.slice(0,-1)+'!',randomUUID()+token.slice(36)])assert.equal(verifyGuestToken(bad,config),null);
 assert.equal(verifyGuestToken(token,{key:{private_key:'other-key'}}),null);
});

test('cross-language original pages: 3 languages × 2 page types × 8 booking combinations',async t=>{
 for(const lang of ['cs','en','de'])for(const page of ['checkin','codes'])for(const done of [false,true])for(const unpaid of [false,true])for(const box of [false,true]){
  await t.test(`${lang}/${page}: done=${done}, unpaid=${unpaid}, box=${box}`,async()=>{
   const original=readFileSync(new URL(`./fixtures/guest/${lang}-${page}.html`,import.meta.url),'utf8');
   const token=guestToken(randomUUID(),config);
   const params=new URLSearchParams({alf:'https://alfred.previo.app/login/DEMOXX',...(done?{done:'1'}:{}),...(unpaid?{unpaid:'1'}:{}),...(box?{box:'482751'}:{})});
   const fragment='wallet-'+Buffer.from(token).toString('hex');
   // Previo treats the last hyphen-delimited fragment as an unquoted CSS selector.
   assert.match(fragment.split('-').at(-1),/^[0-9a-f]+$/);
   const dom=new JSDOM(original,{runScripts:'dangerously',url:`https://www.pensionfalconi.cz/${lang}/${page}/?${params}#${fragment}`});
   await settle();
   const root=dom.window.document.querySelector('#falconi-guest');
   const before=root.textContent,links=[...root.querySelectorAll('a')].map(a=>a.href);
   let networkCalls=0;dom.window.fetch=()=>{networkCalls++;throw new Error('No background requests allowed');};
   dom.window.eval(widget);
   const card=root.querySelector('#falconi-wallet-save');assert.ok(card);assert.equal(root.querySelector('.status').nextElementSibling,card);
   assert.equal(card.querySelector('a').getAttribute('aria-label'),{cs:'Uložit do Google Wallet',en:'Save to Google Wallet',de:'In Google Wallet speichern'}[lang]);
   const href=new URL(card.querySelector('a').href);assert.equal(href.origin,'https://falconi-messenger.vercel.app');assert.equal(href.searchParams.get('token'),token);assert.equal(href.searchParams.size,1);
   assert.equal(card.querySelector('a').rel,'noopener noreferrer');assert.equal(networkCalls,0);
   card.remove();assert.equal(root.textContent,before);assert.deepEqual([...root.querySelectorAll('a')].map(a=>a.href),links);
   // Old links and invalid fragments leave the original page intact.
   for(const hash of ['', '#wallet=javascript:alert(1)', '#wallet=%3Cscript%3E']){dom.window.history.replaceState(null,'',dom.window.location.pathname+dom.window.location.search+hash);dom.window.eval(widget);assert.equal(root.querySelector('#falconi-wallet-save'),null);assert.equal(root.textContent,before);}
   dom.window.close();
  });
 }
});

test('real SQL + authenticated API: all states, two guests, expiry, tampering and overlapping updates',async()=>{
 const previous={db:process.env.DATABASE_URL,secret:process.env.SESSION_SECRET};
 process.env.DATABASE_URL='isolated';process.env.SESSION_SECRET='isolated-secret';
 const db=new PGlite();
 const sql=async(strings,...values)=>(await db.query(strings.reduce((s,p,i)=>s+(i?'$'+i:'')+p,''),values)).rows;
 let hold=null,objects=[],fail=false;
 const issue=createWalletHandler({connect:()=>sql,getConfig:()=>config,putObject:async object=>{if(fail)throw new Error('Google nepotvrdil aktualizaci.');objects.push(object);if(hold)await hold;},makeSaveUrl:id=>'https://pay.google.com/gp/v/save/'+id});
 const save=createWalletSaveHandler({connect:()=>sql,getConfig:()=>config,makeSaveUrl:id=>'https://pay.google.com/gp/v/save/'+id});
 const base={alfred:'DEMOXX',boxCode:'482751',operatorConfirmed:true,releaseAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()};
 const issueCall=async body=>{const res=response();await issue({method:'POST',headers:{cookie:createSessionCookie().split(';')[0]},body:{...base,...body}},res);return res;};
 const saveCall=async token=>{const res=response();await save({method:'GET',query:{token,done:'1',box:'999999'}},res);return res;};
 try{
  let first;
  for(const checkinComplete of [false,true])for(const paymentComplete of [false,true])for(const lockerReady of [false,true]){
   const res=await issueCall({checkinComplete,paymentComplete,lockerReady});assert.equal(res.code,200);
   const ready=checkinComplete&&paymentComplete&&lockerReady;assert.equal(res.body.state,ready?'ready':'pending');assert.equal(JSON.stringify(objects.at(-1)).includes('482751'),ready);
   if(!first)first=res.body;else{assert.equal(res.body.passId,first.passId);assert.equal(res.body.guestToken,first.guestToken);}
   const saved=await saveCall(res.body.guestToken);assert.equal(saved.code,302);assert.equal(saved.headers.Location,'https://pay.google.com/gp/v/save/123.'+first.passId);
  }
  const other=await issueCall({alfred:'OTHERX',checkinComplete:false,paymentComplete:false,lockerReady:false});assert.notEqual(other.body.passId,first.passId);assert.notEqual(other.body.guestToken,first.guestToken);
  assert.equal((await saveCall(first.guestToken)).headers.Location,'https://pay.google.com/gp/v/save/123.'+first.passId);
  assert.equal((await saveCall(other.body.guestToken)).headers.Location,'https://pay.google.com/gp/v/save/123.'+other.body.passId);
  assert.equal((await saveCall(first.passId+'.'+'a'.repeat(43))).code,404);
  assert.equal((await saveCall(guestToken(randomUUID(),config))).code,404);
  // Hold the external update while a second authenticated request arrives.
  let release;hold=new Promise(r=>release=r);const before=objects.length;
  const updating=issueCall({checkinComplete:true,paymentComplete:false,lockerReady:true});
  while(objects.length===before)await settle();
  assert.equal((await issueCall({checkinComplete:true,paymentComplete:true,lockerReady:true})).code,409);
  assert.equal((await saveCall(first.guestToken)).code,503);
  release();await updating;hold=null;
  assert.ok(!JSON.stringify(objects.at(-1)).includes('482751'));assert.equal((await saveCall(first.guestToken)).code,302);
  fail=true;assert.equal((await issueCall({checkinComplete:true,paymentComplete:false,lockerReady:true})).code,503);
  assert.equal((await saveCall(first.guestToken)).code,404); // uncertain update must not authorize a new save
  fail=false;assert.equal((await issueCall({checkinComplete:false,paymentComplete:false,lockerReady:false})).code,200);
  assert.equal((await saveCall(first.guestToken)).code,302);
  await sql`UPDATE wallet_passes SET expires_at=${Date.now()-1} WHERE pass_id=${first.passId}`;
  assert.equal((await saveCall(first.guestToken)).code,404);
  assert.equal((await saveCall(other.body.guestToken)).code,302);
 }finally{await db.close();for(const [key,value] of [['DATABASE_URL',previous.db],['SESSION_SECRET',previous.secret]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test('Messenger original generators attach one card, clear stale identity, and keep other destinations unchanged',async()=>{
 const inputs=['alf','box','guest','base','smsLang','walletUnused'];
 const dom=new JSDOM('<div class="card"><div id="bookingState"></div></div>'+inputs.map(id=>`<input id="${id}">`).join('')+['done','unpaid','noSendBoxInLink'].map(id=>`<input type="checkbox" id="${id}">`).join('')+'<button id="clear"></button>',{runScripts:'outside-only',url:'https://example.test'});
 const w=dom.window,q=id=>w.document.getElementById(id);q('alf').value='DEMOXX';q('guest').value='Guest A';q('base').value='https://www.pensionfalconi.cz';q('box').value='482751';
 const token=guestToken(randomUUID(),config);let resolve;
 w.fetch=()=>new Promise(r=>resolve=r);w.eval(ui);
 // Execute the actual original URL builders, not a copy of their logic.
 const build=messenger.slice(messenger.indexOf('    function buildUrl('),messenger.indexOf('    function deriveAlfUrl('));
 const derive=messenger.slice(messenger.indexOf('    function deriveAlfUrl('),messenger.indexOf('    function deriveAlfUrl(')+1000).split('\n    function ')[0];
 const codes=messenger.slice(messenger.indexOf('    function buildCodesLink('),messenger.indexOf('    function codesPrefix('));
 w.eval("const Q=s=>document.querySelector(s);const enc=v=>encodeURIComponent(v.trim());"+build+derive+codes);
 q('walletRelease').value='2026-09-19T14:00';q('walletExpires').value='2026-09-21T10:00';q('walletConfirm').checked=true;q('walletSync').click();
 resolve({ok:true,json:async()=>({state:'pending',saveUrl:'https://pay.google.com/gp/v/save/test',guestToken:token})});await settle();
 assert.equal(q('walletOpen').hidden,false);
 for(const lang of ['cs','en','de']){
  const url=w.buildUrl('https://www.pensionfalconi.cz',`/${lang}/checkin/`,{alf:'https://alfred.previo.app/login/DEMOXX',unpaid:1});assert.equal(new URL(url).hash,'#wallet-'+Buffer.from(token).toString('hex'));assert.equal(new URL(url).searchParams.get('unpaid'),'1');
  q('smsLang').value=lang==='cs'?'cz':lang;assert.equal(new URL(w.buildCodesLink(true)).hash,'#wallet-'+Buffer.from(token).toString('hex'));
 }
 assert.equal(w.falconiWalletLink('https://hillside18.cz/cs/checkin/'),'https://hillside18.cz/cs/checkin/');
 assert.equal(w.falconiWalletLink('https://www.pensionfalconi.cz/cs/other/'),'https://www.pensionfalconi.cz/cs/other/');
 q('alf').value='OTHERX';q('alf').dispatchEvent(new w.Event('input'));
 assert.equal(new URL(w.buildUrl(q('base').value,'/cs/checkin/',{})).hash,'');assert.equal(q('walletOpen').hidden,true);
 dom.window.close();
});

test('UI crossover: edits, reset, hidden locker code, failed update and late response cannot reuse an old link',async t=>{
 for(const scenario of ['guest','alf','box','done','unpaid','walletReady','walletRelease','walletExpires','noSendBoxInLink','clear','history','failure','late-response'])await t.test(scenario,async()=>{
  const dom=new JSDOM('<div class="card"><div id="bookingState"></div></div>'+['alf','box','guest'].map(id=>`<input id="${id}">`).join('')+['done','unpaid','noSendBoxInLink'].map(id=>`<input id="${id}" type="checkbox">`).join('')+'<button id="clear"></button>',{runScripts:'outside-only'});
  const w=dom.window,q=id=>w.document.getElementById(id);let resolve;
  w.fetch=()=>new Promise(r=>resolve=r);q('alf').value='DEMOXX';w.eval(ui);
  q('walletRelease').value='2026-09-19T14:00';q('walletExpires').value='2026-09-21T10:00';
  const token=guestToken(randomUUID(),config),url='https://www.pensionfalconi.cz/cs/checkin/?alf=DEMOXX';
  const success=()=>resolve({ok:true,json:async()=>({state:'ready',guestToken:token,saveUrl:'https://pay.google.com/gp/v/save/test'})});
  q('walletConfirm').checked=true;q('walletSync').click();success();await settle();
  assert.ok(w.falconiWalletLink(url).includes('#wallet-'));
  if(scenario==='clear')q('clear').click();
  else if(scenario==='history')w.document.dispatchEvent(new w.Event('falconi:stay-loaded'));
  else if(scenario==='failure'||scenario==='late-response'){
   q('walletConfirm').checked=true;q('walletSync').click();assert.equal(w.falconiWalletLink(url),url);
   if(scenario==='failure')resolve({ok:false,json:async()=>({error:'Test connection failure'})});
   else{q('guest').value='Guest B';q('guest').dispatchEvent(new w.Event('input'));success();}
   await settle();
  }else{
   const field=q(scenario);if(field.type==='checkbox')field.checked=!field.checked;else field.value=scenario==='alf'?'OTHERX':scenario==='guest'?'Guest B':scenario==='box'?'999999':'2026-09-22T10:00';
   // Even before the input handler runs, URL generation must fail closed.
   assert.equal(w.falconiWalletLink(url),url);field.dispatchEvent(new w.Event('input'));
  }
  assert.equal(w.falconiWalletLink(url),url);assert.equal(q('walletOpen').hidden,true);assert.equal(q('walletCopy').hidden,true);
  dom.window.close();
 });
});
