create table public.shops (
  id text primary key,
  name text not null,
  intro text not null default '',
  initials text not null default ''
);

create table public.products (
  id text primary key,
  seller_id text not null references public.shops(id),
  title text not null,
  category text not null,
  kind text not null check (kind in ('สินค้า', 'บริการ')),
  price_satang bigint not null check (price_satang between 0 and 9007199254740991),
  art text not null,
  mark text not null default '',
  description text not null default '',
  terms text not null default '',
  active boolean not null default true
);

insert into public.shops(id,name,intro,initials) values
  ('s1','ร้านบ้านแบ่งปัน','ของใช้คุณภาพสำหรับซื้อร่วมกัน','บป'),
  ('s2','สตูดิโอพร้อมพิมพ์','งานพิมพ์สำหรับทีมและชมรม','พพ');
insert into public.products(id,seller_id,title,category,kind,price_satang,art,mark,description,terms) values
  ('p1','s1','เซ็ตกระดาษ A4 5 รีม','สินค้าขายส่ง','สินค้า',64500,'paper','A4','กระดาษ A4 สำหรับทีมเรียนหรือสำนักงาน แพ็ก 5 รีม แบ่งรับตามจำนวนสมาชิก','รับของร่วมกันที่จุดนัดหมายภายในกรุงเทพฯ หรือคุยกับร้านเพื่อจัดส่งแยก'),
  ('p2','s1','กล่องข้าวรักษ์โลก 50 ใบ','ของใช้ทั่วไป','สินค้า',89000,'box','50','กล่องอาหารกระดาษพร้อมฝา สำหรับกิจกรรมและงานกลุ่ม','สินค้าเป็นแพ็กเดียว สมาชิกตกลงการแบ่งรับกันในกลุ่ม'),
  ('p3','s2','โปสเตอร์งานชมรม 20 แผ่น','บริการทั่วไป','บริการ',120000,'print','20','พิมพ์โปสเตอร์สีสำหรับกิจกรรมชมรมจากไฟล์ที่ลูกค้าจัดเตรียม','ส่งไฟล์ที่มีสิทธิ์ใช้งานให้ร้านก่อนผลิตจริง เงื่อนไขงานพิมพ์ยืนยันกับผู้ขายอีกครั้ง'),
  ('p4','s1','ชุดอุปกรณ์ทำความสะอาด','ของใช้ทั่วไป','สินค้า',56000,'clean','SET','ชุดของใช้ส่วนกลางสำหรับหอพักหรือออฟฟิศขนาดเล็ก','สินค้าเป็นชุดเดียว กรุณาตกลงการรับของร่วมกัน');

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.products(id),
  owner_id uuid not null references auth.users(id),
  request_id uuid not null,
  name text not null check (char_length(name) between 1 and 70),
  visibility text not null check (visibility in ('public','link')),
  capacity smallint not null check (capacity between 2 and 20),
  product_satang bigint not null check (product_satang between 0 and 9007199254740991),
  delivery_per_member_satang bigint not null check (delivery_per_member_satang between 0 and 9007199254740991),
  service_satang bigint not null default 0 check (service_satang between 0 and 9007199254740991),
  total_satang bigint not null default 0 check (total_satang between 0 and 9007199254740991),
  revision integer not null default 1 check (revision > 0),
  status text not null default 'awaiting_approval' check (status in ('awaiting_approval','ready','cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, request_id)
);
create index groups_public_created_idx on public.groups(created_at desc) where visibility='public' and status<>'cancelled';

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  display_name text not null check (char_length(display_name) between 1 and 70),
  joined_at timestamptz not null default now(),
  primary key(group_id,user_id)
);
create index group_members_user_idx on public.group_members(user_id,group_id);

create table public.group_approvals (
  group_id uuid not null,
  user_id uuid not null,
  revision integer not null,
  approved_at timestamptz not null default now(),
  primary key(group_id,user_id),
  foreign key(group_id,user_id) references public.group_members(group_id,user_id) on delete cascade
);

