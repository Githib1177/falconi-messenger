import { clearSessionCookie, createSessionCookie, isAuthorized, passwordMatches } from './_auth.js';

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json({ ok: isAuthorized(req) });
  if (req.method === 'POST') {
    if (!passwordMatches(req.body?.password)) return res.status(401).json({ ok: false, error: 'Nesprávné heslo' });
    res.setHeader('Set-Cookie', createSessionCookie());
    return res.status(200).json({ ok: true });
  }
  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearSessionCookie());
    return res.status(200).json({ ok: true });
  }
  return res.status(405).json({ ok: false });
}
