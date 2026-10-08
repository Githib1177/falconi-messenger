(() => {
  const $=s=>document.querySelector(s);
  let data=null, active=false, busy=false, timer=null;
  let seen=null;
  try { const stored=localStorage.getItem('falconi_sms_seen'); if(stored!==null) seen=Number(stored); } catch {}
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  const time=ts=>ts?new Date(ts).toLocaleString('cs-CZ'):'Čas neuveden';
  const money=n=>Number(n).toLocaleString('cs-CZ',{minimumFractionDigits:2,maximumFractionDigits:2})+' Kč';
  function markRead(){
    seen=Math.max(Date.now(),...(data?.events||[]).map(e=>e.receivedAt));
    try{localStorage.setItem('falconi_sms_seen',String(seen));}catch{}
    render();
  }
  function render(){
    if(!data)return;
    const events=data.events||[];
    if(seen===null){seen=Math.max(0,...events.map(e=>e.receivedAt));try{localStorage.setItem('falconi_sms_seen',String(seen));}catch{}}
    const unread=events.filter(e=>e.receivedAt>seen).length;
    const stale=!data.creditCheckedAt||Date.now()-data.creditCheckedAt>180000;
    const low=data.credit!==null&&data.credit<data.threshold;
    const credit=$('#smsCredit');
    credit.className='sms-credit'+(low?' sms-warning':'');
    credit.textContent=data.credit===null?'Kredit: nelze ověřit':`Kredit: ${money(data.credit)}${low?' · Doplňte kredit':''}${stale?' · údaj není aktuální':''}`;
    $('#smsCreditTime').textContent=`Kontrola kreditu: ${time(data.creditCheckedAt)}. Upozornění pod ${money(data.threshold)}.`;
    $('#smsBadge').textContent=unread?`${unread} nových oznámení`:'Oznámení';
    $('#smsBadge').classList.toggle('sms-warning',unread>0);
    const errors=[...(data.errors||[])];
    if(!events.some(e=>['locker-opened','locker-code-added','device-message'].includes(e.kind)))errors.push('Příjem odpovědí schránek není ověřen: aplikace zatím nemá žádnou zprávu od zařízení. Načtení kreditu ani zpráva od hosta nepotvrzují funkční příjem ze schránek.');
    if(!data.inboxCheckedAt||Date.now()-data.inboxCheckedAt>180000)errors.push('Příchozí zprávy a doručenky nejsou aktuálně ověřené.');
    $('#smsMonitorError').textContent=errors.join(' ');
    $('#smsSyncTime').textContent=`Poslední kontrola příchozích zpráv: ${time(data.inboxCheckedAt)}.`;
    let diagnostic=$('#smsApiDiagnostic');
    if(!diagnostic){diagnostic=el('p',null,'small muted');diagnostic.id='smsApiDiagnostic';$('#smsSyncTime').after(diagnostic);}
    const info=data.inboxInfo;
    diagnostic.textContent=info?`Poslední odpověď SMS Connect: ${info.messages??'—'} příchozích SMS, z toho ${info.deviceMessages??'—'} od schránek; ${info.receipts??'—'} doručenek. Velikost ${info.bytes??'—'} znaků. Sekce: ${(info.sections||[]).join(', ')||'prázdná odpověď'}.`:'Diagnostika SMS Connect zatím není dostupná.';
    $('#smsIncoming').replaceChildren();
    if(!events.length)$('#smsIncoming').append(el('p','SMSbrána zatím přes API nepředala žádné příchozí SMS. Zprávy viditelné v jejím portálu nemusí být dostupné také přes SMS Connect. Příjem oznámení ze schránek zatím není ověřen.','sms-monitor-error'));
    events.forEach(e=>{
      const item=el('article',null,'sms-event'+(e.receivedAt>seen?' sms-unread':''));
      item.append(el('strong',e.kind==='locker-code-added'?`Schránka ${e.lockerNo}: zařízení potvrdilo přidání kódu`:e.kind==='locker-opened'?`Schránka ${e.lockerNo}: otevření klávesnicí`:e.kind==='device-message'?'Zpráva od schránek':`Příchozí SMS · +${e.number}`));
      item.append(el('div',e.ts?time(e.ts):e.time||'Čas neuveden','small muted'));
      const detail=el('details');detail.append(el('summary','Zobrazit SMS'),el('p',e.message,'sms-message'));item.append(detail);
      $('#smsIncoming').append(item);
    });
    $('#smsOutgoing').replaceChildren();
    if(!data.outgoing?.length)$('#smsOutgoing').append(el('p','Doručenky se začnou zobrazovat u SMS odeslaných po této aktualizaci.','muted'));
    (data.outgoing||[]).forEach(e=>{
      const bad=e.state==='failed'||e.state==='unknown'||[3,5,6].includes(e.status);
      const item=el('article',null,'sms-event'+(bad?' sms-failed':''));
      const target=e.actionType?.startsWith('locker')?`Schránka ${e.lockerNo||''}`:e.guest||`+${e.number}`;
      item.append(el('strong',`${target} · ${e.statusLabel}`),el('div',`${time(e.ts)} · +${e.number}`,'small muted'));
      if(e.error)item.append(el('p',e.error));
      const details=el('details');details.append(el('summary','Podrobnosti'),el('p',e.message,'sms-message'),el('p',`ID SMS: ${e.smsId||'nepotvrzeno'} · Cena: ${e.price==null?'neznámá':money(e.price)} · Počet SMS: ${e.smsCount??'neznámý'}`));
      if(e.statusTime)details.append(el('p',`Doručenka: ${time(e.statusTime)}`));
      if(e.actionType?.startsWith('locker'))details.append(el('p','Doručení SMS nepotvrzuje provedení příkazu schránkou.'));
      item.append(details);$('#smsOutgoing').append(item);
    });
  }
  async function refresh(){
    if(!active||busy||document.hidden)return;
    busy=true;$('#smsRefresh').disabled=true;
    try{
      const r=await fetch('/api/sms-monitor',{credentials:'same-origin',cache:'no-store'});
      const result=await r.json();
      if(r.status===401){active=false;clearInterval(timer);$('#loginGate').classList.remove('hidden');throw new Error('Pro načtení oznámení se znovu přihlaste.');}
      if(!r.ok)throw new Error(result.error||'Oznámení se nepodařilo načíst.');
      data=result;render();
      if(typeof window.renderHistory==='function')window.renderHistory();
    }catch(e){$('#smsMonitorError').textContent=e.message;$('#smsCredit').textContent='Kredit: aktuální stav nelze ověřit';}
    finally{busy=false;$('#smsRefresh').disabled=false;}
  }
  window.startSmsMonitor=()=>{active=true;clearInterval(timer);refresh();timer=setInterval(refresh,60000);};
  window.refreshSmsMonitor=refresh;
  window.smsDeliveryText=id=>{
    const found=(data?.outgoing||[]).filter(a=>a.historyId===id);
    return found.length?found.map(a=>`${a.number}: ${a.statusLabel}`).join(' · '):null;
  };
  document.addEventListener('DOMContentLoaded',()=>{
    $('#smsRefresh').addEventListener('click',refresh);
    $('#smsMarkRead').addEventListener('click',markRead);
    $('#smsBadge').addEventListener('click',()=>{$('#smsDetails').open=true;$('#smsDetails').scrollIntoView({behavior:'smooth',block:'start'});});
  });
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.addEventListener('storage',e=>{if(e.key==='falconi_sms_seen'){seen=Number(e.newValue)||0;render();}});
})();
