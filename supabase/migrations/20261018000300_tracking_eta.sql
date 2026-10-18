-- Live delivery tracking and ETA.
--
-- The driver app posts its position while a trip is picked up; the buyer's tracking RPC turns that
-- into a driver position and an arrival time. Before the driver is on the road the ETA is the end of
-- the scheduled delivery window, so the buyer always has a time to look at.
--
-- trip_locations holds only the latest point per trip and is not readable through the API at all:
-- it is written by driver_update_location and read inside buyer_order_tracking.

create table public.trip_locations (
  trip_id    uuid primary key references public.trips (id) on delete cascade,
  lat        double precision not null check (lat between -90 and 90),
  lng        double precision not null check (lng between -180 and 180),
  updated_at timestamptz not null default now()
);
alter table public.trip_locations enable row level security;
revoke all on public.trip_locations from public, anon, authenticated;

create or replace function public.driver_update_location(p_trip_id uuid, p_lat double precision, p_lng double precision)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.trips;
begin
  if not public.is_active_role('driver') then
    raise exception 'drivers only' using errcode = '42501';
  end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid position' using errcode = '22023';
  end if;
  select * into t from public.trips x where x.id = p_trip_id and x.driver_id = auth.uid();
  if t.id is null then
    raise exception 'trip not found' using errcode = 'P0002';
  end if;
  -- Only while the birds are on the vehicle; positions before pickup or after delivery are dropped.
  if t.status <> 'picked_up' then
    return;
  end if;
  insert into public.trip_locations (trip_id, lat, lng, updated_at)
  values (p_trip_id, p_lat, p_lng, now())
  on conflict (trip_id) do update set lat = excluded.lat, lng = excluded.lng, updated_at = now();
end $$;

revoke all on function public.driver_update_location(uuid, double precision, double precision) from public, anon;
grant execute on function public.driver_update_location(uuid, double precision, double precision) to authenticated;

-- A position older than this is not shown (the driver lost signal or stopped the app).
-- Speed and the road-distance factor come from settings if set (avg_speed_kmh, road_distance_factor).
create or replace function public.buyer_order_tracking(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  r        record;
  o        public.orders;
  v_loc    public.trip_locations;
  v_dest   extensions.geography;
  v_end    timestamptz;
  v_eta    timestamptz;
  v_source text := null;
  v_km     numeric;
  v_live   boolean := false;
begin
  if not public.buyer_owns_order(p_order_id) then return null; end if;
  select * into o from public.orders x where x.id = p_order_id;

  select split_part(p.full_name, ' ', 1) as first_name,
         dd.vehicle_type::text as vehicle,
         sum(t.delivered_count) as delivered,
         bool_or(t.status = 'picked_up') as on_road,
         (array_agg(t.id order by t.created_at))[1] as trip_id
    into r
    from public.allocations a
    join public.trips t on t.allocation_id = a.id
    left join public.profiles p on p.id = t.driver_id
    left join public.driver_details dd on dd.profile_id = t.driver_id
   where a.order_id = p_order_id
   group by 1, 2 limit 1;

  if r.on_road then
    select l.* into v_loc from public.trip_locations l
     where l.trip_id in (select t.id from public.trips t join public.allocations a on a.id = t.allocation_id
                          where a.order_id = p_order_id and t.status = 'picked_up')
       and l.updated_at > now() - interval '30 minutes'
     order by l.updated_at desc limit 1;
    select ad.location into v_dest from public.addresses ad where ad.id = o.address_id;
    if v_loc.trip_id is not null and v_dest is not null then
      v_km := extensions.st_distance(
                extensions.st_setsrid(extensions.st_makepoint(v_loc.lng, v_loc.lat), 4326)::extensions.geography,
                v_dest) / 1000.0 * public.app_setting('road_distance_factor', 1.3);
      v_eta := now() + make_interval(secs => (v_km / greatest(public.app_setting('avg_speed_kmh', 40), 5)) * 3600);
      v_source := 'live';
      v_live := true;
    end if;
  end if;

  if v_eta is null and o.delivery_date is not null and o.status not in ('delivered', 'settled', 'cancelled', 'refunded') then
    select (o.delivery_date + s.end_time) at time zone 'Africa/Johannesburg' into v_end
      from public.delivery_slots s where s.id = o.slot_id;
    if v_end is not null then
      v_eta := v_end;
      v_source := 'window';
    end if;
  end if;

  return jsonb_build_object(
    'eta_at', v_eta, 'eta_source', v_source,
    'driver_first_name', r.first_name, 'vehicle', r.vehicle,
    'call_number', (select value #>> '{}' from public.settings where key = 'support_phone'),
    'delivered_count', r.delivered,
    'lat', case when v_live then v_loc.lat end, 'lng', case when v_live then v_loc.lng end,
    'location_updated_at', case when v_live then v_loc.updated_at end);
end $$;
