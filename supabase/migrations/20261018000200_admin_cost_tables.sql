-- Move the admin-only columns off the shared tables.
--
-- Until now quotes, allocations and trips carried columns that no client may read (the supplier a
-- quote was matched to, supplier distance, the full delivery fee) and kept them hidden with column
-- grants, then handed admins a route to them through three SECURITY DEFINER views. That route is
-- what the Supabase "Security Definer View" lint flags.
--
-- Now the sensitive columns live in three admin-only tables (quote_costs, allocation_costs,
-- trip_costs). The base tables no longer have them at all, and the admin_* views are plain
-- security_invoker views that join the base table to its cost table: the caller's own RLS applies,
-- so only an admin gets rows. Writers (SECURITY DEFINER functions) fill the cost tables.

create table public.quote_costs (
  quote_id             uuid primary key references public.quotes (id) on delete cascade,
  matched_supplier_id  uuid references public.profiles (id) on delete set null,
  distance_km          numeric(7,2),
  supplier_price_cents integer check (supplier_price_cents >= 0),
  breakdown            jsonb
);

create table public.allocation_costs (
  allocation_id uuid primary key references public.allocations (id) on delete cascade,
  distance_km   numeric(7,2)
);

create table public.trip_costs (
  trip_id            uuid primary key references public.trips (id) on delete cascade,
  delivery_fee_cents integer not null default 0 check (delivery_fee_cents >= 0)
);

insert into public.quote_costs (quote_id, matched_supplier_id, distance_km, supplier_price_cents, breakdown)
select id, matched_supplier_id, distance_km, supplier_price_cents, breakdown
  from public.quotes
 where matched_supplier_id is not null or distance_km is not null
    or supplier_price_cents is not null or breakdown is not null;

insert into public.allocation_costs (allocation_id, distance_km)
select id, distance_km from public.allocations where distance_km is not null;

insert into public.trip_costs (trip_id, delivery_fee_cents)
select id, delivery_fee_cents from public.trips;

-- Admin-only: RLS on, one read policy for admins, nobody can write through the API.
alter table public.quote_costs      enable row level security;
alter table public.allocation_costs enable row level security;
alter table public.trip_costs       enable row level security;
revoke all on public.quote_costs, public.allocation_costs, public.trip_costs from public, anon, authenticated;
grant select on public.quote_costs, public.allocation_costs, public.trip_costs to authenticated;
create policy quote_costs_admin_read      on public.quote_costs      for select to authenticated using (public.is_admin());
create policy allocation_costs_admin_read on public.allocation_costs for select to authenticated using (public.is_admin());
create policy trip_costs_admin_read       on public.trip_costs       for select to authenticated using (public.is_admin());

-- The views reference the old columns, so they go first.
drop view public.admin_quotes;
drop view public.admin_allocations;
drop view public.admin_trips;

alter table public.quotes      drop column matched_supplier_id, drop column distance_km,
                               drop column supplier_price_cents, drop column breakdown;
alter table public.allocations drop column distance_km;
alter table public.trips       drop column delivery_fee_cents;

-- security_invoker: the caller's privileges and RLS apply. The is_admin() guard is kept so a buyer
-- reading their own quote through this view still gets nothing.
create view public.admin_quotes with (security_invoker = true) as
select q.*, qc.matched_supplier_id, qc.distance_km, qc.supplier_price_cents, qc.breakdown
  from public.quotes q
  left join public.quote_costs qc on qc.quote_id = q.id
 where public.is_admin();

create view public.admin_allocations with (security_invoker = true) as
select a.*, ac.distance_km
  from public.allocations a
  left join public.allocation_costs ac on ac.allocation_id = a.id
 where public.is_admin();

create view public.admin_trips with (security_invoker = true) as
select t.*, tc.delivery_fee_cents
  from public.trips t
  left join public.trip_costs tc on tc.trip_id = t.id
 where public.is_admin();

revoke all on public.admin_quotes, public.admin_allocations, public.admin_trips from public, anon, authenticated;
grant select on public.admin_quotes, public.admin_allocations, public.admin_trips to authenticated;

