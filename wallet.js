(() => {
  const container=document.createElement('section');
  container.className='card';container.id='walletPanel';
  container.innerHTML=`<h2>Karta pobytu v Google Wallet</h2>
    <p>Po vytvoření karty se možnost uložení do telefonu připojí k původnímu odkazu s pokyny pro hosta. Alfréd kód bude na kartě ihned. Stav potvrzuje recepce ručně.</p>
    <div class="grid two"><div><label for="walletRelease">Přístup ke schránce nejdříve</label><input id="walletRelease" type="datetime-local"></div><div><label for="walletExpires">Konec platnosti karty</label><input id="walletExpires" type="datetime-local"></div></div>
    <label class="state-switch"><input id="walletReady" type="checkbox"><span>Pro tohoto hosta je ve schránce vložená karta a správný kód je ověřený.</span></label>
    <label class="state-switch"><input id="walletConfirm" type="checkbox"><span>Potvrzuji Alfréd kód, stav check-inu a platby nahoře a platnost pobytu pro tuto kartu.</span></label>
    <p class="small">Alfréd kód zůstává na kartě vždy. Při odeslání odkazu na kódy se existující karta aktualizuje automaticky podle údajů nahoře; potvrzením odeslání potvrzujete připravenou schránku. Oba časy vyplňte při prvním vytvoření karty. Aktualizace telefonu vyžaduje internet.</p>
    <div class="row"><button id="walletSync" class="btn" type="button">Vytvořit / aktualizovat kartu</button><button id="walletCopy" class="btn-ghost" type="button" hidden>Kopírovat odkaz na kartu</button><a id="walletOpen" class="btn-ghost" target="_blank" rel="noopener noreferrer" hidden>Otevřít kartu</a></div><p id="walletStatus" role="status" aria-live="polite"></p>`;
  document.querySelector('#bookingState').closest('.card').after(container);
  const q=id=>document.getElementById(id);
  let saveUrl='', revision=0;
  let guestCard=null;
  const fingerprint=()=>JSON.stringify(['alf','box','guest','done','unpaid','walletReady','walletRelease','walletExpires','noSendBoxInLink'].map(id=>q(id)?.type==='checkbox'?q(id).checked:q(id)?.value));
  window.falconiWalletLink=url=>{
    if(!guestCard||guestCard.fingerprint!==fingerprint()||(guestCard.state==='ready'&&q('noSendBoxInLink')?.checked))return url;
    try{const parsed=new URL(url);if(parsed.protocol!=='https:'||parsed.hostname!=='www.pensionfalconi.cz'||!/^\/(cs|en|de)\/(checkin|codes)\/$/.test(parsed.pathname))return url;parsed.hash='wallet-'+Array.from(guestCard.token,c=>c.charCodeAt(0).toString(16).padStart(2,'0')).join('');return parsed.href;}catch{return url;}
  };
  const reset=()=>{revision++;guestCard=null;saveUrl='';q('walletCopy').hidden=true;q('walletOpen').hidden=true;q('walletOpen').removeAttribute('href');q('walletConfirm').checked=false;q('walletStatus').textContent='';window.gen?.();};
  for(const id of ['alf','box','guest','done','unpaid','walletReady','walletRelease','walletExpires','noSendBoxInLink'])q(id)?.addEventListener('input',()=>{reset();if(id==='alf'||id==='box'||id==='guest')q('walletReady').checked=false;});
  q('clear').addEventListener('click',()=>{reset();q('walletReady').checked=false;q('walletRelease').value='';q('walletExpires').value='';});
  document.addEventListener('falconi:stay-loaded',()=>{reset();q('walletReady').checked=false;q('walletRelease').value='';q('walletExpires').value='';});
  window.falconiWalletBeforeCodes=async()=>{
    const submittedFingerprint=fingerprint();
    const body={action:'codes-link',alfred:q('alf').value,boxCode:q('box').value.trim(),checkinComplete:q('done').checked,paymentComplete:!q('unpaid').checked,lockerReady:true,operatorConfirmed:true};
    reset();
    const requestRevision=revision;
    q('walletSync').disabled=true;
    q('walletStatus').textContent='Aktualizuji kartu před odesláním kódů…';
    try{
      const response=await fetch('/api/wallet',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error||'Aktualizace karty se nezdařila.');
      if(revision!==requestRevision||fingerprint()!==submittedFingerprint)throw new Error('Údaje hosta se změnily. Zkontrolujte pobyt a odešlete znovu.');
      if(result.skipped===true&&result.reason==='no-card'){q('walletStatus').textContent='Pro tento Alfréd kód ještě nebyla vytvořena karta.';return;}
      if(result.state!=='ready'||!/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(result.guestToken||''))throw new Error('Google nepotvrdil zpřístupnění kódu na kartě.');
      guestCard={token:result.guestToken,fingerprint:submittedFingerprint,state:result.state};
      saveUrl=location.origin+'/api/wallet-save?token='+encodeURIComponent(result.guestToken);
      q('walletOpen').href=saveUrl;q('walletOpen').hidden=false;q('walletCopy').hidden=false;
      q('walletStatus').textContent='Google potvrdil aktualizaci: Alfréd i kód schránky. Synchronizace telefonu může chvíli trvat.';
      window.gen?.();
    }catch(error){q('walletStatus').textContent=error.message;throw error;}
    finally{q('walletSync').disabled=false;}
  };
  q('walletSync').addEventListener('click',async()=>{
    if(!q('walletConfirm').checked){q('walletStatus').textContent='Nejdříve potvrďte správnost údajů pro tuto kartu.';return;}
    const release=new Date(q('walletRelease').value),expires=new Date(q('walletExpires').value);
    if(!Number.isFinite(release.getTime())||!Number.isFinite(expires.getTime())){q('walletStatus').textContent='Vyplňte oba časy platnosti.';return;}
    const submittedRevision=revision;
    const submittedFingerprint=fingerprint();
    const body={alfred:q('alf').value,boxCode:q('box').value.trim(),checkinComplete:q('done').checked,paymentComplete:!q('unpaid').checked,lockerReady:q('walletReady').checked,operatorConfirmed:true,releaseAt:release.toISOString(),expiresAt:expires.toISOString()};
    guestCard=null;window.gen?.();
    q('walletSync').disabled=true;q('walletCopy').hidden=true;q('walletOpen').hidden=true;saveUrl='';q('walletStatus').textContent='Aktualizuji kartu…';
    try {
      const response=await fetch('/api/wallet',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      const result=await response.json();if(!response.ok)throw new Error(result.error||'Aktualizace se nezdařila.');
      if(!result.saveUrl?.startsWith('https://pay.google.com/gp/v/save/'))throw new Error('Neplatný odkaz na kartu.');
      // A changed form must never expose the previous guest's save link.
      if(revision!==submittedRevision||fingerprint()!==submittedFingerprint)throw new Error('Údaje hosta se změnily. Karta byla zpracována pro původní Alfréd kód; načtěte správný pobyt.');
      if(!/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(result.guestToken||''))throw new Error('Chybí bezpečný odkaz pro hosta.');
      guestCard={token:result.guestToken,fingerprint:submittedFingerprint,state:result.state};window.gen?.();
      saveUrl=location.origin+'/api/wallet-save?token='+encodeURIComponent(result.guestToken);q('walletOpen').href=saveUrl;q('walletOpen').hidden=false;q('walletCopy').hidden=false;
      q('walletStatus').textContent=result.state==='ready'?'Google potvrdil aktualizaci: Alfréd i kód schránky. Synchronizace telefonu může chvíli trvat.':'Google potvrdil aktualizaci: Alfréd kód a odkaz. Kód schránky není zveřejněný.';
      q('walletConfirm').checked=false;
    }catch(e){q('walletStatus').textContent=e.message;}finally{q('walletSync').disabled=false;}
  });
  q('walletCopy').addEventListener('click',async()=>{if(saveUrl)try{await navigator.clipboard.writeText(saveUrl);q('walletStatus').textContent='Odkaz na kartu byl zkopírován.';}catch{q('walletStatus').textContent='Kopírování není dostupné. Použijte Otevřít kartu.';}});
})();

