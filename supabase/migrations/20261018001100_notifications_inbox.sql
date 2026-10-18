-- An inbox in the app, so nobody has to wait for a WhatsApp message that nothing sends yet.
--
-- notifications already had rows (a quote being ready, a document expiring) and a policy letting each person read
-- their own, but nothing showed them and almost nothing created them. Now the moments people wait for create one,
-- from triggers on the tables themselves, so no existing function has to change:
--   buyer:    order paid / scheduled / on the way / delivered / cancelled
--   supplier: a job is offered; a payout is paid
--   driver:   a trip is assigned; a payout is paid
-- A failing notification must never block a payment or a pickup, so every insert swallows its own errors.

alter table public.notifications add column if not exists read_at timestamptz;
create index if not exists notifications_unread_idx on public.notifications (profile_id) where read_at is null;

create or replace function public._notify(p_profile uuid, p_template text, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_profile is null then return; end if;
  insert into public.notifications (profile_id, template, language, channel, payload)
  select p.id, p_template, p.language, 'whatsapp', p_payload from public.profiles p where p.id = p_profile;
exception when others then
  null;
end $$;

create or replace function public._notify_job_offered() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'offered' then
    perform public._notify(new.supplier_id, 'job_offered', jsonb_build_object('allocation_id', new.id, 'quantity', new.quantity));
  end if;
  return new;
end $$;
create trigger allocations_notify_offered after insert on public.allocations
  for each row execute function public._notify_job_offered();

create or replace function public._notify_trip_assigned() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.driver_id is not null and new.driver_id is distinct from old.driver_id then
    perform public._notify(new.driver_id, 'trip_assigned', jsonb_build_object('trip_id', new.id));
  end if;
  return new;
end $$;
create trigger trips_notify_assigned after update of driver_id on public.trips
  for each row execute function public._notify_trip_assigned();

create or replace function public._notify_order_status() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status is distinct from old.status and new.status::text in ('paid', 'scheduled', 'on_the_way', 'delivered', 'cancelled') then
    perform public._notify(new.buyer_id, 'order_' || new.status::text,
      jsonb_build_object('order_id', new.id, 'order_number', new.number, 'delivery_date', new.delivery_date));
  end if;
  return new;
end $$;
create trigger orders_notify_status after update of status on public.orders
  for each row execute function public._notify_order_status();

create or replace function public._notify_payout_paid() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'success' and old.status is distinct from 'success' then
    perform public._notify(new.party_id, 'payout_paid', jsonb_build_object('transfer_id', new.id, 'amount_cents', new.amount_cents, 'party_type', new.party_type::text));
  end if;
  return new;
end $$;
create trigger transfers_notify_paid after update of status on public.transfers
  for each row execute function public._notify_payout_paid();

-- Opening the inbox marks everything as read.
create or replace function public.mark_notifications_read() returns void
language sql security definer set search_path = '' as $$
  update public.notifications set read_at = now() where profile_id = auth.uid() and read_at is null
$$;

revoke all on function public._notify(uuid, text, jsonb), public._notify_job_offered(), public._notify_trip_assigned(),
  public._notify_order_status(), public._notify_payout_paid() from public, anon, authenticated;
revoke all on function public.mark_notifications_read() from public, anon;
grant execute on function public.mark_notifications_read() to authenticated;
