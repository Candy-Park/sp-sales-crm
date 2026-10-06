import {readFile,writeFile,mkdir} from 'node:fs/promises';
const output='D:/AI/projects/sp-sales-crm/outputs/';
await mkdir(output,{recursive:true});
const rules=await readFile('db/basic-work-write.sql','utf8');
const grants=await readFile('db/enable-basic-write.sql','utf8');
const tests=await readFile('db/test-basic-write-body.sql','utf8');
const post=await readFile('db/verify-basic-write.sql','utf8');
const unwrap=sql=>sql.replace(/^begin;\s*$/gm,'').replace(/^commit;\s*$/gm,'').replace(/^select 'basic_write_enabled' as result;\s*$/gm,'');
const guard=`do $guard$ begin
if not exists(select 1 from public.sales_access where user_id='a11803c8-01ef-4563-95bb-c0024541be2c' and enabled) then raise exception 'Expected allowed user missing';end if;
if exists(select 1 from public.sales_inquiry where status='closed') then raise exception 'Closed rows need migration review';end if;
end $guard$;`;
const check=`do $post$ begin
if exists(select 1 from information_schema.columns where table_schema='public' and table_name='sales_inquiry' and column_name='resolved_confirmed') then raise exception 'Rollback left schema change';end if;
if exists(select 1 from public.sales_customer where name like 'SYNTHETIC%') then raise exception 'Rollback left fixtures';end if;
if has_table_privilege('authenticated','public.sales_inquiry','INSERT') then raise exception 'Rollback left write privilege';end if;
end $post$;`;
await writeFile(output+'2026-10-06-basic-write-rollback.sql',`begin;\n${guard}\n${unwrap(rules)}\n${unwrap(grants)}\n${post}\n${tests}\nrollback;\n${check}\nselect 'basic_write_rollback_tests_passed' as result;\n`);
await writeFile(output+'2026-10-06-basic-write-apply.sql',`begin;\n${guard}\n${unwrap(rules)}\n${unwrap(grants)}\ncommit;\nselect 'basic_write_enabled' as result;\n`);
console.log('Prepared isolated rollback validation and application SQL in D outputs.');
