import { routeSms } from '../lib/sms-routing.mjs';

// api/send-sms.js

// ---------- Pomocné funkce ----------
function stripDiacritics(s) {
  if (!s) return '';
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[\r\n]+/g, ' ').trim();
}
function toUCS2Hex(s) {
  let hex = '';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code <= 0xffff) {
      hex += code.toString(16).padStart(4, '0');
    } else {
      const cp = code - 0x10000;
      const hi = 0xd800 + (cp >> 10);
      const lo = 0xdc00 + (cp & 0x3ff);
      hex += hi.toString(16).padStart(4, '0') + lo.toString(16).padStart(4, '0');
    }
  }
  return hex;
}
function parseXml(raw) {
  const errMatch = raw.match(/<err>(-?\d+)<\/err>/);
  const idMatch  = raw.match(/<sms_id>(\d+)<\/sms_id>/);
  return { err: errMatch ? Number(errMatch[1]) : null, sms_id: idMatch ? idMatch[1] : null };
}
const ERR_MAP = {
  0: 'OK',
  1: 'Neznámá chyba',
  2: 'Neplatný login',
  3: 'Neplatný hash/heslo',
  4: 'Neplatný time',
  5: 'Nepovolená IP',
  6: 'Neplatná akce / parametry / kódování',
  7: 'Salt již použit',
  8: 'Chyba DB',
  9: 'Nedostatečný kredit',
  10: 'Neplatné číslo',
  11: 'Chyba odeslání',
  12: 'Chybný parametr',
};

// ---------- Nízká úroveň: GET/POST volání ----------
async function callGateway({ method, endpoint, query, body }) {
  let url = endpoint;
  const headers = {};

  if (method === 'GET') {
    url += (endpoint.includes('?') ? '&' : '?') + new URLSearchParams(query).toString();
  } else {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  console.log('[send-sms] fetch', { method, endpoint });

  const r = await fetch(url, {
    method,
    headers,
    body: method === 'POST' ? new URLSearchParams(body).toString() : undefined,
  });

  const raw = await r.text();
  console.log('[send-sms] response', { status: r.status });

  const parsed = parseXml(raw);
  return { http: r.status, raw, ...parsed, errMessage: parsed.err != null ? (ERR_MAP[parsed.err] || 'Neznámá chyba') : 'Neznámá odpověď' };
}

// ---------- Odeslání jedné SMS s více strategiemi ----------
async function sendStrategies({ login, password, number, text, senderId }) {
  // Připravíme varianty textu
  const plain = String(text).replace(/[\r\n]+/g, ' ').trim();  // bez \n
  const ascii = stripDiacritics(plain);
  const ucs2hex = toUCS2Hex(plain);

  // Endpoints a pořadí strategií:
  const ENDPOINTS = [
    'https://www.smsbrana.cz/smsconnect/http.php',
    'https://api.smsbrana.cz/smsconnect/http.php',
  ];

  // 1) GET + ASCII (to je nejblíž tvému ručnímu testu, který fungoval)
  for (const ep of ENDPOINTS) {
    const res = await callGateway({
      method: 'GET',
      endpoint: ep,
      query: {
        action: 'send_sms',
        login,
        password,
        number,
        sender_id: senderId,
        message: ascii,
      },
    });
    if (res.err === 0) return { attempt: 'GET-ascii', endpoint: ep, ...res };
  }

  // 2) GET + UCS2 (data_code=ucs2 + hex)
  for (const ep of ENDPOINTS) {
    const res = await callGateway({
      method: 'GET',
      endpoint: ep,
      query: {
        action: 'send_sms',
        login,
        password,
        number,
        sender_id: senderId,
        data_code: 'ucs2',
        message: ucs2hex,
      },
    });
    if (res.err === 0) return { attempt: 'GET-ucs2hex', endpoint: ep, ...res };
  }

  // 3) POST + ASCII (kdyby náhodou)
  for (const ep of ENDPOINTS) {
    const res = await callGateway({
      method: 'POST',
      endpoint: ep,
      body: {
        action: 'send_sms',
        login,
        password,
        number,
        sender_id: senderId,
        message: ascii,
      },
    });
    if (res.err === 0) return { attempt: 'POST-ascii', endpoint: ep, ...res };
  }

  // 4) POST + UCS2
  for (const ep of ENDPOINTS) {
    const res = await callGateway({
      method: 'POST',
      endpoint: ep,
      body: {
        action: 'send_sms',
        login,
        password,
        number,
        sender_id: senderId,
        data_code: 'ucs2',
        message: ucs2hex,
      },
    });
    if (res.err === 0) return { attempt: 'POST-ucs2hex', endpoint: ep, ...res };
  }

  // Nic neprošlo → vrať poslední výsledek (pro diagnostiku)
  return { attempt: 'none', endpoint: ENDPOINTS[0], err: 6, errMessage: ERR_MAP[6] };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let routed;
  try {
    routed = routeSms(req.body, process.env);
  } catch (error) {
    return res.status(error.status || 500).json({ ok: false, error: error.message });
  }
  const { numbers, text, senderId } = routed;
  const LOGIN = process.env.SMS_LOGIN;
  const PASSWORD = process.env.SMS_PASSWORD;
  console.log('[send-sms] env loaded:', { hasLogin: !!LOGIN, hasPass: !!PASSWORD });
  if (!LOGIN || !PASSWORD) return res.status(500).json({ ok: false, error: 'Missing SMS_LOGIN or SMS_PASSWORD env' });

  try {
    const results = [];
    for (const n of numbers) {
      const r = await sendStrategies({ login: LOGIN, password: PASSWORD, number: n, text, senderId });
      results.push({ number: n, err: r.err, sms_id: r.sms_id, errMessage: r.errMessage });
    }
    const ok = results.some(r => r.err === 0);
    return res.status(200).json({ ok, results });
  } catch (e) {
    console.error('[send-sms] gateway request failed');
    return res.status(500).json({ ok: false, error: 'SMS gateway request failed' });
  }
}

