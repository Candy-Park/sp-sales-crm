-- Run inside BEGIN after reviewed schema/seed/grants, always ROLLBACK.
insert into auth.users(id) values('00000000-0000-4000-8000-000000000079');
insert into public.sales_product(id,owner_id,batch_id,pn,spec,source_sha256,reviewed_on)
 values('00000000-0000-4000-8000-000000000078','00000000-0000-4000-8000-000000000079','00000000-0000-4000-8000-000000000078','SYNTHETIC-FOREIGN','{"pn":"SYNTHETIC-FOREIGN"}',repeat('a',64),current_date);
set local role authenticated;
select set_config('request.jwt.claim.sub','a11803c8-01ef-4563-95bb-c0024541be2c',true);
select set_config('request.jwt.claims','{"sub":"a11803c8-01ef-4563-95bb-c0024541be2c","role":"authenticated"}',true);
do $tests$
declare iid uuid:='00000000-0000-4000-8000-000000000076';rid uuid:='00000000-0000-4000-8000-000000000075';
 d jsonb:='{"id":"00000000-0000-4000-8000-000000000075","product_id":"42000000-0000-4000-8000-000000000001","disposition":"selected","reason":"SYNTHETIC source-backed choice"}';
begin
 if (select count(*) from public.sales_product)<>2 then raise exception 'Owner catalogue isolation';end if;
 begin update public.sales_product set enabled=false;raise exception 'Catalogue client update allowed';exception when insufficient_privilege then null;end;
 perform public.sales_register_inquiry(jsonb_build_object('id',iid,'customer_name','SYNTHETIC product test','title','SYNTHETIC product inquiry','channel','manual','received_at','2026-10-07T00:00:00+09:00','original_text','SYNTHETIC immutable source'));
 if public.sales_link_product(iid,d)<>rid or public.sales_link_product(iid,d)<>rid then raise exception 'Retry failed';end if;
 if (select count(*) from public.sales_inquiry_product where inquiry_id=iid)<>1 then raise exception 'Duplicate review on retry';end if;
 if not exists(select 1 from public.sales_inquiry_product where id=rid and snapshot->'spec'->>'pn'='SPQ-CE-4LQ-CB' and length(snapshot->>'source_sha256')=64 and snapshot->'spec'->'source'->>'latest_revision_verified'='false') then raise exception 'Source snapshot lost';end if;
 begin perform public.sales_link_product(iid,d||'{"reason":"changed"}');raise exception 'Changed retry accepted';exception when serialization_failure then null;end;
 begin perform public.sales_link_product(iid,d-'product_id');raise exception 'Incomplete retry accepted';exception when serialization_failure then null;end;
 begin perform public.sales_link_product(iid,d||jsonb_build_object('id',gen_random_uuid(),'product_id','00000000-0000-4000-8000-000000000078'));raise exception 'Foreign product linked';exception when insufficient_privilege then null;end;
 begin perform public.sales_link_product(iid,d||jsonb_build_object('id',gen_random_uuid(),'reason',' '));raise exception 'Empty evidence accepted';exception when check_violation then null;end;
 begin perform public.sales_link_product(iid,d||'{"snapshot":"forged"}');raise exception 'Client snapshot allowed';exception when check_violation then null;end;
 begin update public.sales_inquiry_product set reason='changed' where id=rid;raise exception 'Review mutable';exception when insufficient_privilege then null;end;
 begin delete from public.sales_inquiry_product where id=rid;raise exception 'Review deletion allowed';exception when insufficient_privilege then null;end;
 perform public.sales_close_inquiry(iid,'{"revision":1,"resolved":true}');
 if public.sales_link_product(iid,d)<>rid then raise exception 'Closed retry lost receipt';end if;
 begin perform public.sales_link_product(iid,d||jsonb_build_object('id',gen_random_uuid()));raise exception 'Closed review added';exception when check_violation then null;end;
 if (select original_text from public.sales_inquiry where id=iid)<>'SYNTHETIC immutable source' then raise exception 'Source changed';end if;
end $tests$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000079',true);
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000079","role":"authenticated"}',true);
set local role authenticated;
do $denied$
begin
 if exists(select 1 from public.sales_product) or exists(select 1 from public.sales_inquiry_product) then raise exception 'Unapproved account read';end if;
 begin perform public.sales_link_product('00000000-0000-4000-8000-000000000076','{}');raise exception 'Unapproved write';exception when insufficient_privilege then null;end;
end $denied$;
reset role;
set local role anon;
do $anon$
begin
 begin perform 1 from public.sales_product;raise exception 'Anon read';exception when insufficient_privilege then null;end;
 begin perform public.sales_link_product('00000000-0000-4000-8000-000000000076','{}');raise exception 'Anon execute';exception when insufficient_privilege then null;end;
end $anon$;
reset role;
