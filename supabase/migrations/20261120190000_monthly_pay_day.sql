-- Monthly groups pay on a fixed day of the month chosen at creation ("จ่ายทุกวันที่ ...")
-- instead of a member closing date. One-time groups keep their closing date.

alter table public.groups add column if not exists pay_day smallint;
alter table public.groups drop constraint if exists groups_pay_day_check;
alter table public.groups add constraint groups_pay_day_check check (pay_day is null or pay_day between 1 and 28);

-- The first pay date on or after 3 days from now (Bangkok calendar), at midnight Bangkok time.
-- Starting a cycle too close to the pay day moves the first payment to next month.
create or replace function private.first_pay_date(p_pay_day integer, p_now timestamptz default now())
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_today date := (p_now at time zone 'Asia/Bangkok')::date;
  v_candidate date := make_date(extract(year from v_today)::integer, extract(month from v_today)::integer, p_pay_day);
begin
  if v_candidate < v_today + 3 then
    v_candidate := (v_candidate + interval '1 month')::date;
  end if;
  return v_candidate::timestamp at time zone 'Asia/Bangkok';
end;
$$;
revoke all on function private.first_pay_date(integer, timestamptz) from public, anon, authenticated;

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
  -- Plan limit: Free owns up to 2 open groups at once, Plus up to 5.
  if ((select count(*) from public.groups g where g.owner_id = v_user and g.status <> 'cancelled')
     >= (case when private.effective_plan(v_user) = 'plus' then 5 else 2 end)) then
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

-- Cycles run from pay date to pay date, so each month's payment is due on its cycle's start.
create or replace function public.start_group_cycle(p_group uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_group public.groups%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into v_group from public.groups where id = p_group for update;
  if not found or v_group.status = 'cancelled' then raise exception 'group_unavailable' using errcode = 'P0002'; end if;
  if v_group.owner_id <> v_user then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_group.billing_mode <> 'monthly' then raise exception 'not_monthly' using errcode = '23514'; end if;
  if v_group.cycle_anchor is not null then raise exception 'cycle_started' using errcode = '23505'; end if;
  update public.groups
  set cycle_anchor = case when v_group.pay_day is null then now() else private.first_pay_date(v_group.pay_day) end,
      updated_at = now()
  where id = p_group;
  return private.open_group_cycle(p_group, 1);
end;
$$;

-- Editing a monthly group no longer needs a member closing date.
create or replace function private.update_group_details(
  p_group uuid,
  p_request uuid,
  p_name text,
  p_details jsonb,
  p_visibility text,
  p_delivery bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_group public.groups%rowtype;
  v_minimum integer;
  v_close_date date;
begin
  if v_user is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_request is null
    or p_name is null or char_length(btrim(p_name)) not between 1 and 70
    or jsonb_typeof(p_details) <> 'object'
    or p_visibility not in ('public', 'link')
    or p_delivery not between 0 and 9007199254740991 then
    raise exception 'invalid_group_details' using errcode = '22023';
  end if;

  select * into v_group from public.groups where id = p_group for update;
  if not found or v_group.status = 'cancelled' then
    raise exception 'group_unavailable' using errcode = 'P0002';
  end if;
  if v_group.owner_id <> v_user then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  v_minimum := nullif(p_details->>'minimumMembers', '')::integer;
  v_close_date := nullif(p_details->>'closesAt', '')::date;
  if v_minimum is null or v_minimum not between 2 and v_group.capacity
    or (v_group.billing_mode <> 'monthly' and (v_close_date is null or v_close_date < current_date))
    or p_details->>'visibilityMode' not in ('public', 'link', 'private') then
    raise exception 'invalid_group_details' using errcode = '22023';
  end if;
  if p_name = v_group.name and p_details = v_group.details
    and p_visibility = v_group.visibility
    and p_delivery = v_group.delivery_per_member_satang then
    return p_group;
  end if;

  update public.groups
  set name = btrim(p_name), details = p_details, visibility = p_visibility,
      delivery_per_member_satang = p_delivery,
      revision = revision + 1, status = 'awaiting_approval', updated_at = now()
  where id = p_group returning * into v_group;
  if p_visibility = 'link' then
    insert into private.group_invites(group_id)
    values (p_group)
    on conflict (group_id) do nothing;
  end if;
  delete from public.group_approvals where group_id = p_group;
  perform private.refresh_group_totals(p_group);
  perform private.record_group_event(
    p_group, v_group.revision, 'group_details_changed', v_user, p_request,
    jsonb_build_object('visibility', p_visibility)
  );
  return p_group;
end;
$$;

notify pgrst, 'reload schema';
