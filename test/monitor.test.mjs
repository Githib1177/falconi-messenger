import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { ensureMonitor, parseInbox, providerTimestamp, parseResponse, syncMonitor, applyReceipts, publicAttempt, gatewayRead } from '../lib/sms-monitor.js';
import { trackedSend, sendQuery, asciiMessage } from '../lib/tracked-send.js';
import monitorHandler from '../api/sms-monitor.js';
import sendHandler from '../api/send-sms.js';
const db=new PGlite();
const sql=async(strings,...values)=>(await db.query(strings.reduce((s,p,i)=>s+(i?'$'+i:'')+p,''),values)).rows;
const inbox=`<result><inbox><delivery_sms><item><income_id>1</income_id><number>+420602783619</number><time>2026-09-19 10:01:00</time><message>pension falconi Z klavesnice otevren box c: 04*330043*</message></item><item><income_id>2</income_id><number>+420777111222</number><time>20260919T100200</time><message>Z klavesnice otevren box c: 01*123456* &amp; text</message></item></delivery_sms><delivery_report><item><id_sms>123</id_sms><number>+420777111222</number><status>1</status><time>2026-09-19 10:03:00</time></item></delivery_report></inbox></result>`;

test('incoming parser: known device only, safe XML, aliases and Prague time',()=>{
  const parsed=parseInbox(inbox);
  assert.equal(parsed.messages[0].kind,'locker-opened');assert.equal(parsed.messages[0].locker,'04');
  assert.equal(parsed.messages[1].kind,'guest-message');assert.match(parsed.messages[1].message,/& text/);
  assert.equal(parsed.receipts[0].smsId,'123');
  for(const tag of ['sms_id','idsms'])assert.equal(parseInbox(inbox.replaceAll('id_sms',tag)).receipts[0].smsId,'123');
  assert.equal(providerTimestamp('20260919T100200'),Date.parse('2026-09-19T08:02:00Z'));
  assert.equal(providerTimestamp('2026-01-19 10:02:00'),Date.parse('2026-01-19T09:02:00Z'));
  assert.equal(providerTimestamp('broken'),null);
  assert.deepEqual(parseInbox('<result><inbox/></result>'),{receipts:[],messages:[]});
  assert.throws(()=>parseResponse('<!DOCTYPE a [<!ENTITY x "xx">]><result>&x;</result>'));
  assert.throws(()=>parseResponse('<result>'));
});

test('locker uses system sender; all other recipients use InfoSMS and preserve command bytes',()=>{
  const devices=['420602783619','+420602783619','602783619','00420602783619'];
  for(const number of [...devices,'420777111222','777111222','+491701234567']){
    const message=asciiMessage('**pin0000*01*nb*');
    const q=sendQuery({login:'fixture',password:'fixture',number,message,id:'x'.repeat(64)});
    assert.equal(q.get('message'),'**pin0000*01*nb*');
    const device=devices.includes(number);
    assert.equal(q.get('sender_id'),device?'0':'30514');assert.equal(q.has('sender_phone'),false);
    assert.equal(q.get('delivery_report'),'1');assert.equal(q.get('user_id').length,50);
    assert.deepEqual([...q.keys()].sort(),['action','delivery_report','login','message','number','password','sender_id','user_id']);
  }
  assert.equal(asciiMessage('pin0000*04*apc*330043*'),'pin0000*04*apc*330043*');
});

test('programming acknowledgement accepts the supplied device format without treating its suffix as a date',()=>{
  const sample='pension falconi\npridan kod pro box c: 01: 034784z cisla: 2026';
  const read=(message,number='+420602783619')=>parseInbox(`<result><inbox><delivery_sms><item><number>${number}</number><time>20260919T100200</time><message>${message}</message></item></delivery_sms></inbox></result>`).messages[0];
  for(const message of [sample,sample.replace('\n','\\'), 'Pension Falconi\r\nPřidán kód pro box č: 1: 034784 z čísla: 2026']) {
    const event=read(message);
    assert.equal(event.kind,'locker-code-added');assert.equal(event.locker,'01');
    assert.equal(event.ts,Date.parse('2026-09-19T08:02:00Z'));
    assert.equal(event.message,message.replaceAll('\r\n','\n'));
  }
  assert.equal(read(sample,'+420777111222').kind,'guest-message');
  for(const invalid of [sample.replace('01:','09:'),sample.replace('034784','0347849'),sample.replace('034784','34784'),'nepodarilo se: '+sample,sample+' chyba']) {
    assert.equal(read(invalid).kind,'device-message');
    assert.equal(read(invalid).locker,null);
  }
});

