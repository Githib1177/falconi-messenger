import {resolveDuty} from './decision.js';
import {dutyDay} from '../vendor/telephony-plan.js';

// Inject two independent SELECT-only SQL clients. No owner connection is accepted.
export async function assertReadonly(sql,schema) {
  const [role]=await sql`select rolsuper or rolcreaterole or rolcreatedb or rolbypassrls as privileged from pg_roles where rolname=current_user`;
  const [writes]=await sql`select exists(select 1 from information_schema.tables where table_schema=${schema} and (has_table_privilege(current_user,quote_ident(table_schema)||'.'||quote_ident(table_name),'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') or has_schema_privilege(current_user,${schema},'CREATE'))) as writable`;
  const [functions]=await sql`select exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=${schema} and p.prosecdef and has_function_privilege(current_user,p.oid,'EXECUTE')) as executable`;
  if(!role||role.privileged||writes?.writable!==false||functions?.executable!==false)throw Error('SELECT-only database role required');
}
export async function readDuty({phoneSql,shiftsSql,nightAiEnabled=false,now=new Date()}) {
  await assertReadonly(phoneSql,'falconi_phone');
  const [config]=await phoneSql`select enabled,night_ai_enabled,schedule,backup_phone,backup_delay_seconds,override_person,override_until,revision from falconi_phone.telephony where id`;
  if(!config)throw Error('Missing phone configuration');
  if(config.enabled!==true||config.night_ai_enabled!==true||nightAiEnabled!==true)return {config,night_ai_enabled:false,staff:[],published:{}};
  await assertReadonly(shiftsSql,'falconi_shifts');
  const team=await shiftsSql`select id,name,active,can_work from falconi_shifts.staff where active and can_work`;
  const contacts=await phoneSql`select person_id,phone from falconi_phone.telephony_contacts`;
  const phones=new Map(contacts.map(c=>[c.person_id,c.phone]));
  const month=dutyDay(now,config.schedule).slice(0,7);
  const [row]=await shiftsSql`select published_assignments from falconi_shifts.months where month=${month}`;
  const snapshot={config,night_ai_enabled:true,staff:team.map(p=>({...p,phone:phones.get(p.id)||''})),published:row?.published_assignments||{}};
  resolveDuty(snapshot,now);
  return snapshot;
}
