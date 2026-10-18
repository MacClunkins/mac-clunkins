-- Suppliers have no write grant on allocations (that is deliberate: the table also holds prices and
-- statuses the supplier must not change freely), but the supplier app updated it directly, so accepting
-- an order, saving pickup details and marking a load ready all failed with "permission denied for
-- table allocations". These functions do those writes server-side, for the supplier's own allocation
-- only, and only the fields and status moves a supplier is allowed to make.

create or replace function public._supplier_allocation(p_id uuid)
returns public.allocations
language plpgsql security definer set search_path = '' as $$
declare a public.allocations;
begin
  if not public.is_active_role('supplier') then
    raise exception 'suppliers only' using errcode = '42501';
  end if;
  select * into a from public.allocations x where x.id = p_id and x.supplier_id = auth.uid() for update;
  if a.id is null then
    raise exception 'job not found' using errcode = 'P0002';
  end if;
  return a;
end $$;

-- accept or decline a job that was offered
create or replace function public.supplier_respond_allocation(p_allocation_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.allocations;
begin
  a := public._supplier_allocation(p_allocation_id);
  if a.status <> 'offered' then
    raise exception 'job is already %', a.status using errcode = 'P0001';
  end if;
  update public.allocations
     set status = case when p_accept then 'accepted'::public.allocation_status else 'declined'::public.allocation_status end,
         updated_at = now()
   where id = a.id;
  perform public.log_audit(case when p_accept then 'allocation.accepted' else 'allocation.declined' end,
    'allocations', a.id::text, jsonb_build_object('status', a.status),
    jsonb_build_object('status', case when p_accept then 'accepted' else 'declined' end));
end $$;

-- save the count, crates, welfare check, load photo and removal permit while a job is being prepared
create or replace function public.supplier_update_allocation(p_allocation_id uuid, p_patch jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.allocations;
  k text;
begin
  a := public._supplier_allocation(p_allocation_id);
  if a.status not in ('accepted', 'ready') then
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

-- the load is counted, photographed and permitted: tell the admin and driver it can be collected
create or replace function public.supplier_mark_ready(p_allocation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a public.allocations;
begin
  a := public._supplier_allocation(p_allocation_id);
  if a.status <> 'accepted' then
    raise exception 'job is %, only an accepted job can be marked ready', a.status using errcode = 'P0001';
  end if;
  -- the same checks the app shows the supplier before it enables the button
  if coalesce(a.birds_counted, 0) <= 0 then raise exception 'need_count' using errcode = 'P0001'; end if;
  if coalesce(a.crates, 0) <= 0 then raise exception 'need_crates' using errcode = 'P0001'; end if;
  if not coalesce(a.welfare_ok, false) then raise exception 'need_welfare' using errcode = 'P0001'; end if;
  if a.load_photo_path is null then raise exception 'need_photo' using errcode = 'P0001'; end if;
  if a.removal_permit_path is null then raise exception 'need_permit' using errcode = 'P0001'; end if;
  if a.permit_valid_until is null or a.permit_valid_until <= now() then
    raise exception 'permit_expired' using errcode = 'P0001';
  end if;
  update public.allocations set status = 'ready', updated_at = now() where id = a.id;
  perform public.log_audit('allocation.ready', 'allocations', a.id::text,
    jsonb_build_object('status', 'accepted'), jsonb_build_object('status', 'ready'));
end $$;

revoke all on function public._supplier_allocation(uuid) from public, anon, authenticated;
revoke all on function public.supplier_respond_allocation(uuid, boolean),
  public.supplier_update_allocation(uuid, jsonb), public.supplier_mark_ready(uuid) from public, anon;
grant execute on function public.supplier_respond_allocation(uuid, boolean),
  public.supplier_update_allocation(uuid, jsonb), public.supplier_mark_ready(uuid) to authenticated;
