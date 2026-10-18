-- Stop people editing the parts of their own record that only McCluckin's may decide.
--
-- supplier_details and driver_details were open for INSERT and UPDATE on every column, so any signed-in supplier or
-- driver could, from the browser:
--   * clear their own pause after an admin paused them (paused, paused_reason)
--   * clear the bird-flu zone that blocks them (avian_flu_zone) or raise their rating (rating_avg)
--   * point their payouts at another Paystack recipient or write their own encrypted bank blob
--     (paystack_recipient_code, bank_details_encrypted)
-- documents was open for INSERT on every column, so a supplier could add a document already marked 'approved'
-- and skip compliance review; and replacing a document could not work at all, because the app also sends the new
-- status, which the UPDATE grant (correctly) excludes.
--
-- Now each person can write only the columns the app lets them edit, and documents are added or replaced through
-- submit_document, which always sets the status to 'uploaded' so an admin reviews it again.
-- Functions that run as the owner (set_profile_status, ratings, save_bank_details) and the service role are
-- unaffected.

revoke insert, update on public.supplier_details from authenticated;
grant insert (profile_id, farm_name, pickup_address, province, location, pdma_number),
      update (profile_id, farm_name, pickup_address, province, location, pdma_number)
  on public.supplier_details to authenticated;

revoke insert, update on public.driver_details from authenticated;
grant insert (profile_id, vehicle_type, vehicle_reg, gvm_kg, covered, ventilated, crates_owned, capacity_birds,
              licence_code, prdp, operator_card, insurance),
      update (profile_id, vehicle_type, vehicle_reg, gvm_kg, covered, ventilated, crates_owned, capacity_birds,
              licence_code, prdp, operator_card, insurance)
  on public.driver_details to authenticated;

revoke insert, update on public.documents from authenticated;

create or replace function public.submit_document(p_kind text, p_file_path text, p_expires_on date default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_role text; v_kind public.document_kind; v_id uuid;
begin
  select p.role::text into v_role from public.profiles p where p.id = auth.uid();
  if v_role is null or v_role not in ('supplier', 'driver') then
    raise exception 'suppliers and drivers only' using errcode = '42501';
  end if;
  v_kind := p_kind::public.document_kind;
  -- the file must be one this person uploaded (uploads go under their own id)
  if p_file_path is null or p_file_path not like auth.uid()::text || '/%' then
    raise exception 'invalid file' using errcode = '22023';
  end if;
  select d.id into v_id from public.documents d
   where d.profile_id = auth.uid() and d.kind = v_kind order by d.created_at desc limit 1 for update;
  if v_id is null then
    insert into public.documents (profile_id, kind, file_path, status, expires_on)
    values (auth.uid(), v_kind, p_file_path, 'uploaded', p_expires_on) returning id into v_id;
  else
    update public.documents
       set file_path = p_file_path, expires_on = p_expires_on, status = 'uploaded',
           notes = null, reviewed_by = null, reviewed_at = null, updated_at = now()
     where id = v_id;
  end if;
  perform public.log_audit('document.submitted', 'documents', v_id::text, null,
    jsonb_build_object('kind', p_kind, 'expires_on', p_expires_on));
  return v_id;
end $$;

revoke all on function public.submit_document(text, text, date) from public, anon;
grant execute on function public.submit_document(text, text, date) to authenticated;
