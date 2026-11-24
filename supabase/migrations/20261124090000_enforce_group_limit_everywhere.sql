-- Enforce the Free/Plus group limit on every way a group can be created, not only the form.
--
-- Before this migration the limit was checked only inside create_group_from_form. The older RPCs
-- public.create_group (two overloads) and public.create_group_with_metadata are still granted to
-- authenticated users and skipped the check, so a Free account could open a third group by
-- calling them directly. The count also included groups the owner had already closed.
--
-- * One source of truth: private.group_limit_for(user) and private.owned_open_group_count(user).
-- * A BEFORE INSERT trigger on public.groups enforces the limit whenever an end user (auth.uid())
--   inserts, serialised per owner with an advisory lock so two parallel requests cannot both pass.
--   Trusted server code (service role, no auth.uid()) is not limited.
-- * Closed (closed_at set) and cancelled groups no longer count toward the limit.
-- * Existing groups are never changed or deleted: an owner above the limit (e.g. Plus expired)
--   keeps every group and can open new ones again once back within the limit.
--
-- Rollback: drop trigger groups_enforce_plan_limit on public.groups; drop function
-- private.enforce_group_limit(); re-run create_group_from_form from 20261120190000_monthly_pay_day.sql.

create or replace function private.group_limit_for(p_user uuid)
returns integer
language sql
security definer
set search_path = ''
as $$ select case when private.effective_plan(p_user) = 'plus' then 5 else 2 end $$;

create or replace function private.owned_open_group_count(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.groups g
  where g.owner_id = p_user and g.status <> 'cancelled' and g.closed_at is null
$$;

create or replace function private.enforce_group_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only end-user requests are limited; service-role/admin code runs without auth.uid().
  if auth.uid() is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('harnkhong:group_limit:' || new.owner_id::text, 0));
  if private.owned_open_group_count(new.owner_id) >= private.group_limit_for(new.owner_id) then
    raise exception 'group_limit_reached' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists groups_enforce_plan_limit on public.groups;
create trigger groups_enforce_plan_limit
  before insert on public.groups
  for each row execute function private.enforce_group_limit();

revoke all on function private.group_limit_for(uuid) from public, anon, authenticated;
revoke all on function private.owned_open_group_count(uuid) from public, anon, authenticated;
revoke all on function private.enforce_group_limit() from public, anon, authenticated;

-- The form keeps its own early check, now through the shared helpers.
CREATE OR REPLACE FUNCTION private.create_group_from_form(p_request uuid, p_name text, p_categories text[], p_images jsonb, p_visibility text, p_capacity integer, p_delivery bigint, p_price bigint, p_product jsonb, p_details jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_listing text;
  v_group uuid;
  v_type text := p_product->>'type';
  v_category text := p_product->>'category';
  v_title text := btrim(coalesce(p_product->>'title', ''));
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
  v_monthly boolean;
  v_pay_day integer;
begin
  if v_user is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_request is null or jsonb_typeof(p_product) <> 'object'
    or jsonb_typeof(v_details) <> 'object'
    or v_type not in ('physical', 'digital')
    or char_length(v_title) not between 1 and 100
    or v_category is null or char_length(btrim(v_category)) not between 1 and 60 then
    raise exception 'invalid_product_details' using errcode = '22023';
  end if;
  if coalesce(v_details->>'billing', 'one_time') not in ('one_time', 'monthly') then
    raise exception 'invalid_billing_mode' using errcode = '22023';
  end if;
  v_monthly := coalesce(v_details->>'billing', 'one_time') = 'monthly';
  -- Monthly groups pay on a fixed day of the month (1-28, so every month has it).
  if v_monthly then
    if coalesce(v_details->>'payDay', '') !~ '^[0-9]{1,2}$'
      or (v_details->>'payDay')::integer not between 1 and 28 then
      raise exception 'invalid_pay_day' using errcode = '22023';
    end if;
    v_pay_day := (v_details->>'payDay')::integer;
  end if;
  -- Plan limit: Free owns up to 2 open groups at once, Plus up to 5. Closed groups do not count.
  -- Checked here for an early, clear error; the trigger on public.groups enforces it for every path.
  if private.owned_open_group_count(v_user) >= private.group_limit_for(v_user) then
    raise exception 'group_limit_reached' using errcode = '23514';
  end if;
  -- One-time groups need a closing date for members; monthly groups use the pay day instead.
  if coalesce((v_details->>'minimumMembers')::integer, 0) not between 2 and p_capacity
    or (not v_monthly and (nullif(v_details->>'closesAt', '') is null
      or (v_details->>'closesAt')::date < current_date)) then
    raise exception 'invalid_group_details' using errcode = '22023';
  end if;

  v_listing := 'custom-' || v_user::text || '-' || p_request::text;
  insert into public.products (
    id, seller_id, title, category, kind, price_satang, art, mark,
    description, terms, details, active
  ) values (
    v_listing,
    'community',
    v_title,
    v_category,
    case when v_type = 'digital' then 'บริการ' else 'สินค้า' end,
    p_price,
    'custom',
    case when v_type = 'digital' then 'ดิจิทัล' else 'หาร' end,
    coalesce(p_product->>'description', ''),
    coalesce(p_product->>'terms', ''),
    coalesce(p_product->'productDetails', '{}'::jsonb),
    true
  )
  on conflict (id) do update set
    title = excluded.title,
    category = excluded.category,
    kind = excluded.kind,
    price_satang = excluded.price_satang,
    description = excluded.description,
    terms = excluded.terms,
    details = excluded.details;

  v_group := private.create_group_with_metadata(
    v_listing,
    p_request,
    p_name,
    p_categories,
    p_images,
    p_visibility,
    p_capacity,
    p_delivery,
    p_price
  );
  update public.groups
  set details = v_details - 'billing' - 'payDay' - case when v_monthly then 'closesAt' else '' end,
      billing_mode = coalesce(v_details->>'billing', 'one_time'),
      pay_day = v_pay_day,
      pricing_mode = 'seat_v3'
  where id = v_group and owner_id = v_user;
  perform private.refresh_group_totals(v_group);
  return v_group;
end;
$function$;

notify pgrst, 'reload schema';
