-- Incremental performance fix for NEW sp-sales-crm after communication.sql.
-- No grants, policies, data writes, index removal or legacy changes.
begin;
create index sales_message_parent_fk on public.sales_message(inquiry_id,owner_id);
create index sales_hq_question_parent_fk on public.sales_hq_question(inquiry_id,owner_id);
create index sales_hq_review_question_fk on public.sales_hq_review(question_id,inquiry_id,owner_id,revision desc);
do $verify$
begin
 if position('(inquiry_id, owner_id)' in pg_get_indexdef('public.sales_message_parent_fk'::regclass))=0
 or position('(inquiry_id, owner_id)' in pg_get_indexdef('public.sales_hq_question_parent_fk'::regclass))=0
 or position('(question_id, inquiry_id, owner_id, revision DESC)' in pg_get_indexdef('public.sales_hq_review_question_fk'::regclass))=0 then raise exception 'Index coverage differs';end if;
end $verify$;
commit;
select 'communication_fk_indexes_verified' as result;
