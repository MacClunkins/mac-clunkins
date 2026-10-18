-- A delivery can no longer report more birds than the driver collected, and a short load is written to the
-- audit log so an admin can see it. Supplier payouts are for the birds counted at pickup (price x count,
-- capped at the order), so a short pickup means a smaller payout; the buyer's refund for the shortfall is
-- handled as a case.

create or replace function public.driver_confirm_delivery(p_trip_id uuid, p_code text, p_count integer default null, p_photo_path text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.trips; a public.allocations; o public.orders;
begin
  if not public.is_active_role('driver') then raise exception 'drivers only' using errcode = '42501'; end if;
  select * into t from public.trips x where x.id = p_trip_id and x.driver_id = auth.uid() for update;
  if t.id is null then raise exception 'trip not found' using errcode = 'P0002'; end if;
  if t.status <> 'picked_up' then raise exception 'trip_not_in_transit' using errcode = 'P0001'; end if;
  select * into a from public.allocations x where x.id = t.allocation_id;
  select * into o from public.orders x where x.id = a.order_id for update;
  if o.delivery_code is null or p_code is distinct from o.delivery_code then raise exception 'invalid_delivery_code' using errcode = 'P0001'; end if;
  -- A driver cannot hand over more birds than were collected. (A pickup of 500 followed by a delivery
  -- of 1000 meant the order looked fully delivered while the supplier was paid for half.)
  if p_count is not null and p_count > coalesce(t.pickup_count, a.quantity) then
    raise exception 'delivered_more_than_collected' using errcode = '22023';
  end if;
  if t.pickup_count is not null and t.pickup_count < a.quantity then
    perform public.log_audit('order.short_load', 'orders', o.id::text, null,
      jsonb_build_object('ordered', a.quantity, 'collected', t.pickup_count, 'allocation_id', a.id));
  end if;
  update public.trips set status = 'delivered', delivered_at = now(),
         delivered_count = coalesce(p_count, t.pickup_count, a.quantity),
         pod_photo_path = coalesce(p_photo_path, pod_photo_path) where id = t.id;
  if not exists (select 1 from public.trips tt join public.allocations aa on aa.id = tt.allocation_id
                  where aa.order_id = o.id and tt.status <> 'delivered') then
    update public.orders set status = 'delivered' where id = o.id;
    perform public.log_order_event(o.id, 'delivered', 'Delivery code confirmed');
  end if;
  insert into public.transfers (party_id, party_type, trip_id, amount_cents)
  values (t.driver_id, 'driver', t.id, t.driver_share_cents) on conflict do nothing;
  perform public.log_audit('payout.queued', 'transfers', t.id::text, null,
    jsonb_build_object('party', 'driver', 'amount_cents', t.driver_share_cents, 'order_id', o.id));
  return jsonb_build_object('delivered', true, 'trip_id', t.id);
end $$;
