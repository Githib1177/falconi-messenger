// Odesílatele ani adresáta systémových příkazů nesmí vybírat klient.
const LOCKER_NUMBER = '420602783619'; // Stávající příjemce příkazů, nikoli odesílatel.

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function sender(env, key) {
  const value = env[key]?.trim();
  if (!value || !/^[A-Za-z0-9+_-]{1,64}$/.test(value)) {
    fail(503, `Missing or invalid ${key} configuration`);
  }
  return value;
}

function normalizeNumber(value) {
  if (typeof value !== 'string' || !/^\+?[\d\s()-]+$/.test(value.trim())) return '';
  let number = value.replace(/[\s()-]/g, '').replace(/^\+/, '').replace(/^00/, '');
  if (/^\d{9}$/.test(number)) number = '420' + number;
  return /^\d{8,15}$/.test(number) ? number : '';
}

export function routeSms(body, env) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'Invalid request');
  const allowed = ['type', 'to', 'text'];
  if (!['guest', 'locker'].includes(body.type)) fail(400, 'Explicit SMS type required: guest or locker');
  if (Object.keys(body).some(key => !allowed.includes(key))) fail(400, 'Unsupported request fields');

  if (body.type === 'locker') {
    const list = Array.isArray(body.to) ? body.to : [body.to];
    if (list.length !== 1 || normalizeNumber(list[0]) !== LOCKER_NUMBER) fail(400, 'Invalid locker recipient');
    if (typeof body.text !== 'string' || !/^pin[0-9]{4}\*0[1-8]\*apc\*[0-9]{6}\*$/.test(body.text)) {
      fail(400, 'Invalid locker command');
    }
    return { numbers: [LOCKER_NUMBER], text: body.text, senderId: sender(env, 'SMS_SYSTEM_SENDER_ID') };
  }

  if (typeof body.text !== 'string' || !body.text.trim()) fail(400, 'Missing text');
  // Odmítnout příkaz vydávaný za zprávu hostovi, i při změně adresáta.
  if (/^\s*pin\d+\s*\*/i.test(body.text)) fail(400, 'System command requires locker type');
  const list = Array.isArray(body.to) ? body.to : typeof body.to === 'string' ? body.to.split(/[,\n;]+/) : [];
  const numbers = list.map(normalizeNumber);
  if (!numbers.length || numbers.some(number => !number)) fail(400, 'Invalid recipient number(s)');
  if (numbers.includes(LOCKER_NUMBER)) fail(400, 'Locker recipient requires locker type');
  return { numbers: [...new Set(numbers)], text: body.text, senderId: sender(env, 'SMS_GUEST_SENDER_ID') };
}
