import { neon } from '@neondatabase/serverless';
import { walletConfig, walletSaveUrl } from '../lib/google-wallet.js';
import { verifyGuestToken } from '../lib/wallet-guest-token.js';

// Possession of the signed stay link permits saving only this already-issued card.
// Guest-controlled check-in/payment/code parameters are never read here.
export function createWalletSaveHandler({connect=neon,getConfig=walletConfig,makeSaveUrl=walletSaveUrl}={}) {
  return async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Robots-Tag','noindex, nofollow');
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).end('Method not allowed');}
    try{
      const config=getConfig(),id=verifyGuestToken(req.query?.token,config);
      if(!id)return res.status(404).end('Karta není dostupná / Pass unavailable. Kontaktujte recepci: +420 721 516 894.');
      if(!process.env.DATABASE_URL)throw new Error('Database unavailable');
      const sql=connect(process.env.DATABASE_URL);
      const rows=await sql`SELECT state,expires_at,busy_until FROM wallet_passes WHERE pass_id=${id}`;
      const row=rows[0],now=Date.now();
      if(row&&Number(row.busy_until)>now)return res.status(503).end('Karta se aktualizuje. Zkuste to za chvíli / Please retry shortly.');
      if(!row||!['pending','ready'].includes(row.state)||Number(row.expires_at)<=now||!Number.isFinite(Number(row.expires_at)))return res.status(404).end('Platnost karty skončila nebo karta není dostupná / Pass unavailable. Recepce: +420 721 516 894.');
      res.setHeader('Location',makeSaveUrl(config.issuerId+'.'+id,config));
      return res.status(302).end();
    }catch{return res.status(503).end('Kartu nyní nelze uložit. Pokyny najdete v původní zprávě / Please use your original arrival instructions. Recepce: +420 721 516 894.');}
  };
}
export default createWalletSaveHandler();
