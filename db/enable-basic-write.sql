-- NEW sp-sales-crm only. Existing allowlist + owner RLS remain authoritative.
begin;
grant insert,update on public.sales_customer,public.sales_contact,public.sales_project,public.sales_inquiry,public.sales_action to authenticated;
grant execute on function public.sales_register_inquiry(jsonb),public.sales_add_action(uuid,jsonb),public.sales_edit_action(uuid,jsonb),
  public.sales_edit_inquiry(uuid,jsonb),public.sales_close_inquiry(uuid,jsonb),public.sales_edit_party(jsonb) to authenticated;
-- No DELETE, allowlist writes, anon grants, service role, or new users.
notify pgrst,'reload schema';
commit;
select 'basic_write_enabled' as result;
