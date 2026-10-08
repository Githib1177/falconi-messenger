import {randomBytes} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
import {isAuthorized} from './_auth.js';
export function validateDestination(value){
 if(typeof value!=='string'||value.length>2048)throw Error('Invalid URL');
 const u=new URL(value);
 if(u.origin!=='https://www.pensionfalconi.cz'||!/^\/(cs|en|de)\/(checkin|codes)\/$/.test(u.pathname)||u.username||u.password)throw Error('Invalid destination');
 return u.href;
}
export function createGuestLinkHandler({connect=neon}={}){return async(req,res)=>{
 res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Robots-Tag','noindex, nofollow');
 if(req.method==='POST'){
  if(!isAuthorized(req))return res.status(401).json({error:'Přihlaste se znovu.'});
  let urls;try{if(!Array.isArray(req.body?.urls)||req.body.urls.length<1||req.body.urls.length>3)throw Error();urls=req.body.urls.map(validateDestination);}catch{return res.status(400).json({error:'Odkaz musí vést na check-in nebo kódy Pensionu Falconi.'});}
  try{
   const sql=connect(process.env.DATABASE_URL);
   await sql`CREATE TABLE IF NOT EXISTS guest_short_links (id TEXT PRIMARY KEY, url TEXT NOT NULL, expires_at BIGINT NOT NULL)`;
   const result=[];for(const url of urls){const id=randomBytes(16).toString('base64url'),expires=Date.now()+180*86400000;await sql`INSERT INTO guest_short_links (id,url,expires_at) VALUES (${id},${url},${expires})`;result.push('https://falconi-messenger.vercel.app/s/'+id);}
   return res.status(200).json({urls:result});
  }catch{return res.status(503).json({error:'Krátký odkaz nelze uložit. Zpráva nebyla odeslána; zkuste to znovu.'});}
 }
 if(!['GET','HEAD'].includes(req.method))return res.status(405).end();
 const id=req.query?.id;if(typeof id!=='string'||! /^[A-Za-z0-9_-]{22}$/.test(id))return res.status(404).end('Odkaz nebyl nalezen.');
 try{
  const sql=connect(process.env.DATABASE_URL),now=Date.now();
  const rows=await sql`SELECT url FROM guest_short_links WHERE id=${id} AND expires_at>${now}`;
  if(!rows.length)return res.status(404).end('Odkaz již není dostupný. Kontaktujte prosím recepci.');
  res.setHeader('Location',validateDestination(rows[0].url));return res.status(302).end();
 }catch{return res.status(503).end('Portál je dočasně nedostupný. Zkuste to prosím znovu.');}
};}
export default createGuestLinkHandler();
