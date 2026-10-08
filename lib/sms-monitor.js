import crypto from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { XMLParser, XMLValidator } from 'fast-xml-parser';

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false, trimValues: true, processEntities: true });
export const DEVICE_NUMBER = '420602783619';
export const DELIVERY_LABELS = { 0: 'Odesláno', 1: 'Doručeno', 2: 'Uloženo u operátora', 3: 'Nedoručeno', 5: 'Expirováno', 6: 'Odmítnuto' };
export const normalizeNumber = value => {
  let n = String(value || '').replace(/\D/g, '').replace(/^00/, '');
  if (n.length === 9) n = '420' + n;
  return n;
};
export const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const list = value => value == null ? [] : Array.isArray(value) ? value : [value];
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : '';
export function parseResponse(raw) {
  if (typeof raw !== 'string' || raw.length > 4_000_000 || /<!DOCTYPE|<!ENTITY/i.test(raw) || XMLValidator.validate(raw) !== true) throw new Error('Neplatná XML odpověď SMSbrány.');
  return parser.parse(raw);
}
// SMS Connect sends local Czech time without an offset. Keep the original value too.
export function providerTimestamp(value) {
  const s = text(value);
  if (/Z$|[+-]\d\d:\d\d$/.test(s)) return Number.isFinite(Date.parse(s)) ? Date.parse(s) : null;
  const m = s.match(/^(\d{4})-?(\d{2})-?(\d{2})[T ](\d{2}):?(\d{2}):?(\d{2})$/);
  if (!m) return null;
  const target = Date.UTC(...[Number(m[1]), Number(m[2])-1, ...m.slice(3).map(Number)]);
  const check = new Date(target);
  if (check.getUTCFullYear()!==+m[1] || check.getUTCMonth()!==+m[2]-1 || check.getUTCDate()!==+m[3] || +m[4]>23 || +m[5]>59 || +m[6]>59) return null;
  let candidate = target;
  const fmt = new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/Prague', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' });
  for (let i=0; i<3; i++) {
    const p = Object.fromEntries(fmt.formatToParts(candidate).map(v=>[v.type,v.value]));
    const local = Date.UTC(+p.year, +p.month-1, +p.day, +p.hour, +p.minute, +p.second);
    candidate += target-local;
  }
  return candidate;
}
export function classifyDeviceMessage(number, message) {
  if (normalizeNumber(number) !== DEVICE_NUMBER) return {kind:'guest-message',locker:null};
  const plain = String(message).normalize('NFD').replace(/\p{Diacritic}/gu,'');
  const added = plain.match(/^\s*(?:pension\s+falconi[\s\\]*)?pridan\s+kod\s+pro\s+box\s+c\s*:\s*(0?[1-8])\s*:\s*(\d{6})(?:\s*z\s+cisla\s*:\s*\+?\d+)?\s*$/i);
  if (added) return {kind:'locker-code-added',locker:String(Number(added[1])).padStart(2,'0')};
  const opened = plain.match(/Z\s+klavesnice\s+otevren\s+box\s+c\s*:\s*(0?[1-8])(?:\D|$)/i);
  return {kind:opened?'locker-opened':'device-message',locker:opened?String(Number(opened[1])).padStart(2,'0'):null};
}
export function parseInbox(raw) {
  const root = parseResponse(raw);
  if (root.result?.err != null && Number(root.result.err) !== 0) throw new Error('SMSbrána odmítla načtení příchozích zpráv.');
  const inbox = root.result?.inbox ?? root.inbox;
  if (inbox == null) throw new Error('V odpovědi chybí inbox.');
  const receipts = list(inbox.delivery_report?.item).map(item => {
    const smsId = text(item.sms_id || item.id_sms || item.idsms);
    const status = text(item.status);
    const number = normalizeNumber(item.number);
    const time = text(item.time);
    if (!/^\d+$/.test(smsId) || !Object.hasOwn(DELIVERY_LABELS, status)) return null;
    return { id: fingerprint(['receipt',smsId,number,status,time]), smsId, number, status:Number(status), time, ts:providerTimestamp(time) };
  }).filter(Boolean);
  const messages = list(inbox.delivery_sms?.item).map(item => {
    const number = normalizeNumber(item.number), message = text(item.message), time = text(item.time);
    if (!number || !message) return null;
    return { id:fingerprint(['sms',text(item.income_id),number,message,time]), number, message:message.slice(0,3000), time, ts:providerTimestamp(time), ...classifyDeviceMessage(number,message) };
  }).filter(Boolean);
  return { receipts, messages };
}

