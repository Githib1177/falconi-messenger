import { neon } from '@neondatabase/serverless';
import { isAuthorized } from '../_auth.js';

export default async function handler(req, res) {
  if (!isAuthorized(req)) return res.status(401).json({ error: 'Přihlášení vypršelo. Přihlaste se znovu.' });
  if (!process.env.DATABASE_URL) return res.status(500).json({ error: 'Historie není připojená k databázi.' });
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', 'DELETE');
    return res.status(405).json({ error: 'Nepovolená metoda.' });
  }

  const id = Array.isArray(req.query?.id) ? req.query.id[0] : req.query?.id;
  if (!id) return res.status(400).json({ error: 'Chybí ID záznamu.' });

  try {
    const sql = neon(process.env.DATABASE_URL);
    await sql`DELETE FROM sms_history WHERE id = ${id};`;
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Záznam se nepodařilo odstranit.' });
  }
}
