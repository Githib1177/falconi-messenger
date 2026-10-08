import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createWalletHandler } from '../api/wallet.js';
import { createSessionCookie } from '../api/_auth.js';
test('authenticated manual flow: initial card, code release, withdrawal, failure and retry reuse one card',async()=>{
  const oldDb=process.env.DATABASE_URL,oldSecret=process.env.SESSION_SECRET;
  process.env.DATABASE_URL='local-test';process.env.SESSION_SECRET='local-test-only';
  const db=new PGlite();
  const sql=async(strings,...values)=>(await db.query(strings.reduce((s,p,i)=>s+(i?'$'+i:'')+p,''),values)).rows;
  const objects=[];let fail=false;
  const handler=createWalletHandler({connect:()=>sql,getConfig:()=>({issuerId:'123',classSuffix:'test',key:{private_key:'test-only'}}),putObject:async object=>{if(fail)throw new Error('Google nepotvrdil aktualizaci.');objects.push(object);},makeSaveUrl:id=>'https://pay.google.com/gp/v/save/'+id});
  const base={alfred:'DEMOXX',checkinComplete:false,paymentComplete:false,lockerReady:false,operatorConfirmed:true,boxCode:'482751',releaseAt:new Date(Date.now()-60000).toISOString(),expiresAt:new Date(Date.now()+86400000).toISOString()};
  async function call(change={}){const res={setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}};await handler({method:'POST',headers:{cookie:createSessionCookie().split(';')[0]},body:{...base,...change}},res);return res;}
  try{
    assert.equal((await call({operatorConfirmed:false})).code,400);assert.equal(objects.length,0);
    const pending=await call();assert.equal(pending.code,200);assert.equal(pending.body.state,'pending');assert.ok(!JSON.stringify(objects.at(-1)).includes(base.boxCode));
    const automatic={action:'codes-link',releaseAt:undefined,expiresAt:undefined,checkinComplete:true,paymentComplete:true,lockerReady:true};
    for(const field of ['checkinComplete','paymentComplete','lockerReady'])assert.equal((await call({...automatic,[field]:false})).code,400);
    const count=objects.length;
    const missing=await call({...automatic,alfred:'NOCARD'});assert.equal(missing.body.skipped,true);assert.equal(objects.length,count);
    const auto=await call(automatic);assert.equal(auto.code,200);assert.equal(auto.body.state,'ready');assert.equal(auto.body.passId,pending.body.passId);
    assert.ok(objects.at(-1).textModulesData.some(v=>v.id==='alfred'&&v.body==='DEMOXX'));
    assert.equal(Number((await sql`SELECT expires_at FROM wallet_passes`)[0].expires_at),Date.parse(base.expiresAt));
    fail=true;assert.equal((await call(automatic)).code,503);fail=false;
    const ready=await call({checkinComplete:true,paymentComplete:true,lockerReady:true});assert.equal(ready.body.state,'ready');assert.equal(pending.body.passId,ready.body.passId);assert.equal(objects.at(-1).header.defaultValue.value,base.boxCode);
    const withdrawn=await call({checkinComplete:true,paymentComplete:false,lockerReady:true});assert.equal(withdrawn.body.state,'pending');assert.ok(!JSON.stringify(objects.at(-1)).includes(base.boxCode));
    fail=true;assert.equal((await call()).code,503);fail=false;
    assert.equal((await call()).body.passId,pending.body.passId);
    const rows=await sql`SELECT * FROM wallet_passes`;assert.equal(rows.length,1);assert.equal(rows[0].claim,null);assert.equal(Number(rows[0].busy_until),0);
    await sql`UPDATE wallet_passes SET release_at=${Date.now()+60000}`;
    const countBeforeEarly=objects.length;
    assert.equal((await call(automatic)).code,409);assert.equal(objects.length,countBeforeEarly);
    await sql`UPDATE wallet_passes SET expires_at=1`;
    const countBeforeExpiry=objects.length;
    assert.equal((await call(automatic)).code,409);assert.equal(objects.length,countBeforeExpiry);
  }finally{await db.close();if(oldDb===undefined)delete process.env.DATABASE_URL;else process.env.DATABASE_URL=oldDb;if(oldSecret===undefined)delete process.env.SESSION_SECRET;else process.env.SESSION_SECRET=oldSecret;}
});
