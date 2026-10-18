-- Evidence for every rand that moves outside the app.
--
--   * the buyer sends proof of payment (the EFT slip) for their order
--   * the admin records the bank's charge on that EFT and uploads the bank statement it came from
--   * the admin marks a supplier or driver payout as paid, with the bank reference, the bank's charge and the
--     proof of payment, and the supplier or driver can open that proof
-- Files live in a private bucket; a row says who uploaded what, and every action is written to audit_log.

do $storage$
begin
  if to_regclass('storage.objects') is not null then
    insert into storage.buckets (id, name, public) values ('payment-proofs', 'payment-proofs', false) on conflict (id) do nothing;
    drop policy if exists payment_proofs_buyer_insert on storage.objects;
    drop policy if exists payment_proofs_admin_insert on storage.objects;
    drop policy if exists payment_proofs_read on storage.objects;
    -- buyer/<buyer id>/...: a buyer can add and read their own slips
    execute $p$create policy payment_proofs_buyer_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = 'buyer'
                  and (storage.foldername(name))[2] = auth.uid()::text)$p$;
    -- payout/<transfer id>/... and statement/...: admins only
    execute $p$create policy payment_proofs_admin_insert on storage.objects for insert to authenticated
      with check (bucket_id = 'payment-proofs' and public.is_admin())$p$;
    -- reading: admins everything; a buyer their own slips; a supplier or driver the proof of their own payout
    execute $p$create policy payment_proofs_read on storage.objects for select to authenticated
      using (bucket_id = 'payment-proofs' and (
        public.is_admin()
        or ((storage.foldername(name))[1] = 'buyer' and (storage.foldername(name))[2] = auth.uid()::text)
        or ((storage.foldername(name))[1] = 'payout' and exists (
              select 1 from public.transfers t where t.id::text = (storage.foldername(name))[2] and t.party_id = auth.uid()))))$p$;
  end if;
end
$storage$;

create table public.payment_proofs (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references public.orders (id) on delete cascade,
  uploaded_by  uuid references public.profiles (id) on delete set null,
  file_path    text not null,
  note         text,
  created_at   timestamptz not null default now()
);
create index payment_proofs_order_id_idx on public.payment_proofs (order_id);
create index payment_proofs_uploaded_by_idx on public.payment_proofs (uploaded_by);

create table public.bank_statements (
  id           uuid primary key default gen_random_uuid(),
  uploaded_by  uuid references public.profiles (id) on delete set null,
  file_path    text not null,
  period_from  date,
  period_to    date,
  note         text,
  created_at   timestamptz not null default now()
);
create index bank_statements_uploaded_by_idx on public.bank_statements (uploaded_by);

create table public.transfer_proofs (
  id             uuid primary key default gen_random_uuid(),
  transfer_id    uuid not null references public.transfers (id) on delete cascade,
  uploaded_by    uuid references public.profiles (id) on delete set null,
  file_path      text not null,
  reference      text not null,
  bank_fee_cents integer check (bank_fee_cents >= 0),
  created_at     timestamptz not null default now()
);
create index transfer_proofs_transfer_id_idx on public.transfer_proofs (transfer_id);
create index transfer_proofs_uploaded_by_idx on public.transfer_proofs (uploaded_by);

alter table public.payment_proofs enable row level security;
alter table public.bank_statements enable row level security;
alter table public.transfer_proofs enable row level security;
revoke all on public.payment_proofs, public.bank_statements, public.transfer_proofs from public, anon, authenticated;
grant select on public.payment_proofs, public.bank_statements, public.transfer_proofs to authenticated;
create policy payment_proofs_admin_read on public.payment_proofs for select to authenticated using ((select public.is_admin()));
create policy payment_proofs_buyer_read on public.payment_proofs for select to authenticated using (uploaded_by = (select auth.uid()));
create policy bank_statements_admin_read on public.bank_statements for select to authenticated using ((select public.is_admin()));
create policy transfer_proofs_admin_read on public.transfer_proofs for select to authenticated using ((select public.is_admin()));
create policy transfer_proofs_party_read on public.transfer_proofs for select to authenticated
  using (exists (select 1 from public.transfers t where t.id = transfer_id and t.party_id = (select auth.uid())));

