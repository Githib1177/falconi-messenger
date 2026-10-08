import crypto from 'node:crypto';

const COOKIE = 'falconi_session';
const MAX_AGE = 60 * 60 * 24 * 180;

function secret() {
  return process.env.SESSION_SECRET || process.env.APP_PASSWORD || '';
}

function signature(value) {
  return crypto.createHmac('sha256', secret()).update(value).digest('base64url');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function createSessionCookie() {
  const expires = String(Date.now() + MAX_AGE * 1000);
  return `${COOKIE}=${expires}.${signature(expires)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}`;
}

export function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

export function isAuthorized(req) {
  if (!secret()) return false;
  const cookies = Object.fromEntries(String(req.headers.cookie || '').split(';').map(v => v.trim().split('=')));
  const [expires, sig] = String(cookies[COOKIE] || '').split('.');
  return Number(expires) > Date.now() && safeEqual(sig, signature(expires));
}

export function passwordMatches(value) {
  const expected = Buffer.from(String(process.env.APP_PASSWORD || ''));
  const supplied = Buffer.from(String(value || ''));
  return expected.length > 0 && expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}
