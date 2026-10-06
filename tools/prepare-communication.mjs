// Prepare reviewable SQL only. No network, credentials or cloud writes.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const output='D:/AI/projects/sp-sales-crm/outputs/';
const hash=s=>createHash('sha256').update(s).digest('hex');
const schema=(await readFile('db/communication.sql','utf8')).replace(/begin;\s*/,'').replace(/commit;\s*$/,'');
const grants=(await readFile('db/enable-communication.sql','utf8')).replace(/begin;\s*/,'').replace(/commit;\s*$/,'');
const tests=await readFile('db/test-communication-body.sql','utf8');
const preflight=`do $preflight$ begin
 if to_regclass('public.sales_message') is not null or to_regclass('public.sales_hq_question') is not null or to_regclass('public.sales_hq_review') is not null then raise exception 'Communication already exists; do not repeat';end if;
 if not exists(select 1 from public.sales_access where user_id='a11803c8-01ef-4563-95bb-c0024541be2c' and enabled) or (select count(*) from public.sales_access where enabled)<>1 then raise exception 'Allowlist differs';end if;
 if exists(select 1 from public.sales_inquiry where status in ('waiting_for_hq','waiting_for_customer')) then raise exception 'Existing waiting inquiry requires migration review';end if;
end $preflight$;`;
const apply=`-- PENDING specific execution-time access confirmation, NEW glscckjmlwvxilzneqdf only.
-- Append-only original messages/questions/reviews, authenticated SELECT/INSERT + 3 invoker RPCs.
-- Existing enabled owner only; no anon, DELETE, history UPDATE, AI, email sending, plan or legacy changes.
-- Run rollback suite first. Apply ONCE after it passes. No actual business seed.
begin;\n${preflight}\n${schema}\n${grants}\ncommit;\nselect 'communication_enabled' as result;\n`;
const rollback=`begin;\n${preflight}\n${schema}\n${grants}\n${tests}\nrollback;\nselect 'communication_rollback_passed' as result;\n`;
await mkdir(output,{recursive:true});
await writeFile(output+'2026-10-07-communication-apply.sql',apply);
await writeFile(output+'2026-10-07-communication-rollback.sql',rollback);
await writeFile(output+'2026-10-07-communication-manifest.json',JSON.stringify({project:'glscckjmlwvxilzneqdf',not_applied:true,apply_sha256:hash(apply),rollback_sha256:hash(rollback),schema_sha256:hash(schema),tables:['sales_message','sales_hq_question','sales_hq_review'],permissions:'authenticated SELECT/INSERT, 3 invoker RPC EXECUTE; existing owner/allowlist RLS'},null,2));
console.log('Prepared communication application and rollback SQL. No cloud changes.');
