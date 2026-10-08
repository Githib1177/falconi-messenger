import { isAuthorized } from './_auth.js';
import { database, ensureMonitor, syncMonitor, publicAttempt, classifyDeviceMessage } from '../lib/sms-monitor.js';

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if (!isAuthorized(req)) return res.status(401).json({error:'Přihlášení vypršelo.'});
  if (req.method!=='GET') return res.status(405).json({error:'Nepovolená metoda.'});
  try {
    const sql=database();
    await ensureMonitor(sql);
    await syncMonitor(sql);
    const [state,events,outgoing] = await Promise.all([
      sql`SELECT id,value,checked_at FROM sms_monitor_state WHERE id IN ('credit','inbox','sync')`,
      sql`SELECT * FROM sms_incoming_events ORDER BY provider_time DESC NULLS LAST,received_at DESC LIMIT 100`,
      sql`SELECT * FROM sms_delivery_attempts ORDER BY created_at DESC LIMIT 40`
    ]);
    const byId=Object.fromEntries(state.map(r=>[r.id,r]));
    const threshold=Number(process.env.SMS_LOW_CREDIT_CZK || 200);
    return res.status(200).json({
      credit:byId.credit?.value?.credit ?? null, creditCheckedAt:Number(byId.credit?.checked_at)||null,
      threshold:Number.isFinite(threshold)&&threshold>=0?threshold:200,
      inboxCheckedAt:Number(byId.inbox?.checked_at)||null,
      inboxInfo:byId.inbox?.value||null,
      errors:byId.sync?.value?.errors||[],
      events:events.map(e=>{const parsed=classifyDeviceMessage(e.number,e.message);return {id:e.id,number:e.number,message:e.message,time:e.provider_time_text,ts:e.provider_time==null?null:Number(e.provider_time),receivedAt:Number(e.received_at),kind:parsed.kind,lockerNo:parsed.locker};}),
      outgoing:outgoing.map(publicAttempt)
    });
  } catch { return res.status(503).json({error:'Oznámení jsou dočasně nedostupná. Stav doručení ani kredit nelze nyní ověřit.'}); }
}