-- Writers. Same bodies as before, except the sensitive values go to the cost tables.

create or replace function public.create_instant_quote(
  p_address_id uuid, p_bird_type public.bird_type, p_weight_band public.weight_band,
  p_quantity integer
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_buyer   uuid := public._assert_active_buyer();
  v_min     integer := public.app_setting('min_order')::integer;
  v_max_q   integer := public.app_setting('rfq_min_birds')::integer;
  v_max_km  numeric := public.app_setting('rfq_max_km');
  v_hold    numeric := public.app_setting('quote_hold_minutes');
  v_addr    public.addresses;
  v_plan    jsonb;
  v_bd      jsonb;
  v_id      uuid;
  v_week    date := date_trunc('week', current_date)::date;
  a         jsonb;
begin
  if p_quantity is null or p_quantity < v_min then
    raise exception 'minimum order is % birds', v_min using errcode = '22023';
  end if;
  select * into v_addr from public.addresses x where x.id = p_address_id and x.owner_id = v_buyer;
  if v_addr.id is null then
    raise exception 'address not found' using errcode = 'P0002';
  end if;

  if p_quantity > v_max_q or v_addr.location is null then
    return public.request_quote(p_address_id, p_bird_type, p_weight_band, p_quantity);
  end if;

  perform pg_advisory_xact_lock(hashtext('mc_stock_reserve'));   -- serialise stock reservation
  v_plan := public.plan_allocations(p_bird_type, p_weight_band, p_quantity, v_addr.location, v_addr.province);
  if v_plan is null then
    return public.request_quote(p_address_id, p_bird_type, p_weight_band, p_quantity);
  end if;
  v_bd := public.calculate_quote_breakdown(v_plan);
  if (v_bd ->> 'max_distance_km')::numeric > v_max_km then
    return public.request_quote(p_address_id, p_bird_type, p_weight_band, p_quantity);
  end if;

  insert into public.quotes (
    buyer_id, address_id, bird_type, weight_band, quantity,
    bird_price_cents, delivery_fee_cents, service_fee_cents, total_cents,
    kind, status, expires_at)
  values (
    v_buyer, p_address_id, p_bird_type, p_weight_band, p_quantity,
    (v_bd ->> 'bird_price_cents')::integer, (v_bd ->> 'delivery_fee_cents')::integer,
    (v_bd ->> 'service_fee_cents')::integer, (v_bd ->> 'total_cents')::integer,
    'instant', 'open', now() + make_interval(mins => v_hold::integer))
  returning id into v_id;

  insert into public.quote_costs (quote_id, matched_supplier_id, distance_km, supplier_price_cents, breakdown)
  values (v_id, (v_plan -> 0 ->> 'supplier_id')::uuid, (v_bd ->> 'max_distance_km')::numeric,
          (v_plan -> 0 ->> 'price_cents')::integer, v_bd);

  for a in select * from jsonb_array_elements(v_plan) loop
    insert into public.stock_reservations (quote_id, supplier_id, bird_type, week_start, quantity, expires_at)
    values (v_id, (a ->> 'supplier_id')::uuid, p_bird_type, v_week, (a ->> 'birds')::integer,
            now() + make_interval(mins => v_hold::integer));
  end loop;

  perform public.log_audit('quote.created', 'quotes', v_id::text, null,
    jsonb_build_object('kind', 'instant', 'total_cents', v_bd -> 'total_cents',
                       'settings', v_bd -> 'settings'));
  return public.quote_buyer_view(v_id);
end;
$$;

create or replace function public.admin_price_quote(p_quote_id uuid, p_allocations jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  q       public.quotes;
  v_loc   extensions.geography;
  v_hours numeric := public.app_setting('rfq_quote_hours', 24);
  v_alloc jsonb := '[]'::jsonb;
  a       jsonb;
  v_km    numeric;
  v_bd    jsonb;
  v_sum   integer := 0;
begin
  if not public.is_admin() then
    raise exception 'only an admin can price a quote' using errcode = '42501';
  end if;
  select * into q from public.quotes x where x.id = p_quote_id for update;
  if q.id is null then raise exception 'quote not found' using errcode = 'P0002'; end if;
  if q.status <> 'open' then raise exception 'quote is %', q.status using errcode = 'P0001'; end if;
  select ad.location into v_loc from public.addresses ad where ad.id = q.address_id;

  for a in select * from jsonb_array_elements(p_allocations) loop
    v_km := (a ->> 'distance_km')::numeric;
    if v_km is null then
      select round(extensions.st_distance(sd.location, v_loc)::numeric / 1000
                   * public.app_setting('road_distance_factor', 1), 2)
        into v_km from public.supplier_details sd where sd.profile_id = (a ->> 'supplier_id')::uuid;
    end if;
    v_sum := v_sum + (a ->> 'birds')::integer;
    v_alloc := v_alloc || jsonb_build_array(jsonb_set(a, '{distance_km}', to_jsonb(coalesce(v_km, 0))));
  end loop;
  if v_sum <> q.quantity then
    raise exception 'allocations cover % birds, quote is for %', v_sum, q.quantity using errcode = '22023';
  end if;

  v_bd := public.calculate_quote_breakdown(v_alloc);
  insert into public.quote_costs (quote_id, matched_supplier_id, distance_km, supplier_price_cents, breakdown)
  values (p_quote_id, (v_alloc -> 0 ->> 'supplier_id')::uuid, (v_bd ->> 'max_distance_km')::numeric,
          (v_alloc -> 0 ->> 'price_cents')::integer, v_bd)
  on conflict (quote_id) do update set
    matched_supplier_id = excluded.matched_supplier_id, distance_km = excluded.distance_km,
    supplier_price_cents = excluded.supplier_price_cents, breakdown = excluded.breakdown;
  update public.quotes set
    bird_price_cents     = (v_bd ->> 'bird_price_cents')::integer,
    delivery_fee_cents   = (v_bd ->> 'delivery_fee_cents')::integer,
    service_fee_cents    = (v_bd ->> 'service_fee_cents')::integer,
    total_cents          = (v_bd ->> 'total_cents')::integer,
    expires_at           = now() + make_interval(hours => v_hours::integer)
  where id = p_quote_id;

  perform public.log_audit('quote.priced', 'quotes', p_quote_id::text, null,
    jsonb_build_object('total_cents', v_bd -> 'total_cents', 'settings', v_bd -> 'settings'));
  return public.quote_buyer_view(p_quote_id);
end;
$$;

create or replace function public.mark_order_paid(
  p_reference text, p_amount_cents integer, p_channel text default null, p_fee_cents integer default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_breakdown jsonb; v_trip_id uuid;
  pay  public.payments;
  o    public.orders;
  q    public.quotes;
  r    record;
  a    jsonb;
  v_alloc_id uuid;
  v_buyer_prov text;
  v_sup_prov text;
  v_week date := date_trunc('week', current_date)::date;
  v_bytes bytea;
  v_code text;
begin
  select * into pay from public.payments x where x.paystack_reference = p_reference for update;
  if pay.id is null then
    raise exception 'unknown_reference' using errcode = 'P0002';
  end if;
  select * into o from public.orders x where x.id = pay.order_id for update;

  if pay.status = 'succeeded' then
    return jsonb_build_object('result', 'already_paid', 'order_id', o.id);
  end if;

  if p_amount_cents is distinct from pay.amount_cents or p_amount_cents <> o.total_cents then
    update public.payments set status = 'failed' where id = pay.id;
    perform public.log_audit('payment.amount_mismatch', 'payments', pay.id::text, null,
      jsonb_build_object('expected_cents', pay.amount_cents, 'received_cents', p_amount_cents));
    return jsonb_build_object('result', 'amount_mismatch', 'order_id', o.id);
  end if;

  -- Money arrived for an order we already cancelled (24h unpaid): keep the money record,
  -- queue a full refund, never revive the order.
  if o.status <> 'placed' then
    update public.payments set status = 'succeeded', channel = public.map_paystack_channel(p_channel),
           fee_cents = p_fee_cents where id = pay.id;
    insert into public.refunds (order_id, amount_cents, status) values (o.id, pay.amount_cents, 'pending');
    perform public.log_audit('payment.received_for_closed_order', 'payments', pay.id::text, null,
      jsonb_build_object('order_status', o.status, 'amount_cents', pay.amount_cents, 'refund_queued', true));
    return jsonb_build_object('result', 'paid_after_close_refund_queued', 'order_id', o.id);
  end if;

  v_bytes := extensions.gen_random_bytes(2);
  v_code := lpad(((get_byte(v_bytes, 0) * 256 + get_byte(v_bytes, 1)) % 10000)::text, 4, '0');

  update public.payments set status = 'succeeded', channel = public.map_paystack_channel(p_channel),
         fee_cents = p_fee_cents where id = pay.id;
  update public.orders set status = 'paid', paid_at = now(), delivery_code = v_code where id = o.id;

  -- Reserved stock becomes sold stock.
  for r in select * from public.stock_reservations
            where order_id = o.id and status = 'held' for update loop
    update public.stock set birds_available = greatest(birds_available - r.quantity, 0)
     where supplier_id = r.supplier_id and week_start = r.week_start and bird_type = r.bird_type;
    update public.stock_reservations set status = 'committed' where id = r.id;
  end loop;

  -- Supplier slices and their trips come from the quote's stored allocation plan.
  select * into q from public.quotes x where x.id = o.quote_id;
  select qc.breakdown into v_breakdown from public.quote_costs qc where qc.quote_id = o.quote_id;
  select ad.province into v_buyer_prov from public.addresses ad where ad.id = o.address_id;
  if v_breakdown is not null then
    for a in select * from jsonb_array_elements(v_breakdown -> 'allocations') loop
      select sd.province into v_sup_prov from public.supplier_details sd
       where sd.profile_id = (a ->> 'supplier_id')::uuid;
      insert into public.allocations (order_id, supplier_id, quantity, supplier_price_cents,
                                      status, crosses_province)
      values (o.id, (a ->> 'supplier_id')::uuid, (a ->> 'birds')::integer,
              (a ->> 'supplier_price_cents')::integer, 'offered',
              v_buyer_prov is not null and v_sup_prov is not null and v_buyer_prov <> v_sup_prov)
      returning id into v_alloc_id;
      insert into public.allocation_costs (allocation_id, distance_km)
      values (v_alloc_id, (a ->> 'distance_km')::numeric);
      insert into public.trips (allocation_id, driver_share_cents)
      values (v_alloc_id, (a ->> 'driver_share_cents')::integer)
      returning id into v_trip_id;
      insert into public.trip_costs (trip_id, delivery_fee_cents)
      values (v_trip_id, (a ->> 'delivery_fee_cents')::integer);
      if not exists (select 1 from public.stock_reservations sr where sr.order_id = o.id) then
        -- Requested (admin-priced) quotes reserve nothing up front; take the stock now.
        update public.stock set birds_available = greatest(birds_available - (a ->> 'birds')::integer, 0)
         where supplier_id = (a ->> 'supplier_id')::uuid and week_start = v_week and bird_type = o.bird_type;
      end if;
    end loop;
  else
    perform public.log_audit('order.paid_without_plan', 'orders', o.id::text, null, null);
  end if;

  perform public.log_order_event(o.id, 'paid', 'Paystack webhook confirmed');
  perform public.log_audit('order.paid', 'orders', o.id::text,
    jsonb_build_object('status', 'placed'),
    jsonb_build_object('status', 'paid', 'amount_cents', pay.amount_cents, 'reference', p_reference));
  return jsonb_build_object('result', 'paid', 'order_id', o.id, 'number', o.number);
end;
$$;

create or replace function public.admin_assign_supplier(p_order_id uuid, p_supplier_id uuid, p_quantity integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  o public.orders; ad public.addresses; m record; v_alloc uuid; v_assigned integer;
  v_fee integer; v_share integer; v_sup_prov text; v_trip uuid;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into o from public.orders x where x.id = p_order_id for update;
  if o.id is null or o.status not in ('paid', 'scheduled') then raise exception 'order_not_assignable' using errcode = 'P0001'; end if;
  select coalesce(sum(quantity), 0) into v_assigned from public.allocations where order_id = o.id and status <> 'declined';
  if p_quantity <= 0 or v_assigned + p_quantity > o.quantity then raise exception 'invalid_quantity' using errcode = '22023'; end if;
  select * into ad from public.addresses x where x.id = o.address_id;
  select * into m from public.match_suppliers(o.id) x where x.supplier_id = p_supplier_id;
  if m.supplier_id is null or m.paused then raise exception 'supplier_unavailable' using errcode = 'P0001'; end if;
  select province into v_sup_prov from public.supplier_details where profile_id = p_supplier_id;
  v_fee := o.delivery_fee_cents * p_quantity / greatest(o.quantity, 1);
  v_share := v_fee * public.app_setting('driver_share_pct', 70)::integer / 100;
  insert into public.allocations (order_id, supplier_id, quantity, supplier_price_cents, status, crosses_province)
  values (o.id, p_supplier_id, p_quantity, m.price_cents, 'offered', v_sup_prov is distinct from ad.province)
  returning id into v_alloc;
  insert into public.allocation_costs (allocation_id, distance_km) values (v_alloc, m.distance_km);
  insert into public.trips (allocation_id, driver_share_cents) values (v_alloc, v_share) returning id into v_trip;
  insert into public.trip_costs (trip_id, delivery_fee_cents) values (v_trip, v_fee);
  perform public.log_audit('allocation.assigned', 'allocations', v_alloc::text, null,
    jsonb_build_object('order_id', o.id, 'supplier_id', p_supplier_id, 'quantity', p_quantity));
  return v_alloc;
end $$;

create or replace function public.admin_rematch(p_order_id uuid, p_new_supplier_id uuid, p_expected_outcome text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  o public.orders; a public.allocations; m record; v_old bigint; v_new bigint; v_drivers bigint; v_outcome text;
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into o from public.orders x where x.id = p_order_id for update;
  select * into a from public.allocations x where x.order_id = o.id and x.status in ('offered', 'declined', 'accepted', 'ready') order by created_at limit 1 for update;
  if a.id is null then raise exception 'nothing to rematch' using errcode = 'P0001'; end if;
  select * into m from public.match_suppliers(o.id) x where x.supplier_id = p_new_supplier_id;
  if m.supplier_id is null or m.paused then raise exception 'supplier_unavailable' using errcode = 'P0001'; end if;
  v_old := a.supplier_price_cents::bigint * a.quantity;
  v_new := m.price_cents::bigint * a.quantity;
  select coalesce(sum(driver_share_cents), 0) into v_drivers from public.trips where allocation_id = a.id;
  v_outcome := case when v_new < v_old then 'cheaper_keep_price'
                    when o.total_cents - v_new - v_drivers >= 0 then 'absorb' else 'full_refund' end;
  if v_outcome is distinct from p_expected_outcome then raise exception 'outcome_changed:%', v_outcome using errcode = 'P0001'; end if;
  if v_outcome = 'full_refund' then
    perform public.admin_queue_refund(o.id, o.total_cents, null);
    update public.allocations set status = 'declined' where id = a.id;
  else
    update public.allocations set supplier_id = p_new_supplier_id, supplier_price_cents = m.price_cents,
           status = 'offered' where id = a.id;
    insert into public.allocation_costs (allocation_id, distance_km) values (a.id, m.distance_km)
    on conflict (allocation_id) do update set distance_km = excluded.distance_km;
  end if;
  perform public.log_audit('order.rematched', 'orders', o.id::text, jsonb_build_object('supplier_id', a.supplier_id),
    jsonb_build_object('supplier_id', p_new_supplier_id, 'outcome', v_outcome));
end $$;
