alter table public.groups add column if not exists categories text[] not null default '{}'::text[];
alter table public.groups add column if not exists images jsonb not null default '[]'::jsonb;

update public.groups set categories=array[category]
  where categories is null or cardinality(categories)=0;
update public.groups set images='[]'::jsonb where images is null;
alter table public.groups alter column categories set default '{}'::text[], alter column categories set not null;
alter table public.groups alter column images set default '[]'::jsonb, alter column images set not null;

do $$
begin
  if not exists(select 1 from pg_constraint where conname='groups_images_is_array' and conrelid='public.groups'::regclass) then
    alter table public.groups add constraint groups_images_is_array check(jsonb_typeof(images)='array');
  end if;
end;
$$;

create or replace function private.resolve_group_invite(p_group uuid,p_token uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from private.group_invites where group_id=p_group and token=p_token) then
    raise exception 'invite_invalid' using errcode='42501';
  end if;
  select jsonb_build_object(
    'id',g.id,'listing_id',g.listing_id,'owner_id',g.owner_id,'name',g.name,'category',g.category,
    'categories',g.categories,'images',g.images,'visibility',g.visibility,'capacity',g.capacity,
    'product_satang',g.product_satang,'delivery_per_member_satang',g.delivery_per_member_satang,
    'service_satang',g.service_satang,'total_satang',g.total_satang,'revision',g.revision,'status',g.status,
    'created_at',g.created_at,
    'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',m.display_name) order by m.joined_at) from public.group_members m where m.group_id=g.id),'[]'::jsonb),
    'approvals',coalesce((select jsonb_object_agg(a.user_id::text,a.revision) from public.group_approvals a where a.group_id=g.id),'{}'::jsonb),
    'history',coalesce((select jsonb_agg(jsonb_build_object('revision',e.revision,'event_type',e.event_type,'created_at',e.created_at) order by e.id) from public.group_events e where e.group_id=g.id),'[]'::jsonb)
  ) into v_result from public.groups g where g.id=p_group and g.status<>'cancelled';
  if v_result is null then raise exception 'group_unavailable' using errcode='P0002'; end if;
  return v_result;
end;
$$;

create or replace function private.create_group_with_metadata(
  p_listing text,
  p_request uuid,
  p_name text,
  p_categories text[],
  p_images jsonb,
  p_visibility text,
  p_capacity integer,
  p_delivery bigint,
  p_price bigint
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user uuid:=auth.uid();
  v_group uuid;
  v_images jsonb:=coalesce(p_images,'[]'::jsonb);
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_categories is null or cardinality(p_categories) not between 1 and 10
    or exists(select 1 from unnest(p_categories) as item(category) where category is null or char_length(btrim(category)) not between 1 and 60)
    or (select count(distinct category) from unnest(p_categories) as item(category))<>cardinality(p_categories) then
    raise exception 'invalid_group_categories' using errcode='22023';
  end if;
  if jsonb_typeof(v_images)<>'array' then
    raise exception 'invalid_group_images' using errcode='22023';
  end if;
  if jsonb_array_length(v_images)>4 or exists(select 1 from jsonb_array_elements(v_images) as item(value)
      where jsonb_typeof(value)<>'string' or char_length(value #>> '{}')>350000
        or value #>> '{}' !~ '^data:image/(jpeg|png|webp);base64,') then
    raise exception 'invalid_group_images' using errcode='22023';
  end if;

  v_group:=private.create_group(p_listing,p_request,p_name,p_categories[1],p_visibility,p_capacity,p_delivery,p_price);
  update public.groups set categories=p_categories,images=v_images
    where id=v_group and owner_id=v_user;
  return v_group;
end;
$$;

revoke all on function private.create_group_with_metadata(text,uuid,text,text[],jsonb,text,integer,bigint,bigint) from public,anon,authenticated;
grant execute on function private.create_group_with_metadata(text,uuid,text,text[],jsonb,text,integer,bigint,bigint) to authenticated;

create or replace function public.create_group_with_metadata(
  p_listing text,
  p_request uuid,
  p_name text,
  p_categories text[],
  p_images jsonb,
  p_visibility text,
  p_capacity integer,
  p_delivery bigint,
  p_price bigint
)
returns uuid
language sql
security invoker
set search_path=''
as $$
  select private.create_group_with_metadata(p_listing,p_request,p_name,p_categories,p_images,p_visibility,p_capacity,p_delivery,p_price)
$$;

revoke all on function public.create_group_with_metadata(text,uuid,text,text[],jsonb,text,integer,bigint,bigint) from public,anon,authenticated;
grant execute on function public.create_group_with_metadata(text,uuid,text,text[],jsonb,text,integer,bigint,bigint) to authenticated;

notify pgrst, 'reload schema';
