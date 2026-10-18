-- Pricing a requested quote now sends it back to the buyer: the quote document is issued (so there is a
-- PDF to open) and a 'quote_ready' notification is queued. Before this, an admin could price a quote and
-- the buyer was never told and had nothing to open.

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

  -- Send the price back to the buyer. A re-price replaces the earlier quote document (a quote is
  -- never accepted until the buyer places an order, so nothing refers to the old one).
  delete from public.billing_documents where quote_id = p_quote_id and kind = 'quote' and order_id is null;
  perform public.issue_quote_document(p_quote_id);
  insert into public.notifications (profile_id, template, language, channel, payload)
  select q.buyer_id, 'quote_ready', p.language, 'whatsapp',
         jsonb_build_object('quote_id', p_quote_id, 'total_cents', v_bd -> 'total_cents')
    from public.profiles p where p.id = q.buyer_id;

  return public.quote_buyer_view(p_quote_id);
end;
$$;