export function database() {
  if (!process.env.DATABASE_URL) throw new Error('Databáze oznámení není připojena.');
  return neon(process.env.DATABASE_URL);
}
let schemaPromise;
export async function ensureMonitor(sql) {
  if (!schemaPromise) schemaPromise = (async()=>{
    await sql`CREATE TABLE IF NOT EXISTS sms_monitor_state (id TEXT PRIMARY KEY, value JSONB NOT NULL DEFAULT '{}'::jsonb, checked_at BIGINT NOT NULL DEFAULT 0)`;
    await sql`CREATE TABLE IF NOT EXISTS sms_delivery_attempts (
      id TEXT PRIMARY KEY, history_id TEXT NOT NULL, number TEXT NOT NULL, created_at BIGINT NOT NULL,
      request_hash TEXT NOT NULL, sms_id TEXT, state TEXT NOT NULL, provider_status INTEGER, provider_time BIGINT,
      price NUMERIC, sms_count INTEGER, error_code INTEGER, error_text TEXT,
      message TEXT NOT NULL, guest TEXT, action_type TEXT, locker_no TEXT,
      response JSONB, UNIQUE(history_id,number))`;
    await sql`CREATE INDEX IF NOT EXISTS sms_attempt_provider_id ON sms_delivery_attempts(sms_id)`;
    await sql`CREATE INDEX IF NOT EXISTS sms_attempt_created ON sms_delivery_attempts(created_at DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS sms_incoming_events (
      id TEXT PRIMARY KEY, number TEXT NOT NULL, message TEXT NOT NULL, provider_time BIGINT,
      provider_time_text TEXT NOT NULL, received_at BIGINT NOT NULL, kind TEXT NOT NULL, locker_no TEXT)`;
    await sql`CREATE INDEX IF NOT EXISTS sms_incoming_time ON sms_incoming_events(provider_time DESC)`;
    await sql`CREATE TABLE IF NOT EXISTS sms_delivery_receipts (
      id TEXT PRIMARY KEY, sms_id TEXT NOT NULL, number TEXT NOT NULL,
      status INTEGER NOT NULL, provider_time BIGINT, received_at BIGINT NOT NULL)`;
    await sql`CREATE INDEX IF NOT EXISTS sms_receipt_sms_id ON sms_delivery_receipts(sms_id)`;
  })().catch(error=>{ schemaPromise=null; throw error; });
  await schemaPromise;
}

export async function gatewayRead(action) {
  if (!['inbox','credit_info'].includes(action)) throw new Error('Nepovolená operace monitoru.');
  if (!process.env.SMS_LOGIN || !process.env.SMS_PASSWORD) throw new Error('Chybí připojení SMSbrány.');
  const query = new URLSearchParams({action,login:process.env.SMS_LOGIN,password:process.env.SMS_PASSWORD});
  // Never include delete, send_sms or sender parameters in the monitoring path.
  const response = await fetch('https://api.smsbrana.cz/smsconnect/?'+query, {signal:AbortSignal.timeout(12000)});
  if (!response.ok) throw new Error('SMSbrána je dočasně nedostupná.');
  return response.text();
}

export async function applyReceipts(sql) {
  await sql`UPDATE sms_delivery_attempts a SET provider_status = r.status,
    provider_time = r.provider_time, state = 'accepted'
    FROM (SELECT DISTINCT ON (sms_id,number) sms_id,number,status,provider_time
          FROM sms_delivery_receipts WHERE provider_time IS NOT NULL
          ORDER BY sms_id,number,CASE WHEN status IN (1,3,5,6) THEN 1 ELSE 0 END DESC,provider_time DESC) r
    WHERE a.sms_id = r.sms_id AND (a.number = r.number OR ('420' || a.number) = r.number)
      AND (a.provider_time IS NULL OR r.provider_time >= a.provider_time)
      AND (a.provider_status IS NULL OR a.provider_status NOT IN (1,3,5,6) OR r.status IN (1,3,5,6))`;
}

