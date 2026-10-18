-- Admin settings and areas used to be written straight from the browser: an audit_log insert, then
-- a settings update. Admins only have SELECT on both tables (by design), so every save failed with
-- "permission denied for table audit_log". These two functions do the write server-side instead:
-- admin check inside, one audit row per changed key, then the update, all in one transaction.

create or replace function public.admin_update_settings(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  k       text;
  v       jsonb;
  old_v   jsonb;
  changed text[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'only an admin can change settings' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'changes must be an object' using errcode = '22023';
  end if;

  for k, v in select * from jsonb_each(p_changes) loop
    select s.value into old_v from public.settings s where s.key = k;
    if not found then
      raise exception 'unknown setting %', k using errcode = '22023';
    end if;
    if k = 'payments_mode' and (v is null or v not in ('"manual"'::jsonb, '"paystack"'::jsonb)) then
      raise exception 'payments_mode must be manual or paystack' using errcode = '22023';
    end if;
    if k = 'company_profile' and jsonb_typeof(v) <> 'object' then
      raise exception 'company_profile must be an object' using errcode = '22023';
    end if;
    if old_v is not distinct from v then continue; end if;

    perform public.log_audit('settings.update', 'settings', k,
      jsonb_build_object('value', old_v), jsonb_build_object('value', v));
    update public.settings set value = v, updated_at = now(), updated_by = auth.uid() where key = k;
    changed := changed || k;
  end loop;

  return jsonb_build_object('changed', to_jsonb(changed));
end $$;

create or replace function public.admin_update_area(p_province text, p_active boolean, p_launch_order integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare a public.areas_served;
begin
  if not public.is_admin() then
    raise exception 'only an admin can change areas' using errcode = '42501';
  end if;
  if p_launch_order is not null and p_launch_order < 1 then
    raise exception 'launch order must be 1 or more' using errcode = '22023';
  end if;
  select * into a from public.areas_served where province = p_province for update;
  if a.province is null then
    raise exception 'unknown province %', p_province using errcode = 'P0002';
  end if;
  perform public.log_audit('areas_served.update', 'areas_served', p_province,
    jsonb_build_object('active', a.active, 'launch_order', a.launch_order),
    jsonb_build_object('active', p_active, 'launch_order', p_launch_order));
  update public.areas_served set active = p_active, launch_order = p_launch_order where province = p_province;
end $$;

revoke all on function public.admin_update_settings(jsonb) from public, anon;
revoke all on function public.admin_update_area(text, boolean, integer) from public, anon;
grant execute on function public.admin_update_settings(jsonb) to authenticated;
grant execute on function public.admin_update_area(text, boolean, integer) to authenticated;
