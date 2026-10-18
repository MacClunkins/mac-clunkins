-- Admin settings and areas used to be written straight from the browser: an audit_log insert, then
-- a settings update. Admins only have SELECT on both tables (by design), so every save failed with
-- "permission denied for table audit_log". These two functions do the write server-side instead:
-- admin check inside, one audit row per changed key, then the update, all in one transaction.

-- Only the keys the admin screen edits are writable here, each with a type and range check, so a
-- browser cannot flip integration keys (paystack_mode, email_mode, ...) or store a value the screen
-- would have rejected. Spec per key: type, then optional min / max, and `int` for whole numbers.
create or replace function public.admin_update_settings(p_changes jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  spec constant jsonb := '{
    "markup_pct":              {"type":"number","min":0,"max":100},
    "service_fee_pct":         {"type":"number","min":0,"max":100},
    "driver_share_pct":        {"type":"number","min":0,"max":100},
    "min_margin_cents":        {"type":"number","min":0,"int":true},
    "delivery_base_cents":     {"type":"number","min":0,"int":true},
    "delivery_per_km_cents":   {"type":"number","min":0,"int":true},
    "delivery_per_bird_cents": {"type":"number","min":0,"int":true},
    "quote_hold_minutes":      {"type":"number","min":1,"max":1440,"int":true},
    "rfq_min_birds":           {"type":"number","min":1,"int":true},
    "rfq_max_km":              {"type":"number","min":1,"int":true},
    "min_order":               {"type":"number","min":1,"int":true},
    "unpaid_cancel_hours":     {"type":"number","min":1,"max":720,"int":true},
    "issue_window_hours":      {"type":"number","min":1,"max":720,"int":true},
    "heat_warn_c":             {"type":"number","min":0,"max":60},
    "journey_warn_hours":      {"type":"number","min":0.5,"max":24},
    "delivery_timeline":       {"type":"string","nullable":true},
    "support_phone":           {"type":"string"},
    "payments_mode":           {"type":"string","in":["manual","paystack"]},
    "company_profile":         {"type":"object"},
    "languages_enabled":       {"type":"array"}
  }'::jsonb;
  k       text;
  v       jsonb;
  old_v   jsonb;
  sp      jsonb;
  changed text[] := '{}';
begin
  if not public.is_admin() then
    raise exception 'only an admin can change settings' using errcode = '42501';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'changes must be an object' using errcode = '22023';
  end if;

  for k, v in select * from jsonb_each(p_changes) loop
    -- Message templates (msg.*) are free text; everything else needs a spec.
    if k like 'msg.%' then
      sp := '{"type":"string"}'::jsonb;
    else
      sp := spec -> k;
    end if;
    if sp is null then
      raise exception 'setting % cannot be changed here', k using errcode = '22023';
    end if;

    if jsonb_typeof(v) = 'null' then
      if coalesce((sp ->> 'nullable')::boolean, false) is not true then
        raise exception '% cannot be empty', k using errcode = '22023';
      end if;
    else
      if jsonb_typeof(v) <> sp ->> 'type' then
        raise exception '% must be a %', k, sp ->> 'type' using errcode = '22023';
      end if;
      if sp ->> 'type' = 'number' then
        if sp ? 'min' and (v #>> '{}')::numeric < (sp ->> 'min')::numeric then
          raise exception '% is below the minimum', k using errcode = '22023';
        end if;
        if sp ? 'max' and (v #>> '{}')::numeric > (sp ->> 'max')::numeric then
          raise exception '% is above the maximum', k using errcode = '22023';
        end if;
        if coalesce((sp ->> 'int')::boolean, false) and (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric) then
          raise exception '% must be a whole number', k using errcode = '22023';
        end if;
      end if;
      if sp ? 'in' and not (sp -> 'in') @> jsonb_build_array(v #>> '{}') then
        raise exception '% has an unsupported value', k using errcode = '22023';
      end if;
      if k like 'msg.%' and btrim(v #>> '{}') = '' then
        raise exception '% cannot be empty', k using errcode = '22023';
      end if;
    end if;

    select s.value into old_v from public.settings s where s.key = k for update;
    if not found then
      raise exception 'unknown setting %', k using errcode = '22023';
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
