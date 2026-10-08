import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';
const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const monitor=fs.readFileSync(new URL('../monitor.js',import.meta.url),'utf8');
const wait=()=>new Promise(r=>setTimeout(r,30));

test('UI: low credit, new device notification, read state, safe text, offline and auth',async()=>{
 const dom=new JSDOM(html,{url:'https://fixture.test',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,$=s=>w.document.querySelector(s);
 let response={credit:199.5,threshold:200,creditCheckedAt:Date.now(),inboxCheckedAt:Date.now(),errors:[],events:[],outgoing:[]};
 let status=200;const requests=[];
 w.fetch=async(url,opts)=>{requests.push({url,opts});if(url==='/api/auth')return {ok:true,json:async()=>({ok:true})};if(url.startsWith('/api/sms-history'))return{ok:true,json:async()=>[]};return{ok:status===200,status,json:async()=>response};};
 try{
   w.eval(monitor);
   for(const script of w.document.querySelectorAll('script:not([src])'))w.eval(script.textContent);
   w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
   await wait();
   assert.match($('#smsCredit').textContent,/199,50 Kč · Doplňte kredit/);
   assert.equal($('#loginGate').classList.contains('hidden'),true);
   response={...response,inboxInfo:{messages:1,deviceMessages:0,receipts:1,bytes:350,sections:['delivery_sms','delivery_report']},events:[{id:'guest',receivedAt:Date.now(),ts:Date.now(),kind:'guest-message',number:'420777111222',message:'Ok'}]};
   await w.refreshSmsMonitor();
   assert.match($('#smsMonitorError').textContent,/Příjem odpovědí schránek není ověřen/);
   assert.match($('#smsApiDiagnostic').textContent,/1 příchozích SMS, z toho 0 od schránek/);
   const dangerous='<img src=x onerror="throw 1">';
   response={...response,events:[{id:'new',receivedAt:Date.now()+1000,ts:Date.now(),kind:'locker-opened',lockerNo:'04',number:'420602783619',message:dangerous}]};
   await w.refreshSmsMonitor();
   assert.match($('#smsBadge').textContent,/1 nových/);
   assert.match($('#smsIncoming').textContent,/Schránka 04: otevření klávesnicí/);
   assert.doesNotMatch($('#smsMonitorError').textContent,/Příjem odpovědí schránek není ověřen/);
   assert.equal($('#smsIncoming img'),null);assert.match($('#smsIncoming').textContent,/<img/);
   $('#smsMarkRead').click();assert.equal($('#smsBadge').textContent,'Oznámení');
   await w.refreshSmsMonitor();assert.equal($('#smsBadge').textContent,'Oznámení');
   response={...response,events:[{id:'code-added',receivedAt:Date.now()+2000,ts:Date.now(),kind:'locker-code-added',lockerNo:'01',number:'420602783619',message:'pension falconi\npridan kod pro box c: 01: 034784z cisla: 2026'}]};
   await w.refreshSmsMonitor();
   assert.match($('#smsIncoming strong').textContent,/Schránka 01: zařízení potvrdilo přidání kódu/);
   assert.doesNotMatch($('#smsIncoming strong').textContent,/034784|2026/);
   assert.match($('#smsIncoming details').textContent,/034784z cisla: 2026/);
   assert.match($('#smsBadge').textContent,/1 nových/);
   response={...response,creditCheckedAt:Date.now()-240000,inboxCheckedAt:Date.now()-240000};
   await w.refreshSmsMonitor();assert.match($('#smsCredit').textContent,/údaj není aktuální/);
   status=503;response={error:'Dočasně nedostupné'};await w.refreshSmsMonitor();assert.match($('#smsCredit').textContent,/nelze ověřit/);
   status=401;await w.refreshSmsMonitor();assert.equal($('#loginGate').classList.contains('hidden'),false);
   assert.equal(requests.some(r=>r.url.includes('send-sms')),false);
 }finally{w.close();}
});

test('history exposes separate accepted and delivered states without HTML injection',()=>{
 const dom=new JSDOM(html,{url:'https://fixture.test',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
 w.fetch=async()=>({ok:true,json:async()=>({ok:false})});
 try{
   w.eval(monitor);for(const script of w.document.querySelectorAll('script:not([src])'))w.eval(script.textContent);
   w.renderHistory([{id:'old',ts:Date.now(),to:['420777111222'],text:'test',deliveries:[{number:'420777111222',statusLabel:'Doručeno'}]}]);
   assert.match(w.document.querySelector('#histTable').textContent,/Doručeno/);
 }finally{w.close();}
});

test('sending flows keep gateway request and cloud history linked; partial guest send does not program locker',async()=>{
 const dom=new JSDOM(html,{url:'https://fixture.test',runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window,$=s=>w.document.querySelector(s);
 const sends=[],histories=[];let partial=false;
 w.fetch=async(url,opts)=>{
  const body=opts?.body?JSON.parse(opts.body):null;
  if(url==='/api/send-sms'){sends.push(body);return{ok:true,json:async()=>({ok:!partial,successfulNumbers:[body.to?.[0]],failedNumbers:partial?['420777000001']:[]})};}
  if(url==='/api/sms-history'&&opts?.method==='POST'){histories.push(body);return{ok:true,json:async()=>({ok:true})};}
  return{ok:true,json:async()=>url==='/api/auth'?{ok:false}:[]};
 };
 try{
  w.eval(monitor);for(const script of w.document.querySelectorAll('script:not([src])'))w.eval(script.textContent);
  w.falconiPrepareLinks=async()=>w.gen();w.falconiShortenLinks=async urls=>urls;w.confirmSending=async()=>true;
  $('#smsTo').value='+420777000000';$('#guest').value='Test';$('#alf').value='FIXTURE';$('#box').value='123456';$('#lockerNo').value='04';$('#doBoxCode').checked=true;
  await w.sendSms();await wait();
  assert.equal(sends.length,2);assert.equal(histories.length,2);
  assert.equal(sends[0].historyId,histories[0].id);
  assert.equal(sends[1].historyId,histories[1].id);
  assert.equal(sends[1].text,'pin0000*04*apc*123456*');
  assert.deepEqual(sends[1].to,['+420602783619']);
  assert.doesNotMatch($('#boxStatus').textContent,/nakódována/);
  sends.length=0;histories.length=0;partial=true;
  await w.sendSms();await wait();assert.equal(sends.length,1);
  sends.length=0;histories.length=0;partial=false;
  await w.sendCodesLink();assert.equal(sends.length,1);assert.equal(sends[0].historyId,histories[0].id);
 }finally{w.close();}
});