create table public.group_events (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  revision integer not null,
  event_type text not null check (event_type in ('group_created','member_joined','member_left','costs_changed','leadership_transferred','share_approved')),
  actor_id uuid not null references auth.users(id),
  request_id uuid not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(actor_id,request_id)
);
create index group_events_group_id_idx on public.group_events(group_id,id);

create table private.group_invites (
  group_id uuid primary key references public.groups(id) on delete cascade,
  token uuid not null unique default gen_random_uuid()
);
revoke all on private.group_invites from public,anon,authenticated;

alter table public.shops enable row level security;
alter table public.products enable row level security;
alter table public.groups enable row level security;
alter table public.group_members enable row level security;
alter table public.group_approvals enable row level security;
alter table public.group_events enable row level security;
revoke all on public.shops,public.products,public.groups,public.group_members,public.group_approvals,public.group_events from anon,authenticated;
grant select on public.shops,public.products,public.groups,public.group_members,public.group_approvals,public.group_events to anon,authenticated;
create policy "Active shops are public" on public.shops for select to anon,authenticated using(true);
create policy "Active products are public" on public.products for select to anon,authenticated using(active);

create or replace function private.is_group_member(p_group_id uuid,p_user_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select p_user_id is not null and exists(select 1 from public.group_members m where m.group_id=p_group_id and m.user_id=p_user_id) $$;
revoke all on function private.is_group_member(uuid,uuid) from public,anon,authenticated;
grant usage on schema private to anon,authenticated;
grant execute on function private.is_group_member(uuid,uuid) to anon,authenticated;

create policy "Public or participant groups visible" on public.groups for select to anon,authenticated using(
  (visibility='public' and status<>'cancelled') or owner_id=(select auth.uid()) or private.is_group_member(id,(select auth.uid()))
);
create policy "Public group or participant members visible" on public.group_members for select to anon,authenticated using(
  exists(select 1 from public.groups g where g.id=group_id and g.visibility='public' and g.status<>'cancelled')
  or private.is_group_member(group_id,(select auth.uid()))
);
create policy "Approvals visible to participants" on public.group_approvals for select to authenticated using(private.is_group_member(group_id,(select auth.uid())));
create policy "Public group or participant events visible" on public.group_events for select to anon,authenticated using(
  exists(select 1 from public.groups g where g.id=group_id and g.visibility='public' and g.status<>'cancelled')
  or private.is_group_member(group_id,(select auth.uid()))
);

create or replace function private.compute_group_totals(p_product bigint,p_delivery bigint,p_members integer)
returns table(service_satang bigint,total_satang bigint) language plpgsql immutable set search_path=''
as $$
declare v_subtotal numeric; v_fee numeric; v_total numeric;
begin
  if p_product not between 0 and 9007199254740991 or p_delivery not between 0 and 9007199254740991 or p_members not between 1 and 20 then
    raise exception 'invalid_group_costs' using errcode='22023';
  end if;
  v_subtotal:=p_product::numeric+p_delivery::numeric*p_members;
  v_fee:=floor((v_subtotal*2+50)/100);
  v_total:=v_subtotal+v_fee;
  if v_total>9007199254740991 then raise exception 'group_total_out_of_range' using errcode='22003'; end if;
  return query select v_fee::bigint,v_total::bigint;
end; $$;
revoke all on function private.compute_group_totals(bigint,bigint,integer) from public,anon,authenticated;

create or replace function private.refresh_group_totals(p_group_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_group public.groups%rowtype; v_count integer; v_fee bigint; v_total bigint;
begin
  select * into v_group from public.groups where id=p_group_id;
  select count(*) into v_count from public.group_members where group_id=p_group_id;
  select service_satang,total_satang into v_fee,v_total from private.compute_group_totals(v_group.product_satang,v_group.delivery_per_member_satang,v_count);
  update public.groups set service_satang=v_fee,total_satang=v_total
  where id=p_group_id;
end;
$$;
revoke all on function private.refresh_group_totals(uuid) from public,anon,authenticated;

create or replace function private.record_group_event(p_group_id uuid,p_revision integer,p_type text,p_actor uuid,p_request uuid,p_details jsonb default '{}'::jsonb)
returns void language sql security definer set search_path=''
as $$ insert into public.group_events(group_id,revision,event_type,actor_id,request_id,details) values(p_group_id,p_revision,p_type,p_actor,p_request,coalesce(p_details,'{}'::jsonb)) $$;
revoke all on function private.record_group_event(uuid,integer,text,uuid,uuid,jsonb) from public,anon,authenticated;

create or replace function private.create_group(p_listing text,p_request uuid,p_name text,p_visibility text,p_capacity integer,p_delivery bigint)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_id uuid; v_price bigint; v_name text; v_check_total bigint;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  if p_request is null or p_name is null or char_length(btrim(p_name)) not between 1 and 70 or p_visibility not in('public','link') or p_capacity not between 2 and 20 or p_delivery not between 0 and 9007199254740991 then raise exception 'invalid_group_details' using errcode='22023'; end if;
  select price_satang into v_price from public.products where id=p_listing and active;
  if not found then raise exception 'product_unavailable' using errcode='22023'; end if;
  select total_satang into v_check_total from private.compute_group_totals(v_price,p_delivery,p_capacity);
  select display_name into v_name from public.profiles where id=v_user;
  if v_name is null then raise exception 'profile_required' using errcode='23514'; end if;
  insert into public.groups(listing_id,owner_id,request_id,name,visibility,capacity,product_satang,delivery_per_member_satang)
    values(p_listing,v_user,p_request,btrim(p_name),p_visibility,p_capacity,v_price,p_delivery)
    on conflict(owner_id,request_id) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from public.groups where owner_id=v_user and request_id=p_request;
    if not exists(select 1 from public.groups where id=v_id and listing_id=p_listing and name=btrim(p_name) and visibility=p_visibility and capacity=p_capacity and delivery_per_member_satang=p_delivery) then raise exception 'request_id_reused' using errcode='22023'; end if;
    return v_id;
  end if;
  insert into public.group_members(group_id,user_id,display_name) values(v_id,v_user,v_name);
  if p_visibility='link' then insert into private.group_invites(group_id) values(v_id); end if;
  perform private.refresh_group_totals(v_id);
  perform private.record_group_event(v_id,1,'group_created',v_user,p_request,jsonb_build_object('visibility',p_visibility));
  return v_id;
end; $$;

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

create or replace function private.leave_group(p_group uuid,p_request uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_group public.groups%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select * into v_group from public.groups where id=p_group for update;
  if not found then raise exception 'group_unavailable' using errcode='P0002'; end if;
  if v_group.owner_id=v_user then raise exception 'owner_must_transfer' using errcode='23514'; end if;
  delete from public.group_members where group_id=p_group and user_id=v_user;
  if not found then raise exception 'not_group_member' using errcode='42501'; end if;
  update public.groups set revision=revision+1,status='awaiting_approval',updated_at=now() where id=p_group returning * into v_group;
  delete from public.group_approvals where group_id=p_group;
  perform private.refresh_group_totals(p_group);
  perform private.record_group_event(p_group,v_group.revision,'member_left',v_user,p_request,'{}'::jsonb);
  return p_group;
end; $$;

create or replace function private.approve_group(p_group uuid,p_revision integer,p_request uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_group public.groups%rowtype; v_count integer; v_approved integer;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select * into v_group from public.groups where id=p_group for update;
  if not found or not exists(select 1 from public.group_members where group_id=p_group and user_id=v_user) then raise exception 'not_group_member' using errcode='42501'; end if;
  if p_revision<>v_group.revision then raise exception 'stale_revision' using errcode='40001'; end if;
  if exists(select 1 from public.group_approvals where group_id=p_group and user_id=v_user and revision=p_revision) then return p_group; end if;
  insert into public.group_approvals(group_id,user_id,revision) values(p_group,v_user,p_revision)
    on conflict(group_id,user_id) do update set revision=excluded.revision,approved_at=now();
  perform private.record_group_event(p_group,p_revision,'share_approved',v_user,p_request,'{}'::jsonb);
  select count(*) into v_count from public.group_members where group_id=p_group;
  select count(*) into v_approved from public.group_approvals where group_id=p_group and revision=p_revision;
  update public.groups set status=case when v_count=capacity and v_count=v_approved then 'ready' else 'awaiting_approval' end where id=p_group;
  return p_group;
end; $$;

create or replace function private.change_group_delivery(p_group uuid,p_delivery bigint,p_request uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_group public.groups%rowtype; v_check_total bigint;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select * into v_group from public.groups where id=p_group for update;
  if not found or v_group.owner_id<>v_user then raise exception 'owner_only' using errcode='42501'; end if;
  if p_delivery not between 0 and 9007199254740991 then raise exception 'invalid_cost' using errcode='22023'; end if;
  if p_delivery=v_group.delivery_per_member_satang then return p_group; end if;
  select total_satang into v_check_total from private.compute_group_totals(v_group.product_satang,p_delivery,v_group.capacity);
  update public.groups set delivery_per_member_satang=p_delivery,revision=revision+1,status='awaiting_approval',updated_at=now() where id=p_group returning * into v_group;
  delete from public.group_approvals where group_id=p_group;
  perform private.refresh_group_totals(p_group);
  perform private.record_group_event(p_group,v_group.revision,'costs_changed',v_user,p_request,jsonb_build_object('delivery_per_member_satang',p_delivery));
  return p_group;
end; $$;

create or replace function private.transfer_group_owner(p_group uuid,p_next_owner uuid,p_request uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_group public.groups%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select * into v_group from public.groups where id=p_group for update;
  if not found then raise exception 'group_unavailable' using errcode='P0002'; end if;
  if v_group.owner_id=p_next_owner then return p_group; end if;
  if v_group.owner_id<>v_user then raise exception 'owner_only' using errcode='42501'; end if;
  if p_next_owner=v_user or not exists(select 1 from public.group_members where group_id=p_group and user_id=p_next_owner) then raise exception 'invalid_transfer' using errcode='22023'; end if;
  update public.groups set owner_id=p_next_owner,updated_at=now() where id=p_group;
  perform private.record_group_event(p_group,v_group.revision,'leadership_transferred',v_user,p_request,jsonb_build_object('new_owner_id',p_next_owner));
  return p_group;
end; $$;

create or replace function private.get_group_invite(p_group uuid)
returns uuid language plpgsql security definer set search_path=''
as $$declare v_user uuid:=auth.uid(); v_token uuid;
begin
  if v_user is null or not exists(select 1 from public.groups where id=p_group and owner_id=v_user and visibility='link') then raise exception 'owner_only' using errcode='42501'; end if;
  select token into v_token from private.group_invites where group_id=p_group; return v_token;
end; $$;

create or replace function private.resolve_group_invite(p_group uuid,p_token uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$declare v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from private.group_invites where group_id=p_group and token=p_token) then raise exception 'invite_invalid' using errcode='42501'; end if;
  select jsonb_build_object('id',g.id,'listing_id',g.listing_id,'owner_id',g.owner_id,'name',g.name,'visibility',g.visibility,'capacity',g.capacity,'product_satang',g.product_satang,'delivery_per_member_satang',g.delivery_per_member_satang,'service_satang',g.service_satang,'total_satang',g.total_satang,'revision',g.revision,'status',g.status,'created_at',g.created_at,'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',m.display_name) order by m.joined_at) from public.group_members m where m.group_id=g.id),'[]'::jsonb),'approvals',coalesce((select jsonb_object_agg(a.user_id::text,a.revision) from public.group_approvals a where a.group_id=g.id),'{}'::jsonb),'history',coalesce((select jsonb_agg(jsonb_build_object('revision',e.revision,'event_type',e.event_type,'created_at',e.created_at) order by e.id) from public.group_events e where e.group_id=g.id),'[]'::jsonb)) into v_result from public.groups g where g.id=p_group and g.status<>'cancelled';
  if v_result is null then raise exception 'group_unavailable' using errcode='P0002'; end if;
  return v_result;
end; $$;

revoke all on function private.create_group(text,uuid,text,text,integer,bigint) from public,anon,authenticated;
revoke all on function private.join_group(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function private.leave_group(uuid,uuid) from public,anon,authenticated;
revoke all on function private.approve_group(uuid,integer,uuid) from public,anon,authenticated;
revoke all on function private.change_group_delivery(uuid,bigint,uuid) from public,anon,authenticated;
revoke all on function private.transfer_group_owner(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function private.get_group_invite(uuid) from public,anon,authenticated;
revoke all on function private.resolve_group_invite(uuid,uuid) from public,anon,authenticated;
grant execute on function private.create_group(text,uuid,text,text,integer,bigint) to authenticated;
grant execute on function private.join_group(uuid,uuid,uuid) to authenticated;
grant execute on function private.leave_group(uuid,uuid) to authenticated;
grant execute on function private.approve_group(uuid,integer,uuid) to authenticated;
grant execute on function private.change_group_delivery(uuid,bigint,uuid) to authenticated;
grant execute on function private.transfer_group_owner(uuid,uuid,uuid) to authenticated;
grant execute on function private.get_group_invite(uuid) to authenticated;
grant execute on function private.resolve_group_invite(uuid,uuid) to authenticated;

create or replace function public.create_group(p_listing text,p_request uuid,p_name text,p_visibility text,p_capacity integer,p_delivery bigint)
returns uuid language sql security invoker set search_path='' as $$ select private.create_group(p_listing,p_request,p_name,p_visibility,p_capacity,p_delivery) $$;
create or replace function public.join_group(p_group uuid,p_request uuid,p_token uuid default null)
returns uuid language sql security invoker set search_path='' as $$ select private.join_group(p_group,p_request,p_token) $$;
create or replace function public.leave_group(p_group uuid,p_request uuid)
returns uuid language sql security invoker set search_path='' as $$ select private.leave_group(p_group,p_request) $$;
create or replace function public.approve_group(p_group uuid,p_revision integer,p_request uuid)
returns uuid language sql security invoker set search_path='' as $$ select private.approve_group(p_group,p_revision,p_request) $$;
create or replace function public.change_group_delivery(p_group uuid,p_delivery bigint,p_request uuid)
returns uuid language sql security invoker set search_path='' as $$ select private.change_group_delivery(p_group,p_delivery,p_request) $$;
create or replace function public.transfer_group_owner(p_group uuid,p_next_owner uuid,p_request uuid)
returns uuid language sql security invoker set search_path='' as $$ select private.transfer_group_owner(p_group,p_next_owner,p_request) $$;
create or replace function public.get_group_invite(p_group uuid)
returns uuid language sql security invoker set search_path='' as $$ select private.get_group_invite(p_group) $$;
create or replace function public.resolve_group_invite(p_group uuid,p_token uuid)
returns jsonb language sql security invoker set search_path='' as $$ select private.resolve_group_invite(p_group,p_token) $$;

revoke all on function public.create_group(text,uuid,text,text,integer,bigint) from public,anon,authenticated;
revoke all on function public.join_group(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.leave_group(uuid,uuid) from public,anon,authenticated;
revoke all on function public.approve_group(uuid,integer,uuid) from public,anon,authenticated;
revoke all on function public.change_group_delivery(uuid,bigint,uuid) from public,anon,authenticated;
revoke all on function public.transfer_group_owner(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.get_group_invite(uuid) from public,anon,authenticated;
revoke all on function public.resolve_group_invite(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_group(text,uuid,text,text,integer,bigint) to authenticated;
grant execute on function public.join_group(uuid,uuid,uuid) to authenticated;
grant execute on function public.leave_group(uuid,uuid) to authenticated;
grant execute on function public.approve_group(uuid,integer,uuid) to authenticated;
grant execute on function public.change_group_delivery(uuid,bigint,uuid) to authenticated;
grant execute on function public.transfer_group_owner(uuid,uuid,uuid) to authenticated;
grant execute on function public.get_group_invite(uuid) to authenticated;
grant execute on function public.resolve_group_invite(uuid,uuid) to authenticated;

create trigger groups_set_updated_at before update on public.groups for each row execute function private.set_updated_at();
