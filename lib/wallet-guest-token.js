import { createHmac, timingSafeEqual } from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function guestToken(passId,config) {
  if(!uuid.test(passId)||!config.key?.private_key)throw new Error('Neplatný odkaz na kartu.');
  const signature=createHmac('sha256',config.key.private_key).update('falconi-guest-wallet-v1:'+passId).digest('base64url');
  return passId+'.'+signature;
}
export function verifyGuestToken(token,config) {
  if(typeof token!=='string'||token.length!==80)return null;
  const [id,signature]=token.split('.');
  if(!uuid.test(id)||!signature||!/^[A-Za-z0-9_-]{43}$/.test(signature))return null;
  return timingSafeEqual(Buffer.from(token),Buffer.from(guestToken(id,config)))?id:null;
}
