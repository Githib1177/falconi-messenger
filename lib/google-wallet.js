import { sign } from 'node:crypto';
export function walletConfig(env = process.env) {
  if (env.WALLET_ENABLED !== '1') throw new Error('Wallet není v tomto prostředí zapnutý.');
  const key = JSON.parse(env.GOOGLE_WALLET_SERVICE_ACCOUNT_JSON || '{}');
  if (!key.client_email || !key.private_key || !/^\d+$/.test(env.GOOGLE_WALLET_ISSUER_ID || '') || !/^[\w-]+$/.test(env.GOOGLE_WALLET_CLASS_SUFFIX || '')) throw new Error('Chybí nastavení Wallet.');
  return { key, issuerId: env.GOOGLE_WALLET_ISSUER_ID, classSuffix: env.GOOGLE_WALLET_CLASS_SUFFIX };
}
function signed(payload, key) {
  const input=[{alg:'RS256',typ:'JWT'},payload].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');
  return `${input}.${sign('RSA-SHA256',Buffer.from(input),key.private_key).toString('base64url')}`;
}
export function walletSaveUrl(id,config) {
  return 'https://pay.google.com/gp/v/save/'+signed({iss:config.key.client_email,aud:'google',typ:'savetowallet',iat:Math.floor(Date.now()/1000),payload:{genericObjects:[{id}]}},config.key);
}
export async function putWalletObject(object,config,fetcher=fetch) {
  const now=Math.floor(Date.now()/1000);
  const tokenResponse=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:signed({iss:config.key.client_email,aud:'https://oauth2.googleapis.com/token',scope:'https://www.googleapis.com/auth/wallet_object.issuer',iat:now,exp:now+3600},config.key)})});
  if(!tokenResponse.ok)throw new Error('Google odmítl přihlášení vydavatele.');
  const {access_token}=await tokenResponse.json();
  if(!access_token)throw new Error('Google nevrátil oprávnění vydavatele.');
  const call=(path,method)=>fetcher(`https://walletobjects.googleapis.com/walletobjects/v1/${path}`,{method,signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${access_token}`,'Content-Type':'application/json'},body:JSON.stringify(object)});
  // PUT replaces all owned fields, so a withdrawn access code cannot survive in old text modules.
  let response=await call(`genericObject/${object.id}`,'PUT');
  if(response.status===404){response=await call('genericObject','POST');if(response.status===409)response=await call(`genericObject/${object.id}`,'PUT');}
  if(!response.ok)throw new Error(`Google nepotvrdil aktualizaci karty (${response.status}).`);
  const saved=await response.json();
  if(saved.id!==object.id)throw new Error('Google vrátil jinou kartu.');
  return saved;
}
