import test from 'node:test';
import assert from 'node:assert/strict';
import { alfredDetails, accessDecision, buildWalletObject } from '../lib/wallet-pass.js';
const now=Date.parse('2026-09-19T14:00:00Z');
const stay={passId:'d6c3361b-8244-4925-b42d-14e38937edb5',reservationId:'demo-reservation',alfred:'DEMOXX',releaseAt:now-3600000,expiresAt:now+86400000,lockerAssignmentId:'assignment-1'};
const snapshot={source:'previo',hotelId:'85',reservationId:stay.reservationId,alfredCode:'DEMOXX',verifiedAt:now,active:true,checkinComplete:true,paymentComplete:true};
const locker={reservationId:stay.reservationId,assignmentId:'assignment-1',programmingConfirmed:true,cardPrepared:true,validFrom:now-3600000,validUntil:now+86400000,code:'482751'};
const config={issuerId:'3388000000023206289',classSuffix:'falconi_pobyt_demo_v1'};
const build=(s=snapshot,l=locker,st=stay)=>buildWalletObject(st,s,l,config,now);

test('no locker code in any field until all three conditions are confirmed',()=>{
  for(const checkin of [false,true])for(const payment of [false,true])for(const prepared of [false,true]){
    const obj=build({...snapshot,checkinComplete:checkin,paymentComplete:payment},{...locker,cardPrepared:prepared});
    assert.equal(JSON.stringify(obj).includes(locker.code),checkin&&payment&&prepared);
    assert.ok(JSON.stringify(obj).includes('DEMOXX'));
    assert.ok(obj.linksModuleData.uris.some(l=>l.uri==='https://alfred.previo.app/login/DEMOXX'));
  }
});
test('same pass identity survives state changes and removes code on downgrade',()=>{
  const pending=build(null),ready=build(),downgrade=build({...snapshot,paymentComplete:false});
  assert.equal(pending.id,ready.id);assert.equal(ready.id,downgrade.id);
  assert.equal(ready.header.defaultValue.value,locker.code);
  assert.ok(!JSON.stringify(downgrade).includes(locker.code));
  assert.match(ready.textModulesData[1].body,/Ke kiosku už nemusíte/);
  assert.ok(!JSON.stringify(ready).includes('assignment-1'));
});
test('stale, wrong reservation, wrong property and untrusted flags cannot release codes',()=>{
  for(const change of [{source:'browser'},{hotelId:'763519'},{reservationId:'someone-else'},{alfredCode:'OTHERX'},{verifiedAt:now-300001},{verifiedAt:now+1},{verifiedAt:undefined},{paymentComplete:'true'},{checkinComplete:1},{active:false}]){
    assert.equal(accessDecision(stay,{...snapshot,...change},locker,now),'pending');
  }
  for(const change of [{reservationId:'someone-else'},{assignmentId:'old-assignment'},{programmingConfirmed:false},{validFrom:now+1},{validUntil:now},{code:'12345'},{code:'1234567'}]){
    assert.equal(accessDecision(stay,snapshot,{...locker,...change},now),'pending');
  }
});
test('before release time and after checkout no locker code escapes',()=>{
  assert.equal(accessDecision({...stay,releaseAt:now+1},snapshot,locker,now),'pending');
  for(const patch of [{expiresAt:now},{cancelled:true}]){
    const expired=build(snapshot,locker,{...stay,...patch});
    assert.equal(expired.state,'EXPIRED');
    assert.deepEqual(expired.merchantLocations,[]);
    assert.ok(!JSON.stringify(expired).includes(locker.code));
    assert.ok(expired.textModulesData.some(v=>v.id==='alfred'&&v.body==='DEMOXX'));
  }
});
test('Alfred links are constrained to the actual Previo login origin',()=>{
  assert.equal(alfredDetails('https://alfred.previo.app/login/DEMOXX').code,'DEMOXX');
  for(const bad of ['javascript:alert(1)','https://evil.example/login/DEMOXX','https://alfred.previo.app.evil.example/login/DEMOXX','https://alfred.previo.app/login/DEMOXX?box=482751','https://user@alfred.previo.app/login/DEMOXX'])assert.throws(()=>alfredDetails(bad));
});