test('database lifecycle: dedupe, uncertain send, polling, monotonic receipts',async()=>{
  await ensureMonitor(sql);
  const input={historyId:'test-1',number:'420777111222',message:'Fixture only',login:'fixture',password:'fixture'};
  let sends=0;
  const transport=async()=>{sends++;return new Response('<result><err>0</err><sms_id>123</sms_id><price>1.1</price><sms_count>1</sms_count><credit>199.5</credit></result>');};
  const results=await Promise.all([trackedSend(sql,input,transport),trackedSend(sql,input,transport)]);
  assert.equal(sends,1);assert.equal(results.filter(r=>r.err===0).length>=1,true);
  let deviceSends=0;
  const refusedDevice=async url=>{
    deviceSends++;
    const q=new URL(url).searchParams;
    assert.equal(q.get('sender_id'),'0');assert.equal(q.has('sender_phone'),false);
    return new Response('<result><err>13</err></result>');
  };
  const deviceInput={...input,historyId:'device-sender',number:'420602783619',message:'**pin0000*01*ln*',actionType:'guest-sms'};
  assert.equal((await trackedSend(sql,deviceInput,refusedDevice)).err,13);
  assert.equal((await trackedSend(sql,deviceInput,refusedDevice)).err,13);
  assert.equal(deviceSends,1,'a rejected device sender must never fall back or resend');
  let guestSends=0;
  const refusedGuest=async url=>{
    guestSends++;
    const q=new URL(url).searchParams;
    assert.equal(q.get('sender_id'),'30514');assert.equal(q.has('sender_phone'),false);
    return new Response('<result><err>13</err></result>');
  };
  const guestInput={...input,historyId:'infosms-sender',actionType:'locker'};
  assert.equal((await trackedSend(sql,guestInput,refusedGuest)).err,13);
  assert.equal((await trackedSend(sql,guestInput,refusedGuest)).err,13);
  assert.equal(guestSends,1,'InfoSMS rejection must never fall back to reception or a shortcode');
  assert.equal((await trackedSend(sql,input,transport)).sms_id,'123');assert.equal(sends,1);
  assert.match((await trackedSend(sql,{...input,message:'different'},transport)).errMessage,/jiné zprávě/);
  let attempts=0;
  const broken=async()=>{attempts++;throw new Error('secret-containing network error');};
  const uncertain=await trackedSend(sql,{...input,historyId:'uncertain'},broken);
  assert.equal(uncertain.err,null);assert.doesNotMatch(uncertain.errMessage,/secret/);
  await trackedSend(sql,{...input,historyId:'uncertain'},broken);assert.equal(attempts,1);
  const original=global.fetch;
  process.env.SMS_LOGIN='fixture';process.env.SMS_PASSWORD='fixture';
  const actions=[];
  global.fetch=async url=>{const q=new URL(url).searchParams;actions.push(q.get('action'));assert.equal(q.has('delete'),false);assert.equal(q.has('sender_id'),false);return new Response(q.get('action')==='credit_info'?'<result><credit>199.5</credit></result>':inbox);};
  try{
    await syncMonitor(sql);await syncMonitor(sql);
    assert.deepEqual(actions.sort(),['credit_info','inbox']);
    assert.equal((await sql`SELECT * FROM sms_incoming_events`).length,2);
    let [sent]=await sql`SELECT * FROM sms_delivery_attempts WHERE history_id='test-1'`;
    assert.equal(publicAttempt(sent).statusLabel,'Doručeno');
    await sql`UPDATE sms_monitor_state SET checked_at=0 WHERE id='lease'`;
    await syncMonitor(sql);
    assert.equal((await sql`SELECT * FROM sms_incoming_events`).length,2);
    await sql`INSERT INTO sms_delivery_receipts VALUES ('later-held','123','420777111222',2,${Date.now()+10000},${Date.now()})`;
    await applyReceipts(sql);
    [sent]=await sql`SELECT * FROM sms_delivery_attempts WHERE history_id='test-1'`;
    assert.equal(sent.provider_status,1,'terminal delivered cannot regress to held');
    await assert.rejects(gatewayRead('send_sms'));
    global.fetch=async()=>{throw new Error('offline');};
    await sql`UPDATE sms_monitor_state SET checked_at=0 WHERE id='lease'`;
    await syncMonitor(sql);
    const [state]=await sql`SELECT value FROM sms_monitor_state WHERE id='sync'`;
    assert.equal(state.value.errors.length,2);
    const [credit]=await sql`SELECT value FROM sms_monitor_state WHERE id='credit'`;
    assert.equal(credit.value.credit,199.5);
  }finally{global.fetch=original;await db.close();}
});

test('unauthenticated APIs never call the gateway',async()=>{
  for(const handler of [monitorHandler,sendHandler]){
    let status;
    const response={setHeader(){},status(n){status=n;return this;},json(){return this;}};
    await handler({headers:{},method:'GET'},response);assert.equal(status,401);
  }
});