export async function syncMonitor(sql) {
  const now = Date.now();
  const lease = await sql`INSERT INTO sms_monitor_state (id,value,checked_at) VALUES ('lease','{}',${now})
    ON CONFLICT(id) DO UPDATE SET checked_at=EXCLUDED.checked_at
    WHERE sms_monitor_state.checked_at < ${now-60000} RETURNING id`;
  if (!lease.length) return;
  const results = await Promise.allSettled([gatewayRead('credit_info'), gatewayRead('inbox')]);
  let errors=[];
  if (results[0].status==='fulfilled') {
    try {
      const root = parseResponse(results[0].value).result;
      const credit = Number(root?.credit);
      if (root?.credit == null || !Number.isFinite(credit) || (root.err != null && Number(root.err)!==0)) throw new Error();
      await sql`INSERT INTO sms_monitor_state(id,value,checked_at) VALUES ('credit',${JSON.stringify({credit})}::jsonb,${now})
        ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value,checked_at=EXCLUDED.checked_at`;
    } catch { errors.push('Kredit se nepodařilo ověřit.'); }
  } else errors.push('Kredit se nepodařilo ověřit.');
  if (results[1].status==='fulfilled') {
    try {
      const {receipts,messages} = parseInbox(results[1].value);
      const parsed = parseResponse(results[1].value);
      const box = parsed.result?.inbox ?? parsed.inbox;
      const metadata = {messages:messages.length,receipts:receipts.length,bytes:results[1].value.length,
        deviceMessages:messages.filter(m=>normalizeNumber(m.number)===DEVICE_NUMBER).length,
        rootSections:Object.keys(parsed),
        sections:box && typeof box==='object'?Object.keys(box):[],
        messageItems:box?.delivery_sms?.item?list(box.delivery_sms.item).length:0,
        receiptItems:box?.delivery_report?.item?list(box.delivery_report.item).length:0};
      if (metadata.messageItems !== messages.length || metadata.receiptItems !== receipts.length) throw new Error('Nerozpoznané položky SMSbrány.');
      // Bulk inserts avoid one network request per historical inbox item. Nothing is deleted upstream.
      for(let i=0;i<messages.length;i+=250) {
        const batch=messages.slice(i,i+250);
        await sql`INSERT INTO sms_incoming_events(id,number,message,provider_time,provider_time_text,received_at,kind,locker_no)
          SELECT x.id,x.number,x.message,x.ts,x.time,${now},x.kind,x.locker
          FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS x(id text,number text,message text,ts bigint,time text,kind text,locker text)
          ON CONFLICT(id) DO NOTHING`;
      }
      for(let i=0;i<receipts.length;i+=250) {
        await sql`INSERT INTO sms_delivery_receipts(id,sms_id,number,status,provider_time,received_at)
          SELECT x.id,x."smsId",x.number,x.status,x.ts,${now}
          FROM jsonb_to_recordset(${JSON.stringify(receipts.slice(i,i+250))}::jsonb) AS x(id text,"smsId" text,number text,status integer,ts bigint)
          ON CONFLICT(id) DO NOTHING`;
      }
      await applyReceipts(sql);
      await sql`INSERT INTO sms_monitor_state(id,value,checked_at) VALUES ('inbox',${JSON.stringify(metadata)}::jsonb,${now})
        ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value,checked_at=EXCLUDED.checked_at`;
    } catch { errors.push('Příchozí zprávy a doručenky se nepodařilo ověřit.'); }
  } else errors.push('Příchozí zprávy a doručenky se nepodařilo ověřit.');
  await sql`INSERT INTO sms_monitor_state(id,value,checked_at) VALUES ('sync',${JSON.stringify({errors})}::jsonb,${now})
    ON CONFLICT(id) DO UPDATE SET value=EXCLUDED.value,checked_at=EXCLUDED.checked_at`;
}

export function publicAttempt(row) {
  const state = row.state === 'pending' ? 'unknown' : row.state;
  return { id:row.id, historyId:row.history_id, number:row.number, ts:Number(row.created_at),
    smsId:row.sms_id, state, status:row.provider_status,
    statusLabel:row.provider_status != null ? DELIVERY_LABELS[row.provider_status] : state==='failed'?'Odmítnuto bránou':state==='unknown'?'Odeslání nepotvrzeno':'Přijato bránou · čeká na doručenku',
    statusTime:row.provider_time == null?null:Number(row.provider_time),
    price:row.price==null?null:Number(row.price), smsCount:row.sms_count, error:row.error_text,
    guest:row.guest||'', actionType:row.action_type||'', lockerNo:row.locker_no||'', message:row.message };
}
