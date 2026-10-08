import {timingSafeEqual} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {database,ensureMonitor} from '../lib/sms-monitor.js';
import {trackedSend,asciiMessage} from '../lib/tracked-send.js';
import {readDuty} from '../lib/night-ai/read-duty.js';
import {enabled,recipients,resolveDuty} from '../lib/night-ai/decision.js';
export function authenticated(header,key){
 if(typeof key!=='string'||key.length<32||typeof header!=='string')return false;
 const a=Buffer.from(header),b=Buffer.from('Bearer '+key);return a.length===b.length&&timingSafeEqual(a,b);
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 if(req.method!=='POST')return res.status(405).json({error:'Method not allowed'});
 if(!authenticated(req.headers.authorization,process.env.NIGHT_SUMMARY_TOKEN))return res.status(401).json({error:'Unauthorized'});
 const {historyId,to,text}=req.body||{};
 if(!/^night_[a-f0-9]{64}$/.test(historyId||'')||req.headers['idempotency-key']!==historyId||typeof text!=='string'||text.length>800||!text.startsWith('FALCONI | AI shrnutí |')||!/^\+420\d{9}$/.test(to||'')||JSON.stringify(req.body).length>5000)return res.status(400).json({error:'Invalid request'});
 try{
  // Test mode is restricted to the owner's explicitly approved number and two
  // fixed idempotency IDs. It never enables production routing or other recipients.
  const testId=historyId==='night_'+ '1'.repeat(64)||historyId==='night_'+ '2'.repeat(64);
  const test=process.env.NIGHT_SUMMARY_TEST==='true'&&testId&&to==='+420602418879'&&text.includes('TEST —');
  if(!test){
   if(process.env.NIGHT_AI_ENABLED!=='true')return res.status(409).json({error:'Night AI disabled'});
   const snapshot=await readDuty({phoneSql:neon(process.env.PHONE_READONLY_DATABASE_URL),shiftsSql:neon(process.env.SHIFTS_READONLY_DATABASE_URL),nightAiEnabled:true});
   if(!enabled(snapshot)||!recipients(resolveDuty(snapshot,new Date())).includes(to))return res.status(403).json({error:'Recipient is not on duty'});
  }
  if(!process.env.SMS_LOGIN||!process.env.SMS_PASSWORD)return res.status(503).json({error:'SMS not configured'});
  const sql=database();await ensureMonitor(sql);
  const r=await trackedSend(sql,{historyId,number:to.slice(1),message:asciiMessage(text),login:process.env.SMS_LOGIN,password:process.env.SMS_PASSWORD,actionType:'night-ai-summary',guest:test?'TEST noční AI':'Noční AI'});
  return res.status(200).json({state:r.err===0?'accepted':Number.isInteger(r.err)&&r.err!==-1?'failed':'unknown',id:r.sms_id||''});
 }catch{return res.status(503).json({error:'Summary status unavailable; do not retry without checking history'});}
}
