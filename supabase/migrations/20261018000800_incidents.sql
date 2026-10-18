-- Incidents: one place where anything that went wrong on a job is recorded, whether a person reported it
-- or the system noticed it, so nobody has to read the database to find out.
--
--   * suppliers and drivers can raise a problem on their own job (raise_incident)
--   * the system raises one automatically for a short load, a count that disagrees with the supplier's,
--     or crates that cannot hold the ordered birds (driver_confirm_pickup)
--   * admins work them through open -> in review -> resolved, with notes the reporter can see
--     (admin_update_incident), and can correct a wrong pickup count (admin_correct_pickup_count) or
--     confirm a delivery by hand with a recorded reason (admin_force_delivery)
-- Every change also goes to audit_log.

create sequence if not exists public.incident_number_seq as bigint start with 1 increment by 1;

create table public.incidents (
  id              uuid primary key default gen_random_uuid(),
  number          text not null unique default ('INC-' || lpad(nextval('public.incident_number_seq')::text, 4, '0')),
  kind            text not null check (kind in ('short_load', 'crate_capacity', 'count_mismatch', 'count_correction',
                                                'delivery_override', 'vehicle', 'access', 'payout_question', 'other')),
  severity        text not null default 'info' check (severity in ('info', 'warn', 'critical')),
  status          text not null default 'open' check (status in ('open', 'in_review', 'resolved', 'dismissed')),
  source          text not null check (source in ('auto', 'user', 'admin')),
  raised_by       uuid references public.profiles (id) on delete set null,
  raised_role     text,
  order_id        uuid references public.orders (id) on delete set null,
  allocation_id   uuid references public.allocations (id) on delete set null,
  trip_id         uuid references public.trips (id) on delete set null,
  title           text not null,
  details         text,
  data            jsonb,
  resolution_note text,
  resolved_by     uuid references public.profiles (id) on delete set null,
  resolved_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index incidents_status_idx on public.incidents (status, created_at desc);
create index incidents_order_id_idx on public.incidents (order_id);
create index incidents_allocation_id_idx on public.incidents (allocation_id);
create index incidents_trip_id_idx on public.incidents (trip_id);
create index incidents_raised_by_idx on public.incidents (raised_by);

create table public.incident_events (
  id                uuid primary key default gen_random_uuid(),
  incident_id       uuid not null references public.incidents (id) on delete cascade,
  actor_id          uuid references public.profiles (id) on delete set null,
  kind              text not null check (kind in ('comment', 'status', 'correction')),
  body              text not null,
  visible_to_raiser boolean not null default false,
  created_at        timestamptz not null default now()
);
create index incident_events_incident_id_idx on public.incident_events (incident_id, created_at);
create index incident_events_actor_id_idx on public.incident_events (actor_id);

alter table public.incidents enable row level security;
alter table public.incident_events enable row level security;
revoke all on public.incidents, public.incident_events from public, anon, authenticated;
grant select on public.incidents, public.incident_events to authenticated;

create policy incidents_admin_read on public.incidents for select to authenticated using ((select public.is_admin()));
create policy incidents_read_own on public.incidents for select to authenticated using (raised_by = (select auth.uid()));
create policy incident_events_admin_read on public.incident_events for select to authenticated using ((select public.is_admin()));
-- A reporter sees only the notes an admin chose to share with them.
create policy incident_events_read_own on public.incident_events for select to authenticated
  using (visible_to_raiser and exists (select 1 from public.incidents i where i.id = incident_id and i.raised_by = (select auth.uid())));

-- Internal: opens an incident, or returns the one already open for the same job and kind.
create or replace function public._open_incident(
  p_kind text, p_severity text, p_source text, p_raised_by uuid, p_role text,
  p_order uuid, p_allocation uuid, p_trip uuid, p_title text, p_details text, p_data jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_source = 'auto' and p_allocation is not null then
    select i.id into v_id from public.incidents i
     where i.kind = p_kind and i.allocation_id = p_allocation and i.status in ('open', 'in_review') limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  insert into public.incidents (kind, severity, source, raised_by, raised_role, order_id, allocation_id, trip_id, title, details, data)
  values (p_kind, p_severity, p_source, p_raised_by, p_role, p_order, p_allocation, p_trip, p_title, p_details, p_data)
  returning id into v_id;
  perform public.log_audit('incident.opened', 'incidents', v_id::text, null,
    jsonb_build_object('kind', p_kind, 'severity', p_severity, 'source', p_source, 'order_id', p_order, 'allocation_id', p_allocation));
  return v_id;
end $$;

-- A supplier or driver reports a problem on their own job (or a general one, with no job).
create or replace function public.raise_incident(p_kind text, p_allocation_id uuid, p_trip_id uuid, p_title text, p_details text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_role text; al public.allocations; tr public.trips; v_order uuid; v_alloc uuid; v_trip uuid;
begin
  select p.role::text into v_role from public.profiles p where p.id = auth.uid() and p.status = 'active';
  if v_role is null or v_role not in ('supplier', 'driver') then
    raise exception 'suppliers and drivers only' using errcode = '42501';
  end if;
  if p_kind not in ('short_load', 'crate_capacity', 'count_correction', 'vehicle', 'access', 'payout_question', 'other') then
    raise exception 'unknown kind' using errcode = '22023';
  end if;
  if p_title is null or char_length(btrim(p_title)) < 3 or char_length(p_title) > 120 then
    raise exception 'give the problem a short title' using errcode = '22023';
  end if;
  if p_details is not null and char_length(p_details) > 2000 then
    raise exception 'details are too long' using errcode = '22023';
  end if;
  if (select count(*) from public.incidents i where i.raised_by = auth.uid() and i.created_at > now() - interval '1 day') >= 10 then
    raise exception 'too_many_reports' using errcode = 'P0001';
  end if;

  if p_allocation_id is not null then
    if v_role = 'supplier' then
      select * into al from public.allocations x where x.id = p_allocation_id and x.supplier_id = auth.uid();
    else
      select x.* into al from public.allocations x join public.trips t on t.allocation_id = x.id
       where x.id = p_allocation_id and t.driver_id = auth.uid();
    end if;
    if al.id is null then raise exception 'job not found' using errcode = 'P0002'; end if;
    v_alloc := al.id; v_order := al.order_id;
  end if;
  if p_trip_id is not null then
    select * into tr from public.trips x where x.id = p_trip_id and x.driver_id = auth.uid();
    if v_role <> 'driver' or tr.id is null then raise exception 'trip not found' using errcode = 'P0002'; end if;
    v_trip := tr.id;
    v_alloc := coalesce(v_alloc, tr.allocation_id);
    select a2.order_id into v_order from public.allocations a2 where a2.id = tr.allocation_id;
  end if;

  return public._open_incident(p_kind, 'info', 'user', auth.uid(), v_role, v_order, v_alloc, v_trip,
    btrim(p_title), nullif(btrim(coalesce(p_details, '')), ''), null);
end $$;

-- Admin moves an incident along and says what was done. A note is needed to close one.
create or replace function public.admin_update_incident(p_id uuid, p_status text, p_note text, p_visible boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare i public.incidents; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if p_status not in ('open', 'in_review', 'resolved', 'dismissed') then raise exception 'unknown status' using errcode = '22023'; end if;
  select * into i from public.incidents x where x.id = p_id for update;
  if i.id is null then raise exception 'incident not found' using errcode = 'P0002'; end if;
  if p_status in ('resolved', 'dismissed') and (v_note is null or char_length(v_note) < 3) then
    raise exception 'write what was done before closing' using errcode = '22023';
  end if;
  update public.incidents set
    status = p_status,
    resolution_note = case when p_status in ('resolved', 'dismissed') then v_note else resolution_note end,
    resolved_by = case when p_status in ('resolved', 'dismissed') then auth.uid() else null end,
    resolved_at = case when p_status in ('resolved', 'dismissed') then now() else null end,
    updated_at = now()
   where id = i.id;
  insert into public.incident_events (incident_id, actor_id, kind, body, visible_to_raiser)
  values (i.id, auth.uid(), case when p_status = i.status then 'comment' else 'status' end,
          coalesce(v_note, 'Status changed to ' || p_status), coalesce(p_visible, false));
  perform public.log_audit('incident.updated', 'incidents', i.id::text,
    jsonb_build_object('status', i.status), jsonb_build_object('status', p_status, 'note', v_note));
end $$;

-- Admin fixes a pickup count that was entered wrongly. The supplier payout follows the count while it is
-- still queued; once a transfer has been sent the count is left alone and the admin is told why.
create or replace function public.admin_correct_pickup_count(p_allocation_id uuid, p_count integer, p_reason text, p_incident_id uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.allocations; t public.trips; tr public.transfers; v_old integer; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if char_length(v_reason) < 5 then raise exception 'say why the count is being corrected' using errcode = '22023'; end if;
  select * into a from public.allocations x where x.id = p_allocation_id for update;
  if a.id is null then raise exception 'job not found' using errcode = 'P0002'; end if;
  if a.status <> 'collected' then raise exception 'job has not been collected yet' using errcode = 'P0001'; end if;
  if p_count is null or p_count < 0 or p_count > a.quantity then raise exception 'count must be between 0 and %', a.quantity using errcode = '22023'; end if;
  select * into t from public.trips x where x.allocation_id = a.id for update;
  select * into tr from public.transfers x where x.allocation_id = a.id and x.party_type = 'supplier' for update;
  if tr.id is not null and tr.status not in ('queued', 'failed') then
    raise exception 'payout_already_sent' using errcode = 'P0001';
  end if;
  v_old := coalesce(t.pickup_count, a.birds_counted);
  update public.allocations set birds_counted = p_count, updated_at = now() where id = a.id;
  update public.trips set pickup_count = p_count, updated_at = now() where allocation_id = a.id;
  if tr.id is not null then
    update public.transfers set amount_cents = a.supplier_price_cents * p_count where id = tr.id;
  end if;
  perform public.log_audit('admin.correction', 'allocations', a.id::text,
    jsonb_build_object('birds_counted', v_old, 'supplier_transfer_cents', tr.amount_cents),
    jsonb_build_object('birds_counted', p_count, 'supplier_transfer_cents', a.supplier_price_cents * p_count, 'reason', v_reason));
  if p_incident_id is not null then
    insert into public.incident_events (incident_id, actor_id, kind, body, visible_to_raiser)
    values (p_incident_id, auth.uid(), 'correction',
            'Pickup count corrected from ' || coalesce(v_old::text, 'none') || ' to ' || p_count || '. ' || v_reason, true);
  end if;
end $$;

-- Admin confirms a delivery without the buyer's code (the buyer cannot be reached, a test, a dispute...).
-- It is recorded as an incident so it is never invisible.
create or replace function public.admin_force_delivery(p_trip_id uuid, p_count integer, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.trips; a public.allocations; o public.orders; v_count integer; v_reason text := btrim(coalesce(p_reason, ''));
begin
  if not public.is_admin() then raise exception 'admin only' using errcode = '42501'; end if;
  if char_length(v_reason) < 5 then raise exception 'say why the delivery is being confirmed by hand' using errcode = '22023'; end if;
  select * into t from public.trips x where x.id = p_trip_id for update;
  if t.id is null then raise exception 'trip not found' using errcode = 'P0002'; end if;
  if t.status <> 'picked_up' then raise exception 'trip_not_in_transit' using errcode = 'P0001'; end if;
  select * into a from public.allocations x where x.id = t.allocation_id;
  select * into o from public.orders x where x.id = a.order_id for update;
  v_count := coalesce(p_count, t.pickup_count, a.quantity);
  if v_count < 0 or v_count > coalesce(t.pickup_count, a.quantity) then
    raise exception 'delivered_more_than_collected' using errcode = '22023';
  end if;
  update public.trips set status = 'delivered', delivered_at = now(), delivered_count = v_count where id = t.id;
  if not exists (select 1 from public.trips tt join public.allocations aa on aa.id = tt.allocation_id
                  where aa.order_id = o.id and tt.status <> 'delivered') then
    update public.orders set status = 'delivered' where id = o.id;
    perform public.log_order_event(o.id, 'delivered', 'Delivery confirmed by McCluckin''s');
  end if;
  insert into public.transfers (party_id, party_type, trip_id, amount_cents)
  values (t.driver_id, 'driver', t.id, t.driver_share_cents) on conflict do nothing;
  perform public._open_incident('delivery_override', 'warn', 'admin', auth.uid(), 'admin', o.id, a.id, t.id,
    'Delivery confirmed by an admin', v_reason, jsonb_build_object('delivered', v_count, 'collected', t.pickup_count));
  perform public.log_audit('admin.force_delivery', 'trips', t.id::text, jsonb_build_object('status', 'picked_up'),
    jsonb_build_object('status', 'delivered', 'delivered_count', v_count, 'reason', v_reason));
end $$;

-- Counts are locked once a job is marked ready.
create or replace function public.supplier_update_allocation(p_allocation_id uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.allocations;
  k text;
begin
  a := public._supplier_allocation(p_allocation_id);
  if a.status = 'ready' then
    -- Once a load is marked ready the count and crates are what the driver will see. Changing them
    -- quietly is how a wrong number goes unnoticed, so a change has to be raised and corrected by an admin.
    raise exception 'job_locked' using errcode = 'P0001';
  end if;
  if a.status <> 'accepted' then
    raise exception 'job is %, details can only be saved on an accepted job', a.status using errcode = 'P0001';
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'details must be an object' using errcode = '22023';
  end if;
  for k in select jsonb_object_keys(p_patch) loop
    if k not in ('birds_counted', 'crates', 'welfare_ok', 'load_photo_path', 'removal_permit_path', 'permit_valid_until') then
      raise exception '% cannot be changed here', k using errcode = '22023';
    end if;
  end loop;
  if p_patch ? 'birds_counted' and ((p_patch ->> 'birds_counted')::integer < 0) then
    raise exception 'birds_counted cannot be negative' using errcode = '22023';
  end if;
  if p_patch ? 'crates' and ((p_patch ->> 'crates')::integer < 0) then
    raise exception 'crates cannot be negative' using errcode = '22023';
  end if;
  update public.allocations set
    birds_counted       = case when p_patch ? 'birds_counted' then (p_patch ->> 'birds_counted')::integer else birds_counted end,
    crates              = case when p_patch ? 'crates' then (p_patch ->> 'crates')::integer else crates end,
    welfare_ok          = case when p_patch ? 'welfare_ok' then (p_patch ->> 'welfare_ok')::boolean else welfare_ok end,
    load_photo_path     = case when p_patch ? 'load_photo_path' then p_patch ->> 'load_photo_path' else load_photo_path end,
    removal_permit_path = case when p_patch ? 'removal_permit_path' then p_patch ->> 'removal_permit_path' else removal_permit_path end,
    permit_valid_until  = case when p_patch ? 'permit_valid_until' then (p_patch ->> 'permit_valid_until')::timestamptz else permit_valid_until end,
    updated_at          = now()
  where id = a.id;
end $$;

-- The old three-argument version is replaced by the four-argument one (the extra argument is optional,
-- so queued offline pickups that do not send it still work).
drop function if exists public.driver_confirm_pickup(uuid, integer, text);

create or replace function public.driver_confirm_pickup(p_trip_id uuid, p_count integer, p_photo_path text default null, p_short_reason text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  t public.trips; a public.allocations; o public.orders; v_amount integer; v_need boolean;
  v_supplier_count integer; v_max_crate integer; v_reason text := nullif(btrim(coalesce(p_short_reason, '')), '');
begin
  if not public.is_active_role('driver') then raise exception 'drivers only' using errcode = '42501'; end if;
  select * into t from public.trips x where x.id = p_trip_id and x.driver_id = auth.uid() for update;
  if t.id is null then raise exception 'trip not found' using errcode = 'P0002'; end if;
  if t.status <> 'assigned' then raise exception 'trip_not_awaiting_pickup' using errcode = 'P0001'; end if;
  select * into a from public.allocations x where x.id = t.allocation_id for update;
  select * into o from public.orders x where x.id = a.order_id for update;
  if o.status not in ('paid', 'scheduled', 'ready', 'on_the_way') then raise exception 'order_not_ready' using errcode = 'P0001'; end if;
  if p_count is null or p_count < 0 or p_count > a.quantity then raise exception 'invalid_count' using errcode = '22023'; end if;
  select coalesce(sr.disinfection_photo, false) into v_need from public.supplier_requirements sr where sr.supplier_id = a.supplier_id;
  if coalesce(v_need, false) and p_photo_path is null then raise exception 'disinfection_photo_required' using errcode = 'P0001'; end if;
  v_supplier_count := a.birds_counted;       -- what the supplier counted, before the driver's count replaces it
  update public.trips set status = 'picked_up', picked_up_at = now(), pickup_count = p_count,
         disinfection_photo_path = coalesce(p_photo_path, disinfection_photo_path) where id = t.id;
  update public.allocations set status = 'collected', birds_counted = p_count where id = a.id;
  if o.status <> 'on_the_way' then
    update public.orders set status = 'on_the_way' where id = o.id;
    perform public.log_order_event(o.id, 'on_the_way', 'Birds collected');
  end if;
  -- Anything out of the ordinary is recorded for the admin, whatever the driver typed.
  if p_count < a.quantity then
    perform public._open_incident('short_load', 'warn', 'auto', auth.uid(), 'driver', o.id, a.id, t.id,
      'Short load: ' || p_count || ' of ' || a.quantity || ' birds collected',
      coalesce(v_reason, 'No reason given'),
      jsonb_build_object('ordered', a.quantity, 'collected', p_count, 'supplier_count', v_supplier_count,
                         'crates', a.crates, 'reason', coalesce(v_reason, 'not given')));
  end if;
  if v_supplier_count is not null and v_supplier_count <> p_count then
    perform public._open_incident('count_mismatch', 'warn', 'auto', auth.uid(), 'driver', o.id, a.id, t.id,
      'Counts disagree: supplier ' || v_supplier_count || ', driver ' || p_count,
      null, jsonb_build_object('supplier_count', v_supplier_count, 'driver_count', p_count, 'ordered', a.quantity));
  end if;
  select sr.max_per_crate into v_max_crate from public.supplier_requirements sr where sr.supplier_id = a.supplier_id;
  if a.crates is not null and v_max_crate is not null and a.crates * v_max_crate < a.quantity then
    perform public._open_incident('crate_capacity', 'warn', 'auto', auth.uid(), 'driver', o.id, a.id, t.id,
      'Crates cannot hold the order: ' || a.crates || ' crates x ' || v_max_crate || ' = ' || (a.crates * v_max_crate) || ' birds, ' || a.quantity || ' ordered',
      null, jsonb_build_object('crates', a.crates, 'per_crate', v_max_crate, 'ordered', a.quantity));
  end if;
  v_amount := a.supplier_price_cents * least(a.quantity, p_count);
  insert into public.transfers (party_id, party_type, allocation_id, amount_cents)
  values (a.supplier_id, 'supplier', a.id, v_amount) on conflict do nothing;
  perform public.log_audit('payout.queued', 'transfers', a.id::text, null,
    jsonb_build_object('party', 'supplier', 'amount_cents', v_amount, 'order_id', o.id));
  return jsonb_build_object('picked_up', true, 'trip_id', t.id);
end $$;

revoke all on function public._open_incident(text, text, text, uuid, text, uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.raise_incident(text, uuid, uuid, text, text),
  public.admin_update_incident(uuid, text, text, boolean),
  public.admin_correct_pickup_count(uuid, integer, text, uuid),
  public.admin_force_delivery(uuid, integer, text),
  public.driver_confirm_pickup(uuid, integer, text, text) from public, anon;
grant execute on function public.raise_incident(text, uuid, uuid, text, text),
  public.admin_update_incident(uuid, text, text, boolean),
  public.admin_correct_pickup_count(uuid, integer, text, uuid),
  public.admin_force_delivery(uuid, integer, text),
  public.driver_confirm_pickup(uuid, integer, text, text) to authenticated;
