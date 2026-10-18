-- Why a supplier is, or is not, a candidate for a quote.
--
-- admin_match_preview only returns suppliers that pass every matching rule, so when none do the admin
-- sees an empty list with no hint why. This returns every supplier with the reasons they were left
-- out (reason codes the admin screen turns into plain sentences). Admin only.
--
-- Reason codes: not_active, paused, no_location, no_price, flu_zone, docs, stock, no_driver.

create or replace function public.admin_quote_candidates(p_quote_id uuid)
returns table (
  supplier_id     uuid,
  eligible        boolean,
  reasons         text[],
  price_cents     integer,
  distance_km     numeric,
  same_province   boolean,
  stock_available integer,
  rating_avg      numeric,
  rank            integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  q      public.quotes;
  ad     public.addresses;
  v_week date := date_trunc('week', current_date)::date;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into q from public.quotes x where x.id = p_quote_id;
  if q.id is null then
    raise exception 'quote not found' using errcode = 'P0002';
  end if;
  select * into ad from public.addresses x where x.id = q.address_id;

  return query
  with stock_free as (
    select pr.id as sid,
           (coalesce(st.birds_available, 0) - coalesce((
              select sum(r.quantity) from public.stock_reservations r
               where r.supplier_id = pr.id and r.week_start = v_week and r.bird_type = q.bird_type
                 and r.status = 'held' and (r.expires_at is null or r.expires_at > now())), 0))::integer as free
      from public.profiles pr
      left join public.stock st on st.supplier_id = pr.id and st.week_start = v_week and st.bird_type = q.bird_type
     where pr.role = 'supplier'
  )
  select pr.id,
         coalesce(m.supplier_id is not null, false),
         case when m.supplier_id is not null then '{}'::text[] else array_remove(array[
           case when pr.status <> 'active' then 'not_active' end,
           case when sd.paused then 'paused' end,
           case when sd.location is null then 'no_location' end,
           case when sp.supplier_id is null then 'no_price' end,
           case when sd.avian_flu_zone <> 'none' and not exists (
                  select 1 from public.documents d
                   where d.profile_id = sd.profile_id and d.kind = 'movement_permit' and d.status = 'approved'
                     and (d.expires_on is null or d.expires_on >= current_date)) then 'flu_zone' end,
           case when not public.has_required_docs(sd.profile_id, 'supplier_required_docs') then 'docs' end,
           case when sp.supplier_id is not null and sf.free < greatest(coalesce(sp.min_order, 1), 1) then 'stock' end,
           case when not exists (
                  select 1 from public.driver_details dd
                    join public.profiles dp on dp.id = dd.profile_id and dp.role = 'driver' and dp.status = 'active'
                    left join public.supplier_requirements sr on sr.supplier_id = sd.profile_id
                   where not dd.paused and dd.capacity_birds is not null
                     and (not coalesce(sr.covered_vehicle, true) or dd.covered)
                     and public.has_required_docs(dd.profile_id, 'driver_required_docs')) then 'no_driver' end
         ], null) end,
         coalesce(m.price_cents, sp.price_cents),
         m.distance_km,
         coalesce(m.same_province, sd.province = ad.province),
         coalesce(m.stock_available, sf.free),
         coalesce(m.rating_avg, sd.rating_avg),
         m.rank
    from public.profiles pr
    join public.supplier_details sd on sd.profile_id = pr.id
    join stock_free sf on sf.sid = pr.id
    left join public.supplier_prices sp on sp.supplier_id = pr.id and sp.bird_type = q.bird_type
         and sp.weight_band = q.weight_band and sp.active
    left join public.match_suppliers(q.bird_type, q.weight_band, ad.location, ad.province) m on m.supplier_id = pr.id
   where pr.role = 'supplier'
   order by m.rank nulls last, pr.created_at;
end;
$$;

revoke all on function public.admin_quote_candidates(uuid) from public, anon;
grant execute on function public.admin_quote_candidates(uuid) to authenticated;
