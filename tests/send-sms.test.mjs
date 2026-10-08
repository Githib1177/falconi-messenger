import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import handler from '../api/send-sms.js';

const guest = { type: 'guest', to: ['+420777111222'], text: 'Zpráva hostovi' };
const locker = { type: 'locker', to: ['+420602783619'], text: 'pin0000*01*apc*123456*' };
let originalEnv, originalFetch, calls;
beforeEach(() => {
  originalEnv = { ...process.env };
  originalFetch = globalThis.fetch;
  Object.assign(process.env, {
    SMS_LOGIN: 'test-login', SMS_PASSWORD: 'test-password',
    SMS_SYSTEM_SENDER_ID: 'system-test', SMS_GUEST_SENDER_ID: 'guest-test',
  });
  calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push(new URLSearchParams(options.method === 'POST' ? options.body : new URL(url).search));
    return { status: 200, text: async () => '<err>0</err><sms_id>123</sms_id>' };
  };
});
afterEach(() => { process.env = originalEnv; globalThis.fetch = originalFetch; });

async function request(body, method = 'POST') {
  const response = { status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  await handler({ method, body }, response);
  return response;
}

test('guest and locker select independent server senders; credentials stay unchanged', async () => {
  assert.equal((await request(guest)).data.ok, true);
  assert.equal((await request(locker)).data.ok, true);
  assert.equal(calls[0].get('sender_id'), 'guest-test');
  assert.equal(calls[1].get('sender_id'), 'system-test');
  assert.equal(calls[1].get('message'), locker.text);
  assert.equal(calls[1].get('number'), '420602783619');
  for (const call of calls) {
    assert.equal(call.get('login'), 'test-login');
    assert.equal(call.get('password'), 'test-password');
  }
  process.env.SMS_GUEST_SENDER_ID = 'another-guest';
  await request(locker);
  assert.equal(calls[2].get('sender_id'), 'system-test');
});

test('missing, blank and malformed sender configuration fails closed', async () => {
  for (const [body, key] of [[guest, 'SMS_GUEST_SENDER_ID'], [locker, 'SMS_SYSTEM_SENDER_ID']]) {
    for (const value of [undefined, '', '   ', 'bad&sender=x']) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
      assert.equal((await request(body)).code, 503);
    }
    process.env[key] = 'restored';
  }
  assert.equal(calls.length, 0);
});

test('missing opposite sender does not affect the selected route', async () => {
  delete process.env.SMS_GUEST_SENDER_ID;
  assert.equal((await request(locker)).data.ok, true);
  process.env.SMS_GUEST_SENDER_ID = 'guest-test';
  delete process.env.SMS_SYSTEM_SENDER_ID;
  assert.equal((await request(guest)).data.ok, true);
});

test('reject missing or unknown type, overrides and invalid requests before network', async () => {
  const bodies = [null, [], {}, { ...guest, type: undefined }, { ...guest, type: 'system' },
    { ...guest, sender_id: 'system-test' }, { ...locker, sender: 'guest-test' },
    { ...locker, to: guest.to }, { ...locker, to: [...locker.to, ...guest.to] },
    { ...locker, text: 'pin0000*09*apc*123456*' }, { ...locker, text: locker.text + '\n' },
    { ...guest, to: [] }, { ...guest, to: [...guest.to, 'bad'] }, { ...guest, text: {} },
    { ...guest, text: locker.text }, { ...guest, text: '  PIN0000*01*apc*123456*' }];
  for (const body of bodies) assert.equal((await request(body)).code, 400, JSON.stringify(body));
  assert.equal(calls.length, 0);
});

test('guest route cannot reach locker in local or international formats or a mixed batch', async () => {
  for (const number of ['602783619', '+420 602 783 619', '00420602783619', '420602783619', '+420(602)783-619']) {
    assert.equal((await request({ ...guest, to: [number] })).code, 400);
    assert.equal((await request({ ...guest, to: [...guest.to, number] })).code, 400);
  }
  assert.equal(calls.length, 0);
});

test('all GET/POST and encoding strategies retain the selected sender', async () => {
  for (const body of [guest, locker]) {
    calls = [];
    globalThis.fetch = async (url, options) => {
      calls.push({ method: options.method, params: new URLSearchParams(options.method === 'POST' ? options.body : new URL(url).search) });
      return { status: 200, text: async () => '<err>12</err>' };
    };
    assert.equal((await request(body)).data.ok, false);
    assert.equal(calls.length, 8);
    assert.ok(calls.some(call => call.method === 'POST'));
    assert.ok(calls.some(call => call.params.get('data_code') === 'ucs2'));
    for (const call of calls) assert.equal(call.params.get('sender_id'), body.type === 'locker' ? 'system-test' : 'guest-test');
  }
});

test('gateway exception and response cannot expose credentials or sender config', async () => {
  globalThis.fetch = async () => { throw new Error('test-password system-test'); };
  const failure = await request(locker);
  assert.equal(failure.code, 500);
  assert.doesNotMatch(JSON.stringify(failure.data), /test-password|system-test/);
  globalThis.fetch = async () => ({ status: 200, text: async () => '<err>0</err><debug>test-password system-test</debug>' });
  const success = await request(locker);
  assert.equal(success.data.ok, true);
  assert.doesNotMatch(JSON.stringify(success.data), /test-password|system-test/);
});

test('method and credentials validation sends nothing', async () => {
  assert.equal((await request(guest, 'GET')).code, 405);
  delete process.env.SMS_PASSWORD;
  assert.equal((await request(guest)).code, 500);
  assert.equal(calls.length, 0);
});

test('all three client send actions explicitly specify their type without sender configuration', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.equal((html.match(/fetch\('\/api\/send-sms'/g) || []).length, 3);
  assert.equal((html.match(/JSON.stringify\(\{ type: 'guest', to: numbers, text \}\)/g) || []).length, 2);
  assert.equal((html.match(/JSON.stringify\(\{ type: 'locker', to: \[BOX_DEST\], text: cmd \}\)/g) || []).length, 1);
  assert.doesNotMatch(html, /SMS_SYSTEM_SENDER_ID|SMS_GUEST_SENDER_ID|sender_id/);
});


test('selected InfoSMS sender and system ID zero are passed explicitly', async () => {
  process.env.SMS_SYSTEM_SENDER_ID = '0';
  process.env.SMS_GUEST_SENDER_ID = '30514';
  assert.equal((await request(guest)).data.ok, true);
  assert.equal((await request(locker)).data.ok, true);
  assert.equal(calls[0].get('sender_id'), '30514');
  assert.equal(calls[1].get('sender_id'), '0');
});
