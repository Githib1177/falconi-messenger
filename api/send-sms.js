import { randomUUID } from 'node:crypto';
import { isAuthorized } from './_auth.js';
import { database, ensureMonitor, DEVICE_NUMBER, normalizeNumber } from '../lib/sms-monitor.js';
import { asciiMessage, trackedSend } from '../lib/tracked-send.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (!isAuthorized(req)) return res.status(401).json({ok:false,error:'Přihlášení vypršelo'});
  if (req.method!=='POST') return res.status(405).json({ok:false,error:'Nepovolená metoda'});
  let {to,text}=req.body||{};
  const openLocker=req.body?.action==='open-locker';
  if(openLocker) {
    const locker=req.body.locker;
    if(!Number.isInteger(locker)||locker<1||locker>8) return res.status(400).json({ok:false,error:'Vyberte box 1 až 8.'});
    const pin=process.env.SELAX_PIN||'0000';
    if(!/^\d{4}$/.test(pin)) return res.status(500).json({ok:false,error:'Neplatné nastavení PIN schránky.'});
    to=['+420602783619'];
    text=`**pin${pin}*${String(locker).padStart(2,'0')}*nb*`;
  }
  if(!text||!String(text).trim()||!to) return res.status(400).json({ok:false,error:'Chybí text nebo příjemce.'});
  // Preserve the previous recipient normalization and command text.
  const numbers=[...new Set((Array.isArray(to)?to:String(to).split(/[,\n;]+/)).map(x=>String(x).trim().replace(/[^\d+]/g,'').replace(/^\+/,'' )).filter(x=>/^\d{8,15}$/.test(x)))];
  if(!numbers.length||numbers.length>20) return res.status(400).json({ok:false,error:'Zadejte 1 až 20 platných čísel.'});
  const {SMS_LOGIN:login,SMS_PASSWORD:password}=process.env;
  if(!login||!password) return res.status(503).json({ok:false,error:'Chybí připojení SMSbrány.'});
  const historyId=req.body?.historyId||randomUUID();
  if(typeof historyId!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(historyId)) return res.status(400).json({ok:false,error:'Neplatný identifikátor požadavku.'});
  try {
    const sql=database();
    await ensureMonitor(sql);
    const results=[];
    for(const number of numbers) {
      const device=normalizeNumber(number)===DEVICE_NUMBER;
      results.push(await trackedSend(sql,{historyId,number,message:asciiMessage(text),login,password,
        guest:String(req.body?.guest||'').slice(0,200),
        actionType:device?(openLocker?'locker-open':'locker'):'guest-sms',
        lockerNo:device?String(openLocker?req.body.locker:req.body?.lockerNo||'').slice(0,2):''}));
    }
    const successfulNumbers=results.filter(r=>r.err===0).map(r=>r.number);
    const failed=results.filter(r=>r.err!==0);
    return res.status(200).json({ok:!failed.length,partial:!!successfulNumbers.length&&!!failed.length,results,historyId,successfulNumbers,failedNumbers:failed.map(r=>r.number),error:failed[0]?.errMessage});
  } catch {
    return res.status(503).json({ok:false,error:'Odeslání nelze bezpečně dokončit. Před opakováním ověřte historii SMSbrány.'});
  }
}
