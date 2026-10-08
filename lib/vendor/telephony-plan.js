export const RECEPTION = '+420735025000';
export const GUESTS = '+420735024000';
export const BACKUP = '+420602418879';
export const LEGACY = '+420721516894';
const clock = new Intl.DateTimeFormat('en-GB', {timeZone:'Europe/Prague',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
export function localTime(now=new Date()) {
 const p=Object.fromEntries(clock.formatToParts(now).map(x=>[x.type,x.value]));
 return {day:`${p.year}-${p.month}-${p.day}`,hour:Number(p.hour),minute:Number(p.minute)};
}
const addDay=(day,n)=>new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
export const DEFAULT_SCHEDULE=Object.freeze({open:'07:00',close:'22:15',handover:'07:00'});
export function validateSchedule(value=DEFAULT_SCHEDULE){
 const s={open:value?.open,close:value?.close,handover:value?.handover};
 if(![s.open,s.close,s.handover].every(t=>typeof t==='string'&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(t))||!s.handover.endsWith(':00'))throw Error('Vyplňte platné časy. Předání služby musí být v celou hodinu.');
 if(s.open===s.close)throw Error('Otevření a zavření musí mít různý čas.');
 return s;
}
// First occurrence during autumn DST; a missing spring hour hands over at 03:00.
function handoverOn(day,schedule){
 const h=Number(schedule.handover.slice(0,2)),wall=Date.parse(day+'T'+schedule.handover+':00Z');
 for(let i=-3;i<=3;i++){const instant=wall+i*3600000,t=localTime(new Date(instant));if(t.day===day&&t.hour>=h)return instant;}
 throw Error('Neplatný čas předání.');
}
export function dutyDay(now=new Date(),schedule=DEFAULT_SCHEDULE) { const t=localTime(now);return now.getTime()<handoverOn(t.day,schedule)?addDay(t.day,-1):t.day; }
export function nextHandover(now=new Date(),schedule=DEFAULT_SCHEDULE) {
 const day=localTime(now).day,today=handoverOn(day,schedule);
 return new Date(today>now.getTime()?today:handoverOn(addDay(day,1),schedule)).toISOString();
}
export function receptionOpen(now,schedule=DEFAULT_SCHEDULE){const t=localTime(now),m=t.hour*60+t.minute,minutes=s=>Number(s.slice(0,2))*60+Number(s.slice(3)),a=minutes(schedule.open),b=minutes(schedule.close);return a<b?m>=a&&m<b:m>=a||m<b;}

export function normalizePhone(value) {
 const s=String(value||'').replace(/[\s()-]/g,'').replace(/^00420/,'+420');
 const phone=/^[67]\d{8}$/.test(s)?'+420'+s:s;
 if(!/^\+420[67]\d{8}$/.test(phone))throw Error('Vyplňte české mobilní číslo včetně všech 9 číslic.');
 if([RECEPTION,GUESTS,LEGACY].includes(phone))throw Error('Veřejné ani původní recepční číslo nelze použít jako cíl. Předejdeme tím smyčce a zásahu do Hillside.');
 return phone;
}
export function validateDelay(value){if(!Number.isInteger(value)||value<5||value>60)throw Error('Doba vyzvánění musí být celé číslo od 5 do 60 sekund.');return value;}
export function planCall({now=new Date(),staff=[],published={},override=null,schedule=DEFAULT_SCHEDULE,backup=BACKUP,delay=20}) {
 const day=dutyDay(now,schedule),over=override&&Date.parse(override.expires_at)>now.getTime()?override:null;
 const id=over?.person_id||published[day],person=staff.find(p=>p.id===id&&p.active&&p.can_work!==false);
 backup=normalizePhone(backup);
 let fallback=true,target=backup,reason='Směna není obsazená; hovory přebírá záloha.';
 if(person){try{target=normalizePhone(person.phone);fallback=false;reason=over?'Dočasné zastoupení':'Schválený rozpis';}catch{reason='Recepční nemá použitelný telefon; hovory přebírá záloha.';}}
 return {duty_day:day,until:nextHandover(now,schedule),person_id:person?.id||null,name:fallback?'Záložní telefon':person?.name,target,reason,override:!!over,reception_open:receptionOpen(now,schedule),backup,delay_seconds:validateDelay(delay)};
}
