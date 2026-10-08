import { neon } from '@neondatabase/serverless';
import { isAuthorized } from '../_auth.js';
import { ensureMonitor, publicAttempt } from '../../lib/sms-monitor.js';

const toCsv = arr => Array.isArray(arr) ? arr.join(',') : '';
const fromCsv = value => (value || '').split(',').map(item => item.trim()).filter(Boolean);

async function ensureTable(sql) {
  await sql`
    CREATE TABLE IF NOT EXISTS sms_history (
      id TEXT PRIMARY KEY,
      ts BIGINT NOT NULL,
      guest TEXT,
      lang TEXT,
      to_numbers TEXT,
      text_body TEXT,
      link TEXT,
      action_type TEXT,
      locker_no TEXT,
      room_no TEXT,
      box_code TEXT,
      result_status TEXT
    );
  `;
  await sql`ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS action_type TEXT;`;
  await sql`ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS locker_no TEXT;`;
  await sql`ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS room_no TEXT;`;
  await sql`ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS box_code TEXT;`;
  await sql`ALTER TABLE sms_history ADD COLUMN IF NOT EXISTS result_status TEXT;`;
}

export default async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Přihlášení vypršelo. Přihlaste se znovu.' });
  if (!process.env.DATABASE_URL) return res.status(500).json({ error: 'Historie není připojená k databázi.' });

  const sql = neon(process.env.DATABASE_URL);

  try {
    await ensureTable(sql);

    if (req.method === 'GET') {
      const requestedLimit = Number.parseInt(String(req.query?.limit || '50'), 10);
      const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : 50, 1), 200);
      const recentRows = await sql`
        SELECT id, ts, guest, lang, to_numbers, text_body, link,
               action_type, locker_no, room_no, box_code, result_status
        FROM sms_history
        ORDER BY ts DESC
        LIMIT ${limit};
      `;
      // Stav schránek musí zůstat dostupný i po zaplnění běžného limitu historie.
      const lockerRows = req.query?.includeLockers === '1' ? await sql`
        SELECT id, ts, guest, lang, to_numbers, text_body, link,
               action_type, locker_no, room_no, box_code, result_status
        FROM sms_history
        WHERE lang = 'locker' OR action_type = 'locker'
        ORDER BY ts DESC
        LIMIT 100;
      ` : [];
      const rows = [...new Map([...recentRows, ...lockerRows].map(row => [row.id, row])).values()]
        .sort((a, b) => Number(b.ts) - Number(a.ts));
      const deliveries = new Map();
      // Monitoring must never prevent loading the existing reservation history.
      try {
        await ensureMonitor(sql);
        const attempts = await sql`SELECT * FROM sms_delivery_attempts WHERE history_id = ANY(${rows.map(r=>r.id)}::text[])`;
        for (const a of attempts) deliveries.set(a.history_id,[...(deliveries.get(a.history_id)||[]),publicAttempt(a)]);
      } catch {}
      return res.status(200).json(rows.map(row => ({
        id: row.id,
        ts: Number(row.ts),
        guest: row.guest || '',
        lang: row.lang || '',
        to: fromCsv(row.to_numbers),
        text: row.text_body || '',
        link: row.link || '',
        actionType: row.action_type || '',
        lockerNo: row.locker_no || '',
        roomNo: row.room_no || '',
        boxCode: row.box_code || '',
        resultStatus: row.result_status || '',
        deliveries: deliveries.get(row.id) || []
      })));
    }

    if (req.method === 'POST') {
      const { id, ts, guest, lang, to, text, link, actionType, lockerNo, roomNo, boxCode, resultStatus } = req.body || {};
      if (!id || !ts || !text || !Array.isArray(to)) {
        return res.status(400).json({ error: 'Chybí povinné údaje historie.' });
      }
      await sql`
        INSERT INTO sms_history (id, ts, guest, lang, to_numbers, text_body, link,
                                 action_type, locker_no, room_no, box_code, result_status)
        VALUES (${id}, ${String(ts)}, ${guest ?? null}, ${lang ?? null},
                ${toCsv(to)}, ${text}, ${link ?? null}, ${actionType ?? null},
                ${lockerNo ?? null}, ${roomNo ?? null}, ${boxCode ?? null}, ${resultStatus ?? null})
        ON CONFLICT (id) DO UPDATE SET
          ts = EXCLUDED.ts,
          guest = EXCLUDED.guest,
          lang = EXCLUDED.lang,
          to_numbers = EXCLUDED.to_numbers,
          text_body = EXCLUDED.text_body,
          link = EXCLUDED.link,
          action_type = EXCLUDED.action_type,
          locker_no = EXCLUDED.locker_no,
          room_no = EXCLUDED.room_no,
          box_code = EXCLUDED.box_code,
          result_status = EXCLUDED.result_status;
      `;
      return res.status(200).json({ ok: true, id });
    }

    if (req.method === 'DELETE') {
      await sql`DELETE FROM sms_history;`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Nepovolená metoda.' });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Historii se nepodařilo načíst.' });
  }
}