-- A buyer sends the slip for their order.
create or replace function public.submit_payment_proof(p_order_id uuid, p_file_path text, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_active_role('buyer') or not public.buyer_owns_order(p_order_id) then
    raise exception 'order not found' using errcode = 'P0002';
  end if;
  if p_file_path is null or p_file_path not like 'buyer/' || auth.uid()::text || '/%' then
    raise exception 'invalid file' using errcode = '22023';
  end if;
  if (select count(*) from public.payment_proofs x where x.order_id = p_order_id and x.uploaded_by = auth.uid()) >= 10 then
    raise exception 'too_many_proofs' using errcode = 'P0001';
  end if;
  insert into public.payment_proofs (order_id, uploaded_by, file_path, note)
  values (p_order_id, auth.uid(), p_file_path, nullif(btrim(coalesce(p_note, '')), '')) returning id into v_id;
  perform public.log_audit('payment.proof_submitted', 'orders', p_order_id::text, null, jsonb_build_object('proof_id', v_id));
  return v_id;
end $$;

-- The admin files a bank statement (any period) so every EFT fee and payout can be traced to a document.
create or replace function public.admin_add_bank_statement(p_file_path text, p_from date, p_to date, p_note text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_file_path is null or p_file_path not like 'statement/%' then raise exception 'invalid file' using errcode = '22023'; end if;
  if p_from is not null and p_to is not null and p_to < p_from then raise exception 'the period ends before it starts' using errcode = '22023'; end if;
  insert into public.bank_statements (uploaded_by, file_path, period_from, period_to, note)
  values (auth.uid(), p_file_path, p_from, p_to, nullif(btrim(coalesce(p_note, '')), '')) returning id into v_id;
  perform public.log_audit('bank_statement.added', 'bank_statements', v_id::text, null, jsonb_build_object('from', p_from, 'to', p_to));
  return v_id;
end $$;

-- The admin has paid a supplier or driver by EFT. The bank reference and the proof are required, so a payout is
-- never marked paid without something to show for it.
create or replace function public.admin_mark_transfer_paid(p_transfer_id uuid, p_reference text, p_bank_fee_cents integer, p_proof_path text)
returns void language plpgsql security definer set search_path = '' as $$
declare tr public.transfers; v_ref text := btrim(coalesce(p_reference, '')); v_order uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if char_length(v_ref) < 3 then raise exception 'enter the bank reference' using errcode = '22023'; end if;
  if p_bank_fee_cents is not null and p_bank_fee_cents < 0 then raise exception 'invalid_fee' using errcode = '22023'; end if;
  if p_proof_path is null or p_proof_path not like 'payout/' || p_transfer_id::text || '/%' then
    raise exception 'proof of payment is required' using errcode = '22023';
  end if;
  select * into tr from public.transfers x where x.id = p_transfer_id for update;
  if tr.id is null then raise exception 'payout not found' using errcode = 'P0002'; end if;
  if tr.status not in ('queued', 'sent', 'failed') then raise exception 'payout is already %', tr.status using errcode = 'P0001'; end if;
  update public.transfers set status = 'success', failure_reason = null, updated_at = now() where id = tr.id;
  insert into public.transfer_proofs (transfer_id, uploaded_by, file_path, reference, bank_fee_cents)
  values (tr.id, auth.uid(), p_proof_path, v_ref, p_bank_fee_cents);
  perform public.log_audit('payout.paid_manual', 'transfers', tr.id::text, jsonb_build_object('status', tr.status),
    jsonb_build_object('status', 'success', 'reference', v_ref, 'bank_fee_cents', p_bank_fee_cents, 'amount_cents', tr.amount_cents));

  -- same settling rule as a Paystack payout: delivered and every payout landed -> settled
  select a.order_id into v_order from public.allocations a
   where a.id = tr.allocation_id or a.id = (select t2.allocation_id from public.trips t2 where t2.id = tr.trip_id);
  if v_order is not null
     and exists (select 1 from public.orders o where o.id = v_order and o.status = 'delivered')
     and not exists (
       select 1 from public.allocations a2 where a2.order_id = v_order and not exists (
         select 1 from public.transfers x where x.allocation_id = a2.id and x.status = 'success'))
     and not exists (
       select 1 from public.trips t3 join public.allocations a3 on a3.id = t3.allocation_id
        where a3.order_id = v_order and not exists (
         select 1 from public.transfers x where x.trip_id = t3.id and x.status = 'success')) then
    update public.orders set status = 'settled' where id = v_order;
    perform public.log_order_event(v_order, 'settled', 'Order complete');
  end if;
end $$;

-- admin_mark_order_paid gains the bank fee (the old five-argument version is replaced).
drop function if exists public.admin_mark_order_paid(uuid, integer, text, text, text);

create or replace function public.admin_mark_order_paid(
  p_order_id uuid, p_amount_cents integer, p_method text, p_reference text default null, p_note text default null,
  p_bank_fee_cents integer default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o public.orders; v_ref text; v_res jsonb; v_doc uuid; v_inv jsonb; v_paid timestamptz;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_method not in ('eft', 'cash', 'card_machine', 'other') then raise exception 'invalid_method' using errcode = '22023'; end if;
  if p_bank_fee_cents is not null and p_bank_fee_cents < 0 then raise exception 'invalid_fee' using errcode = '22023'; end if;
  select * into o from public.orders where id = p_order_id for update;
  if o.id is null then raise exception 'order not found' using errcode = 'P0002'; end if;
  if o.status <> 'placed' then raise exception 'order_not_payable' using errcode = 'P0001'; end if;
  if p_amount_cents is distinct from o.total_cents then raise exception 'amount_mismatch' using errcode = '22023'; end if;
  v_ref := 'manual_' || lower(replace(o.number, '-', '')) || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  insert into public.payments (order_id, paystack_reference, amount_cents, status) values (o.id, v_ref, o.total_cents, 'pending');
  v_res := public.mark_order_paid(v_ref, o.total_cents, null, null);
  if v_res ->> 'result' <> 'paid' then raise exception 'could_not_mark_paid: %', v_res ->> 'result' using errcode = 'P0001'; end if;
  -- The bank's own charge for receiving this EFT, so the margin is worked out on what really arrived.
  if p_bank_fee_cents is not null then
    update public.payments set fee_cents = p_bank_fee_cents where paystack_reference = v_ref;
  end if;
  perform public.issue_order_invoice(o.id);
  select paid_at into v_paid from public.orders where id = o.id;
  select snapshot into v_inv from public.billing_documents where order_id = o.id and kind = 'invoice';
  insert into public.billing_documents (kind, number, order_id, quote_id, buyer_id, amount_cents, snapshot)
  values ('receipt', public.next_billing_number('receipt'), o.id, o.quote_id, o.buyer_id, o.total_cents,
    (v_inv - 'status') || jsonb_build_object(
      'title', 'Receipt', 'paid_at', v_paid, 'method', p_method, 'payment_reference', p_reference,
      'note', p_note, 'status', 'paid'))
  returning id into v_doc;
  update public.billing_documents set snapshot = snapshot || '{"status":"paid"}'::jsonb where order_id = o.id and kind = 'invoice';
  perform public.log_audit('payment.manual', 'orders', o.id::text, null,
    jsonb_build_object('method', p_method, 'reference', p_reference, 'amount_cents', o.total_cents, 'bank_fee_cents', p_bank_fee_cents));
  return jsonb_build_object('result', 'paid', 'order_id', o.id, 'receipt_id', v_doc);
end $$;

revoke all on function public.submit_payment_proof(uuid, text, text), public.admin_add_bank_statement(text, date, date, text),
  public.admin_mark_transfer_paid(uuid, text, integer, text),
  public.admin_mark_order_paid(uuid, integer, text, text, text, integer) from public, anon;
grant execute on function public.submit_payment_proof(uuid, text, text), public.admin_add_bank_statement(text, date, date, text),
  public.admin_mark_transfer_paid(uuid, text, integer, text),
  public.admin_mark_order_paid(uuid, integer, text, text, text, integer) to authenticated;
