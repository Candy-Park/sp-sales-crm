-- Apply separately after communication rollback tests and execution-time access confirmation.
-- NEW glscckjmlwvxilzneqdf only; existing allowlist and owner RLS remain in force.
grant select,insert on public.sales_message,public.sales_hq_question,public.sales_hq_review to authenticated;
grant execute on function public.sales_record_message(uuid,jsonb),public.sales_add_hq_question(uuid,jsonb),public.sales_review_hq_question(uuid,jsonb) to authenticated;
