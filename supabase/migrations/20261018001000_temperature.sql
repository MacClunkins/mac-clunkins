-- Temperature that is actually captured.
--
-- trips.forecast_temp_c was read by the heat warning and the hot-day crate limit, but nothing ever wrote it, so
-- those safeguards could never trigger. The driver's phone now fetches the forecast for the pickup location
-- (and the driver can enter a thermometer reading, which wins), and this function stores it with where it came from.
-- The heat threshold is the admin's setting (heat_warn_c), which the driver app can now read.

alter table public.trips add column if not exists temp_source text check (temp_source in ('forecast', 'measured'));
grant select (temp_source) on public.trips to authenticated;

-- driver_trips gets the new column at the end; admin_trips is rebuilt so it includes it too.
create or replace view public.driver_trips with (security_invoker = true) as
select
  t.id, t.allocation_id, t.driver_id, t.driver_share_cents, t.status, t.pickup_count,
  t.disinfection_photo_path, t.forecast_temp_c, t.picked_up_at, t.delivered_count,
  t.delivered_at, t.pod_photo_path, t.created_at, t.updated_at, t.temp_source
from public.trips t;
revoke all on public.driver_trips from public, anon, authenticated;
grant select on public.driver_trips to authenticated;

drop view public.admin_trips;
create view public.admin_trips with (security_invoker = true) as
select t.*, tc.delivery_fee_cents
  from public.trips t
  left join public.trip_costs tc on tc.trip_id = t.id
 where public.is_admin();
revoke all on public.admin_trips from public, anon, authenticated;
grant select on public.admin_trips to authenticated;

-- The heat limit is not sensitive and the driver app needs it.
update public.settings set is_public = true where key = 'heat_warn_c';

create or replace function public.driver_record_temperature(p_trip_id uuid, p_temp_c numeric, p_source text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.trips;
begin
  if not public.is_active_role('driver') then raise exception 'drivers only' using errcode = '42501'; end if;
  if p_source not in ('forecast', 'measured') then raise exception 'unknown source' using errcode = '22023'; end if;
  if p_temp_c is null or p_temp_c < -10 or p_temp_c > 55 then raise exception 'temperature out of range' using errcode = '22023'; end if;
  select * into t from public.trips x where x.id = p_trip_id and x.driver_id = auth.uid() for update;
  if t.id is null then raise exception 'trip not found' using errcode = 'P0002'; end if;
  if t.status not in ('assigned', 'picked_up') then raise exception 'trip is %', t.status using errcode = 'P0001'; end if;
  -- a thermometer reading is never replaced by a forecast
  if p_source = 'forecast' and t.temp_source = 'measured' then return; end if;
  update public.trips set forecast_temp_c = round(p_temp_c, 1), temp_source = p_source, updated_at = now() where id = t.id;
  perform public.log_audit('trip.temperature', 'trips', t.id::text,
    jsonb_build_object('temp_c', t.forecast_temp_c, 'source', t.temp_source),
    jsonb_build_object('temp_c', round(p_temp_c, 1), 'source', p_source));
end $$;

revoke all on function public.driver_record_temperature(uuid, numeric, text) from public, anon;
grant execute on function public.driver_record_temperature(uuid, numeric, text) to authenticated;
