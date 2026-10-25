alter table public.groups add column category text not null default 'ของใช้ทั่วไป';
update public.groups g set category=p.category from public.products p where p.id=g.listing_id;

create or replace function private.create_group(
  p_listing text,
  p_request uuid,
  p_name text,
  p_category text,
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
  v_id uuid;
  v_name text;
  v_check_total bigint;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_request is null or p_name is null or char_length(btrim(p_name)) not between 1 and 70
    or p_category is null or char_length(btrim(p_category)) not between 1 and 60
    or p_visibility not in('public','link') or p_capacity not between 2 and 20
    or p_delivery not between 0 and 9007199254740991
    or p_price not between 0 and 9007199254740991 then
    raise exception 'invalid_group_details' using errcode='22023';
  end if;
  if not exists(select 1 from public.products where id=p_listing and active) then
    raise exception 'product_unavailable' using errcode='22023';
  end if;
  select total_satang into v_check_total from private.compute_group_totals(p_price,p_delivery,p_capacity);
  select display_name into v_name from public.profiles where id=v_user;
  if v_name is null then raise exception 'profile_required' using errcode='23514'; end if;
  insert into public.groups(listing_id,owner_id,request_id,name,category,visibility,capacity,product_satang,delivery_per_member_satang)
    values(p_listing,v_user,p_request,btrim(p_name),btrim(p_category),p_visibility,p_capacity,p_price,p_delivery)
    on conflict(owner_id,request_id) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.groups where owner_id=v_user and request_id=p_request;
    if not exists(select 1 from public.groups where id=v_id and listing_id=p_listing and name=btrim(p_name) and category=btrim(p_category)
      and visibility=p_visibility and capacity=p_capacity and product_satang=p_price
      and delivery_per_member_satang=p_delivery) then
      raise exception 'request_id_reused' using errcode='22023';
    end if;
    return v_id;
  end if;
  insert into public.group_members(group_id,user_id,display_name) values(v_id,v_user,v_name);
  if p_visibility='link' then insert into private.group_invites(group_id) values(v_id); end if;
  perform private.refresh_group_totals(v_id);
  perform private.record_group_event(v_id,1,'group_created',v_user,p_request,jsonb_build_object('visibility',p_visibility));
  return v_id;
end;
$$;

create or replace function public.create_group(
  p_listing text,
  p_request uuid,
  p_name text,
  p_category text,
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
  select private.create_group(p_listing,p_request,p_name,p_category,p_visibility,p_capacity,p_delivery,p_price)
$$;

revoke all on function private.create_group(text,uuid,text,text,text,integer,bigint,bigint) from public,anon,authenticated;
grant execute on function private.create_group(text,uuid,text,text,text,integer,bigint,bigint) to authenticated;
revoke all on function public.create_group(text,uuid,text,text,text,integer,bigint,bigint) from public,anon,authenticated;
grant execute on function public.create_group(text,uuid,text,text,text,integer,bigint,bigint) to authenticated;
