import { randomUUID, createHash } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { isAuthorized } from './_auth.js';
import { alfredDetails, buildWalletObject, accessDecision } from '../lib/wallet-pass.js';
import { walletConfig, putWalletObject, walletSaveUrl } from '../lib/google-wallet.js';
import { guestToken } from '../lib/wallet-guest-token.js';

export function createWalletHandler({ connect=neon, getConfig=walletConfig, putObject=putWalletObject, makeSaveUrl=walletSaveUrl } = {}) {
return async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(!isAuthorized(req))return res.status(401).json({error:'Přihlaste se znovu.'});
  if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({error:'Nepovolená metoda.'});}
  let sql, passId, claim;
  try {
    const config=getConfig();
    if(!process.env.DATABASE_URL)throw new Error('Chybí databáze Wallet.');
    const body=req.body || {};
    if(body.operatorConfirmed!==true)return res.status(400).json({error:'Potvrďte správnost stavu pro tuto kartu.'});
    const alfred=alfredDetails(body.alfred);
    const codesLink=body.action==='codes-link';
    const now=Date.now();
    let expiresAt=Date.parse(body.expiresAt),releaseAt=Date.parse(body.releaseAt);
    if(!codesLink&&(!Number.isFinite(expiresAt)||!Number.isFinite(releaseAt)||releaseAt>=expiresAt||expiresAt<=now||expiresAt>now+366*86400000))return res.status(400).json({error:'Zadejte platný čas zpřístupnění a konce pobytu.'});
    for(const field of ['checkinComplete','paymentComplete','lockerReady'])if(typeof body[field]!=='boolean')return res.status(400).json({error:'Chybí výslovné potvrzení stavu pobytu.'});
    if(body.lockerReady && !/^\d{6}$/.test(body.boxCode || ''))return res.status(400).json({error:'Připravená schránka musí mít šestimístný kód.'});
    if(codesLink&&(!body.checkinComplete||!body.paymentComplete||!body.lockerReady))return res.status(400).json({error:'Pro odeslání kódu potvrďte dokončený check-in, uhrazenou platbu a připravenou schránku.'});
    sql=connect(process.env.DATABASE_URL);
    await sql`CREATE TABLE IF NOT EXISTS wallet_passes (alfred_hash TEXT PRIMARY KEY, pass_id TEXT UNIQUE NOT NULL, claim TEXT, busy_until BIGINT NOT NULL DEFAULT 0, state TEXT, updated_at BIGINT, expires_at BIGINT);`;
    await sql`ALTER TABLE wallet_passes ADD COLUMN IF NOT EXISTS release_at BIGINT`;
    const hash=createHash('sha256').update(alfred.code).digest('hex');
    if(codesLink){
      const existing=await sql`SELECT pass_id FROM wallet_passes WHERE alfred_hash=${hash}`;
      if(!existing.length)return res.status(200).json({skipped:true,reason:'no-card'});
    }else await sql`INSERT INTO wallet_passes (alfred_hash,pass_id) VALUES (${hash},${randomUUID()}) ON CONFLICT (alfred_hash) DO NOTHING`;
    claim=randomUUID();
    const rows=await sql`UPDATE wallet_passes SET claim=${claim},busy_until=${now+120000} WHERE alfred_hash=${hash} AND busy_until < ${now} RETURNING pass_id,expires_at,release_at`;
    if(!rows.length)return res.status(409).json({error:'Tato karta se právě aktualizuje. Vyčkejte a zkuste to znovu.'});
    passId=rows[0].pass_id;
    if(codesLink){
      expiresAt=Number(rows[0].expires_at);
      releaseAt=rows[0].release_at==null?now:Number(rows[0].release_at);
      if(!Number.isFinite(expiresAt)||expiresAt<=now)return res.status(409).json({error:'Platnost karty skončila. Před odesláním opravte termín pobytu v části Wallet.'});
      if(!Number.isFinite(releaseAt)||releaseAt>now)return res.status(409).json({error:'Čas přístupu ke schránce ještě nenastal. Vyčkejte, nebo opravte čas v části Wallet.'});
    }
    await sql`UPDATE wallet_passes SET state=NULL WHERE pass_id=${passId} AND claim=${claim}`;
    const stay={passId,reservationId:hash,alfred:alfred.code,releaseAt,expiresAt,lockerAssignmentId:hash};
    const snapshot={source:'reception',hotelId:'85',reservationId:hash,alfredCode:alfred.code,verifiedAt:now,active:true,checkinComplete:body.checkinComplete,paymentComplete:body.paymentComplete};
    const locker={reservationId:hash,assignmentId:hash,programmingConfirmed:body.lockerReady,cardPrepared:body.lockerReady,code:body.boxCode,validFrom:releaseAt,validUntil:expiresAt};
    const object=buildWalletObject(stay,snapshot,locker,config,now);
    await putObject(object,config);
    const state=accessDecision(stay,snapshot,locker,now);
    await sql`UPDATE wallet_passes SET state=${state},updated_at=${now},expires_at=${expiresAt},release_at=${releaseAt} WHERE pass_id=${passId} AND claim=${claim}`;
    return res.status(200).json({state,saveUrl:makeSaveUrl(object.id,config),passId,guestToken:guestToken(passId,config)});
  }catch(error){
    const safe = /^(Wallet|Chybí nastavení Wallet|Chybí databáze Wallet|Neplatný|Google)/.test(error.message || '') ? error.message : 'Kartu se nepodařilo aktualizovat. Původní karta může zůstat beze změny; zkuste to znovu.';
    return res.status(503).json({error:safe});
  }finally{
    if(sql&&passId&&claim)try{await sql`UPDATE wallet_passes SET busy_until=0,claim=NULL WHERE pass_id=${passId} AND claim=${claim}`;}catch{}
  }
}

}
export default createWalletHandler();

