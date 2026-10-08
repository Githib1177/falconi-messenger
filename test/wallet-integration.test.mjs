import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { putWalletObject, walletSaveUrl, walletConfig } from '../lib/google-wallet.js';
import handler from '../api/wallet.js';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const config={key:{client_email:'test@example.test',private_key:privateKey.export({type:'pkcs8',format:'pem'})}};
test('save link contains only stable object reference, with a valid signature',()=>{
  const token=walletSaveUrl('123.test',config).split('/save/')[1];
  const [header,payload,signature]=token.split('.');
  assert.equal(verify('RSA-SHA256',Buffer.from(header+'.'+payload),publicKey,Buffer.from(signature,'base64url')),true);
  assert.deepEqual(JSON.parse(Buffer.from(payload,'base64url')).payload,{genericObjects:[{id:'123.test'}]});
});
test('Google failures never return a successful update; create fallback keeps identity',async()=>{
  const obj={id:'123.test',textModulesData:[]};let calls=[];
  const fake=async(url,options)=>{calls.push({url,...options});if(url.includes('oauth2'))return {ok:true,json:async()=>({access_token:'test'})};if(options.method==='PUT')return {ok:false,status:404};return {ok:true,json:async()=>obj};};
  await putWalletObject(obj,config,fake);
  assert.deepEqual(calls.map(c=>c.method),['POST','PUT','POST']);
  assert.equal(JSON.parse(calls[1].body).id,JSON.parse(calls[2].body).id);
  await assert.rejects(()=>putWalletObject(obj,config,async()=>({ok:false,status:503})),/odmítl přihlášení/);
  await assert.rejects(()=>putWalletObject(obj,config,async(url)=>url.includes('oauth2')?{ok:true,json:async()=>({access_token:'test'})}:{ok:false,status:403}),/nepotvrdil/);
});
test('Wallet disabled by default; unauthenticated requests cannot reach database or Google',async()=>{
  assert.throws(()=>walletConfig({}),/není.*zapnutý/);
  const response={setHeader(){},status(code){this.code=code;return this;},json(value){this.value=value;return this;}};
  await handler({method:'POST',headers:{},body:{checkinComplete:true,paymentComplete:true,lockerReady:true}},response);
  assert.equal(response.code,401);
});
test('reception confirmation is accepted only as a server snapshot',async()=>{
  const {accessDecision}=await import('../lib/wallet-pass.js');
  const s={reservationId:'x',alfred:'DEMOXX',releaseAt:1,expiresAt:9999,lockerAssignmentId:'a'};
  const p={source:'reception',hotelId:'85',reservationId:'x',alfredCode:'DEMOXX',verifiedAt:100,active:true,checkinComplete:true,paymentComplete:true};
  const l={reservationId:'x',assignmentId:'a',programmingConfirmed:true,cardPrepared:true,code:'482751',validFrom:1,validUntil:9999};
  assert.equal(accessDecision(s,p,l,100),'ready');
  assert.equal(accessDecision(s,{...p,source:'browser'},l,100),'pending');
});
test('UI refuses unconfirmed request and hides another guest link during an in-flight change',async()=>{
  const dom=new JSDOM('<div class="card"><div id="bookingState"></div></div><input id="alf" value="DEMOXX"><input id="box"><input id="done" type="checkbox"><input id="unpaid" type="checkbox"><button id="clear"></button>',{runScripts:'outside-only',url:'https://example.test'});
  let resolve,calls=0;
  dom.window.fetch=()=>{calls++;return new Promise(r=>resolve=r);};
  dom.window.eval(readFileSync(new URL('../wallet.js',import.meta.url),'utf8'));
  const q=id=>dom.window.document.getElementById(id);
  q('walletSync').click();assert.equal(calls,0);
  q('walletRelease').value='2026-09-19T15:00';q('walletExpires').value='2026-09-20T10:00';q('walletConfirm').checked=true;
  q('walletSync').click();assert.equal(calls,1);
  q('alf').value='OTHERX';q('alf').dispatchEvent(new dom.window.Event('input'));
  resolve({ok:true,json:async()=>({state:'ready',saveUrl:'https://pay.google.com/gp/v/save/test'})});
  await new Promise(r=>setTimeout(r,10));
  assert.equal(q('walletOpen').hidden,true);assert.equal(q('walletCopy').hidden,true);assert.equal(q('walletReady').checked,false);
  q('walletReady').checked=true;q('walletConfirm').checked=true;
  dom.window.document.dispatchEvent(new dom.window.Event('falconi:stay-loaded'));
  assert.equal(q('walletConfirm').checked,false);assert.equal(q('walletReady').checked,false);assert.equal(q('walletExpires').value,'');
  dom.window.close();
});
