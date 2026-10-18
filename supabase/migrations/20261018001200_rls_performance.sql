-- Row-level security that does not re-ask "who is this?" for every row.
--
-- A policy such as  using (buyer_id = auth.uid())  calls auth.uid() once per row it looks at. Written as
-- (select auth.uid()) Postgres evaluates it once per query and reuses the answer. The Supabase advisor flagged
-- 38 policies in public for this, which is invisible with a handful of orders and slow with thousands.
-- The same goes for is_admin() and is_active_role('...'), which take no row-dependent arguments.
--
-- Rather than retype 38 policies, this rewrites each existing policy expression in place. The meaning does not
-- change (the wrapped call returns the same value), so the RLS and privacy suites must pass unchanged.
-- It is safe to run twice: an expression that is already wrapped is left alone.

create or replace function pg_temp.wrap_policy_expr(e text) returns text language plpgsql as $f$
begin
  e := regexp_replace(e, '(?<!select )auth\.uid\(\)', '(select auth.uid())', 'gi');
  e := regexp_replace(e, '(?<!select )(public\.)?is_admin\(\)', '(select public.is_admin())', 'gi');
  e := regexp_replace(e, '(?<!select )(public\.)?is_active_role\(([^()]*)\)', '(select public.is_active_role(\2))', 'gi');
  return e;
end
$f$;

do $$
declare
  p record;
  v_using text;
  v_check text;
  v_sql text;
begin
  for p in select policyname, tablename, qual, with_check from pg_policies where schemaname = 'public' loop
    v_using := case when p.qual is null then null else pg_temp.wrap_policy_expr(p.qual) end;
    v_check := case when p.with_check is null then null else pg_temp.wrap_policy_expr(p.with_check) end;
    if v_using is distinct from p.qual or v_check is distinct from p.with_check then
      v_sql := format('alter policy %I on public.%I', p.policyname, p.tablename);
      if v_using is not null then v_sql := v_sql || format(' using (%s)', v_using); end if;
      if v_check is not null then v_sql := v_sql || format(' with check (%s)', v_check); end if;
      execute v_sql;
    end if;
  end loop;
end
$$;

-- Foreign keys without an index make deletes and joins on them scan the whole table.
create index if not exists consents_superseded_by_idx on public.consents (superseded_by);
create index if not exists quote_costs_matched_supplier_id_idx on public.quote_costs (matched_supplier_id);
