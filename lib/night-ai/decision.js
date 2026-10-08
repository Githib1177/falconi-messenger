import {planCall, normalizePhone, validateSchedule} from '../vendor/telephony-plan.js';

const actions = ['clarify', 'transfer', 'take_message', 'emergency'];
const urgencies = ['low', 'medium', 'high', 'critical'];
export function decision(value, count = 0) {
  if (!value || !actions.includes(value.action) || !urgencies.includes(value.urgency) ||
      !['reply', 'question', 'reason', 'summary'].every(k => typeof value[k] === 'string' && value[k].length <= 1800)) {
    return {action:'transfer', urgency:'high', reply:'Pokusím se vás spojit s recepční.', question:'', reason:'Vyhodnocení není dostupné.', summary:'Důvod hovoru nebyl spolehlivě vyhodnocen.'};
  }
  const result = Object.fromEntries(['action','urgency','reply','question','reason','summary'].map(k=>[k,value[k]]));
  if (result.action === 'emergency' || result.urgency === 'critical') {
    result.action = 'emergency'; result.urgency = 'critical';
  } else if (result.action === 'clarify' && (!Number.isInteger(count) || count < 0 || count >= 2 || !result.question.trim())) {
    result.action = 'transfer'; result.reply = 'Pokusím se vás spojit s recepční.';
  }
  if (result.action !== 'clarify') result.question = '';
  return result;
}

// Only trusted configuration can choose recipients; model output never supplies them.
export function resolveDuty(snapshot, now) {
  validateSchedule(snapshot.config.schedule);
  return planCall({now, staff:snapshot.staff, published:snapshot.published,
    schedule:snapshot.config.schedule, backup:snapshot.config.backup_phone,
    delay:snapshot.config.backup_delay_seconds,
    override:snapshot.config.override_person ? {person_id:snapshot.config.override_person, expires_at:snapshot.config.override_until} : null});
}
export function recipients(plan) {return [...new Set([plan.target, plan.backup].map(normalizePhone))];}
export function permitted(snapshot, now) {
  return enabled(snapshot) && !resolveDuty(snapshot, now).reception_open;
}
export function enabled(snapshot) {return snapshot.config.enabled === true && snapshot.night_ai_enabled === true;}

export function summaryText({call, result, outcome}) {
  const time = new Intl.DateTimeFormat('cs-CZ',{timeZone:'Europe/Prague',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(call.started_at));
  const callback = /^\+[1-9]\d{7,14}$/.test(call.caller || '') ? call.caller : 'skryté / nedostupné';
  // All free text is treated as a summary, never as instructions to a gateway.
  const body = (result.summary || result.reason || 'Důvod není znám.').replace(/[\r\n\t]+/g,' ').slice(0,360);
  return `FALCONI | AI shrnutí | ${time} | ${result.urgency === 'critical' ? 'KRITICKÉ' : result.urgency === 'high' ? 'NALÉHAVÉ' : 'Vzkaz'}. ${body} Kontakt z hovoru (neověřený): ${callback}. ${outcome}`;
}
