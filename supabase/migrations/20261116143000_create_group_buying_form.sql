alter table public.groups
  add column if not exists details jsonb not null default '{}'::jsonb;

alter table public.products
  add column if not exists details jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'groups_details_is_object'
      and conrelid = 'public.groups'::regclass
  ) then
    alter table public.groups
      add constraint groups_details_is_object
      check (jsonb_typeof(details) = 'object');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_details_is_object'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_details_is_object
      check (jsonb_typeof(details) = 'object');
  end if;
end;
$$;

insert into public.shops (id, name, intro, initials)
values ('community', 'กลุ่มผู้ใช้ HarnKhong', 'สินค้าที่สมาชิกเพิ่มเพื่อสร้างกลุ่มหารของ', 'HK')
on conflict (id) do nothing;

create or replace function private.create_group_from_form(
  p_request uuid,
  p_name text,
  p_categories text[],
  p_images jsonb,
  p_visibility text,
  p_capacity integer,
  p_delivery bigint,
  p_price bigint,
  p_product jsonb,
  p_details jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_listing text;
  v_group uuid;
  v_type text := p_product->>'type';
  v_category text := p_product->>'category';
  v_title text := btrim(coalesce(p_product->>'title', ''));
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
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
  if coalesce((v_details->>'minimumMembers')::integer, 0) not between 2 and p_capacity
    or nullif(v_details->>'closesAt', '') is null
    or (v_details->>'closesAt')::date < current_date then
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
  update public.groups set details = v_details where id = v_group and owner_id = v_user;
  return v_group;
end;
$$;

revoke all on function private.create_group_from_form(uuid,text,text[],jsonb,text,integer,bigint,bigint,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function private.create_group_from_form(uuid,text,text[],jsonb,text,integer,bigint,bigint,jsonb,jsonb)
  to authenticated;

create or replace function public.create_group_from_form(
  p_request uuid,
  p_name text,
  p_categories text[],
  p_images jsonb,
  p_visibility text,
  p_capacity integer,
  p_delivery bigint,
  p_price bigint,
  p_product jsonb,
  p_details jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_group_from_form(
    p_request, p_name, p_categories, p_images, p_visibility,
    p_capacity, p_delivery, p_price, p_product, p_details
  )
$$;

revoke all on function public.create_group_from_form(uuid,text,text[],jsonb,text,integer,bigint,bigint,jsonb,jsonb)
  from public, anon, authenticated;
grant execute on function public.create_group_from_form(uuid,text,text[],jsonb,text,integer,bigint,bigint,jsonb,jsonb)
  to authenticated;

notify pgrst, 'reload schema';

create or replace function private.join_group(p_group uuid,p_request uuid,p_token uuid default null)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_group public.groups%rowtype; v_name text;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_request is null then raise exception 'request_id_required' using errcode='22023'; end if;
  select * into v_group from public.groups where id=p_group for update;
  if not found or v_group.status='cancelled' then raise exception 'group_unavailable' using errcode='P0002'; end if;
  if exists(select 1 from public.group_members where group_id=p_group and user_id=v_user) then return p_group; end if;
  if coalesce(v_group.details->>'closesAt','') <> '' and (v_group.details->>'closesAt')::date < current_date then
    raise exception 'group_closed' using errcode='23514';
  end if;
  if v_group.visibility='link' and not exists(select 1 from private.group_invites where group_id=p_group and token=p_token) then raise exception 'invite_invalid' using errcode='42501'; end if;
  if (select count(*) from public.group_members where group_id=p_group)>=v_group.capacity then raise exception 'full_group' using errcode='23514'; end if;
  select display_name into v_name from public.profiles where id=v_user;
  if v_name is null then raise exception 'profile_required' using errcode='23514'; end if;
  insert into public.group_members(group_id,user_id,display_name) values(p_group,v_user,v_name);
  update public.groups set revision=revision+1,status='awaiting_approval',updated_at=now() where id=p_group returning * into v_group;
  delete from public.group_approvals where group_id=p_group;
  perform private.refresh_group_totals(p_group);
  perform private.record_group_event(p_group,v_group.revision,'member_joined',v_user,p_request,'{}'::jsonb);
  return p_group;
end; $$;

revoke all on function private.join_group(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function private.join_group(uuid,uuid,uuid) to authenticated;
