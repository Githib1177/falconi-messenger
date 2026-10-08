(()=>{
 const q=id=>document.getElementById(id),originalGen=window.gen;
 const cache=new Map(),pending=new Map(),originals=new Map();let revision=0,timer;
 window.falconiOriginalLink=url=>originals.get(url)||url;
 const fields=['base','pathCZ','pathEN','pathDE','alfBase','guest','isFemale','alf','box','done','unpaid','noSendBoxInLink','smsTo','smsLang','lockerNo','roomNo','doBoxCode'];
 const signature=()=>JSON.stringify(fields.map(id=>q(id)?.type==='checkbox'?q(id).checked:q(id)?.value));
 const status=document.createElement('p');status.id='shortLinkStatus';status.setAttribute('role','status');q('urlCZ').parentElement.after(status);
 async function shorten(urls){
  const key=JSON.stringify(urls);if(cache.has(key))return cache.get(key);if(pending.has(key))return pending.get(key);
  const request=(async()=>{const response=await fetch('/api/guest-link',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({urls})});const data=await response.json();if(!response.ok)throw Error(data.error||'Krátký odkaz se nepodařilo vytvořit.');if(!Array.isArray(data.urls)||data.urls.length!==urls.length||data.urls.some(u=>!/^https:\/\/falconi-messenger\.vercel\.app\/s\/[A-Za-z0-9_-]{22}$/.test(u)))throw Error('Server nevrátil platný krátký odkaz.');cache.set(key,data.urls);if(cache.size>50)cache.delete(cache.keys().next().value);return data.urls;})();
  pending.set(key,request);try{const result=await request;result.forEach((url,i)=>originals.set(url,urls[i]));return result;}finally{pending.delete(key);}
 }
 window.falconiShortenLinks=shorten;
 function apply(urls,short){for(const [i,lang] of ['CZ','EN','DE'].entries()){
  q('url'+lang).textContent=short[i];q('open'+lang).href=short[i];
  for(const kind of ['sms','mail'])q(kind+lang).value=q(kind+lang).value.split(urls[i]).join(short[i]);
 }}
 window.falconiPrepareLinks=async()=>{
  clearTimeout(timer);originalGen();const own=++revision,submitted=signature();
  const urls=['CZ','EN','DE'].map(lang=>q('url'+lang).textContent);
  const texts=['smsCZ','smsEN','smsDE','mailCZ','mailEN','mailDE'].map(id=>q(id).value);
  const key=JSON.stringify(urls);if(cache.has(key)){apply(urls,cache.get(key));status.textContent='Krátké odkazy jsou připravené.';return;}
  for(const lang of ['CZ','EN','DE']){q('url'+lang).textContent='Připravuji krátký odkaz…';q('open'+lang).removeAttribute('href');for(const kind of ['sms','mail'])q(kind+lang).value='';}
  status.textContent='Připravuji krátké odkazy…';
  try{const short=await shorten(urls);if(own!==revision||signature()!==submitted)throw Error('Údaje se změnily. Vytvořte odkazy znovu.');
   ['smsCZ','smsEN','smsDE','mailCZ','mailEN','mailDE'].forEach((id,i)=>q(id).value=texts[i]);apply(urls,short);status.textContent='Krátké odkazy jsou připravené.';
  }catch(error){if(own===revision)status.textContent=error.message;throw error;}
 };
 window.gen=()=>{originalGen();revision++;clearTimeout(timer);if(!q('alf').value.trim())return;
  const urls=['CZ','EN','DE'].map(lang=>q('url'+lang).textContent),key=JSON.stringify(urls);
  if(cache.has(key)){apply(urls,cache.get(key));return;}
  for(const lang of ['CZ','EN','DE']){q('url'+lang).textContent='Připravuji krátký odkaz…';q('open'+lang).removeAttribute('href');for(const kind of ['sms','mail'])q(kind+lang).value='';}
  timer=setTimeout(()=>window.falconiPrepareLinks().catch(()=>{}),500);
 };
 window.gen();
})();
