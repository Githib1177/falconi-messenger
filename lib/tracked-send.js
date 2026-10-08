import { fingerprint, parseResponse, normalizeNumber, DEVICE_NUMBER } from './sms-monitor.js';

const ERRORS = { '-1':'Duplicitní zpráva', 1:'Chyba SMSbrány', 2:'Neplatné přihlášení', 3:'Chyba ověření', 4:'Neplatný čas', 5:'Nepovolená IP adresa', 6:'Neplatná akce', 7:'Duplicitní požadavek', 8:'Chyba databáze SMSbrány', 9:'Nedostatečný kredit nebo překročený limit SMS', 10:'Neplatné číslo příjemce', 11:'Prázdný text', 12:'Příliš dlouhá zpráva', 13:'Neautorizovaný odesílatel' };
export const asciiMessage = value => String(value).normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/[\r\n]+/g,' ').trim();
export function sendQuery({login,password,number,message,id}) {
  const query = new URLSearchParams({action:'send_sms',login,password,number,message,delivery_report:'1',user_id:id.slice(0,50)});
  // Account sender ID 0 is the system shortcode: 999037 on the locker's O2 route.
  // Route by the actual recipient, never by client-supplied action/locker labels.
  // Guests use this account's authorized InfoSMS ID; neither route falls back.
  if (normalizeNumber(number) === DEVICE_NUMBER) query.set('sender_id','0');
  else query.set('sender_id','30514');
  return query;
}
export async function trackedSend(sql, {historyId,number,message,guest='',actionType='',lockerNo='',login,password}, transport=fetch) {
  const id=fingerprint([historyId,number]);
  const hash=fingerprint([number,message]);
  const claim=await sql`INSERT INTO sms_delivery_attempts(id,history_id,number,created_at,request_hash,state,message,guest,action_type,locker_no)
    VALUES (${id},${historyId},${number},${Date.now()},${hash},'pending',${message},${guest},${actionType},${lockerNo})
    ON CONFLICT(history_id,number) DO NOTHING RETURNING id`;
  if (!claim.length) {
    const [old]=await sql`SELECT request_hash,response FROM sms_delivery_attempts WHERE id=${id}`;
    if (old?.request_hash !== hash) return {number,err:null,errMessage:'Tento požadavek již patří jiné zprávě.'};
    return old?.response || {number,err:null,errMessage:'Odeslání už probíhá nebo není potvrzeno. Před opakováním ověřte historii SMSbrány.'};
  }
  let result;
  try {
    const response=await transport('https://api.smsbrana.cz/smsconnect/?'+sendQuery({login,password,number,message,id}), {signal:AbortSignal.timeout(15000)});
    if (!response.ok) throw new Error();
    const root=parseResponse(await response.text()).result;
    if (!root || !/^-?\d+$/.test(String(root.err))) throw new Error();
    const err=Number(root.err);
    const numeric=v=>v!==undefined && v!=='' && Number.isFinite(Number(v))?Number(v):null;
    result={number,err,sms_id:/^\d+$/.test(String(root.sms_id))?String(root.sms_id):null,price:numeric(root.price),sms_count:numeric(root.sms_count),credit:numeric(root.credit),errMessage:err===0?'OK':ERRORS[err]||'Chyba SMSbrány'};
  } catch {
    // Never retry an ambiguous request: it may already have opened/programmed a locker.
    result={number,err:null,errMessage:'Brána nepotvrdila odeslání. SMS mohla být odeslána; před opakováním ověřte historii SMSbrány.'};
  }
  try {
    await sql`UPDATE sms_delivery_attempts SET state=${result.err===0?'accepted':result.err==null||result.err===-1?'unknown':'failed'},
      sms_id=${result.sms_id||null},price=${result.price??null},sms_count=${result.sms_count??null},
      error_code=${result.err},error_text=${result.err===0?null:result.errMessage},response=${JSON.stringify(result)}::jsonb WHERE id=${id}`;
    if (result.credit!=null) await sql`INSERT INTO sms_monitor_state(id,value,checked_at) VALUES ('credit',${JSON.stringify({credit:result.credit})}::jsonb,${Date.now()})
      ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value,checked_at=EXCLUDED.checked_at`;
  } catch {
    result.trackingWarning='Odeslání bylo zpracováno, ale výsledek se nepodařilo uložit. Ověřte SMSbránu.';
  }
  return result;
}
