import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const page=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const wallet=readFileSync(new URL('../wallet.js',import.meta.url),'utf8');
const send=page.slice(page.indexOf('    function buildCodesLink('),page.indexOf('    // === UI vazby a start ==='));
const derive=page.slice(page.indexOf('    function deriveAlfUrl(')).split('\n    function ')[0];
const token='12345678-1234-1234-1234-123456789abc.'+'a'.repeat(43);
const settle=()=>new Promise(r=>setTimeout(r,0));
test('codes send updates the existing card before SMS, uses same fields, and fails closed',async t=>{
 for(const scenario of ['success','cancel','unpaid','incomplete','google-failure','changed-form','no-card','hide-code'])await t.test(scenario,async()=>{
  const dom=new JSDOM('<div class="card"><div id="bookingState"></div></div>'+['alf','box','guest','base','smsTo','smsLang','roomNo'].map(id=>`<input id="${id}">`).join('')+['done','unpaid','noSendBoxInLink'].map(id=>`<input type="checkbox" id="${id}">`).join('')+'<button id="clear"></button><p id="smsStatus"></p>',{runScripts:'outside-only',url:'https://example.test'});
  const w=dom.window,q=id=>w.document.getElementById(id),calls=[];
  q('alf').value='DEMOXX';q('box').value='482751';q('guest').value='Test';q('smsTo').value='+420123456789';q('smsLang').value='cz';q('base').value='https://www.pensionfalconi.cz';q('done').checked=scenario!=='incomplete';q('unpaid').checked=scenario==='unpaid';q('noSendBoxInLink').checked=scenario==='hide-code';
  let resolveWallet;
  w.fetch=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});if(url==='/api/wallet')return new Promise(r=>resolveWallet=r);return {ok:true,json:async()=>({successfulNumbers:['+420123456789'],failedNumbers:[]})};};
  w.falconiShortenLinks=async urls=>urls;w.confirmSending=async()=>scenario!=='cancel';
  w.normalizePhones=value=>[value];w.saveHistory=async()=>{};w.loadHistory=()=>{};w.showSendResult=()=>{};
  w.eval('const Q=s=>document.querySelector(s);let sendInProgress=false;function setSendingState(value){sendInProgress=value;}'+derive+send);
  w.eval(wallet);
  const pending=w.sendCodesLink();await settle();
  if(['cancel','unpaid','incomplete'].includes(scenario)){await pending;assert.equal(calls.length,0);}
  else if(scenario==='hide-code'){await pending;assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/send-sms');assert.ok(!calls[0].body.text.includes('box='));}
  else{
   assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/wallet');
   assert.deepEqual(calls[0].body,{action:'codes-link',alfred:'DEMOXX',boxCode:'482751',checkinComplete:true,paymentComplete:true,lockerReady:true,operatorConfirmed:true});
   assert.equal(q('walletExpires').value,'');assert.equal(q('walletConfirm').checked,false);
   if(scenario==='changed-form'){q('alf').value='OTHERX';q('alf').dispatchEvent(new w.Event('input'));}
   resolveWallet({ok:scenario!=='google-failure',json:async()=>scenario==='no-card'?{skipped:true,reason:'no-card'}:scenario==='google-failure'?{error:'Google failure'}:{state:'ready',guestToken:token}});
   await pending;
   if(['google-failure','changed-form'].includes(scenario))assert.equal(calls.length,1);
   else{assert.equal(calls.length,2);assert.equal(calls[1].url,'/api/send-sms');const link=new URL(calls[1].body.text.split('\n')[1]);assert.equal(link.searchParams.get('box'),'482751');assert.equal(link.hash,scenario==='no-card'?'':'#wallet-'+Buffer.from(token).toString('hex'));}
  }
  dom.window.close();
 });
});
