-- Request Marketplace (Phase 1): Request -> Offer -> Accept -> Reservation -> existing join.
--
-- Requesters post what they want; Hosts answer with a group they already own. Accepting an offer
-- holds a seat in that group; the requester then joins through private.join_group, the same path
-- as every other member, so seat pricing, approvals, chat and the admin-verified slip flow apply
-- unchanged. Nothing here moves money or marks anything as paid.
--
-- Clients only read these tables. Every write goes through the RPCs below, which take the user
-- from auth.uid(), compute prices from the group, and lock rows so seats cannot be oversold.
-- Money is in satang (bigint), like the rest of the schema.

-- ============================================================ tables
create table public.hk_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  requester_name text not null check (char_length(requester_name) between 1 and 70),
  product_id text references public.products(id) on delete set null,
  category text not null check (char_length(category) between 1 and 60),
  title text not null check (char_length(btrim(title)) between 3 and 80),
  description text not null default '' check (char_length(description) <= 600),
  budget_min_satang bigint check (budget_min_satang between 0 and 100000000),
  budget_max_satang bigint not null check (budget_max_satang between 0 and 100000000),
  -- One account fills one seat in group_members, so the MVP asks for one seat per request.
  seats_needed integer not null default 1 check (seats_needed = 1),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly', 'one_time')),
  status text not null default 'open'
    check (status in ('open', 'matched', 'completed', 'cancelled', 'expired')),
  offer_count integer not null default 0 check (offer_count >= 0),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (budget_min_satang is null or budget_min_satang <= budget_max_satang)
);

create table public.hk_request_offers (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.hk_requests(id) on delete cascade,
  host_id uuid not null references public.profiles(id) on delete cascade,
  host_name text not null check (char_length(host_name) between 1 and 70),
  -- Kept (set null) when the group is deleted so the history survives; the offer is cancelled first.
  group_id uuid references public.groups(id) on delete set null,
  offered_satang bigint not null check (offered_satang between 0 and 9007199254740991),
  seats_offered integer not null default 1 check (seats_offered = 1),
  message text not null default '' check (char_length(message) <= 400),
  group_snapshot jsonb not null check (jsonb_typeof(group_snapshot) = 'object'),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'withdrawn', 'expired', 'completed', 'cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One live offer per group per request (a withdrawn or rejected one may be re-sent).
create unique index hk_offers_one_live_per_group
  on public.hk_request_offers(request_id, group_id)
  where status in ('pending', 'accepted', 'completed');
-- A request has at most one accepted/completed offer.
create unique index hk_offers_one_accepted_per_request
  on public.hk_request_offers(request_id)
  where status in ('accepted', 'completed');

create table public.hk_group_reservations (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null unique references public.hk_request_offers(id) on delete cascade,
  request_id uuid not null references public.hk_requests(id) on delete cascade,
  group_id uuid references public.groups(id) on delete set null,
  requester_id uuid not null references public.profiles(id) on delete cascade,
  seats_reserved integer not null default 1 check (seats_reserved = 1),
  -- reserved: holds a seat; confirmed: the requester joined the group; expired/cancelled: released.
  status text not null default 'reserved' check (status in ('reserved', 'confirmed', 'expired', 'cancelled')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hk_request_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.hk_requests(id) on delete cascade,
  offer_id uuid references public.hk_request_offers(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type in (
    'request_created', 'request_updated', 'request_cancelled', 'request_expired',
    'offer_submitted', 'offer_accepted', 'offer_rejected', 'offer_withdrawn', 'offer_cancelled',
    'offer_expired', 'reservation_expired', 'join_started', 'join_completed')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);

create table public.hk_request_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid references public.hk_requests(id) on delete cascade,
  offer_id uuid references public.hk_request_offers(id) on delete cascade,
  type text not null check (type in (
    'offer_received', 'offer_accepted', 'offer_rejected', 'offer_withdrawn', 'offer_cancelled',
    'request_cancelled', 'request_expired', 'reservation_expired', 'join_completed')),
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index hk_requests_open_idx on public.hk_requests(created_at desc) where status = 'open';
create index hk_requests_status_expiry_idx on public.hk_requests(status, expires_at);
create index hk_requests_requester_idx on public.hk_requests(requester_id, created_at desc);
create index hk_requests_product_idx on public.hk_requests(product_id);
create index hk_offers_request_idx on public.hk_request_offers(request_id, status);
create index hk_offers_host_idx on public.hk_request_offers(host_id, created_at desc);
create index hk_offers_group_idx on public.hk_request_offers(group_id);
create index hk_reservations_group_idx on public.hk_group_reservations(group_id, status, expires_at);
create index hk_reservations_request_idx on public.hk_group_reservations(request_id);
create index hk_reservations_requester_idx on public.hk_group_reservations(requester_id);
create index hk_events_request_idx on public.hk_request_events(request_id, id);
create index hk_events_offer_idx on public.hk_request_events(offer_id);
create index hk_events_actor_idx on public.hk_request_events(actor_id);
create index hk_notifications_user_idx on public.hk_request_notifications(user_id, is_read, created_at desc);
create index hk_notifications_request_idx on public.hk_request_notifications(request_id);
create index hk_notifications_offer_idx on public.hk_request_notifications(offer_id);

-- ============================================================ access: read-only for clients
alter table public.hk_requests enable row level security;
alter table public.hk_request_offers enable row level security;
alter table public.hk_group_reservations enable row level security;
alter table public.hk_request_events enable row level security;
alter table public.hk_request_notifications enable row level security;
revoke all on public.hk_requests, public.hk_request_offers, public.hk_group_reservations,
  public.hk_request_events, public.hk_request_notifications from public, anon, authenticated;
grant select on public.hk_requests to anon, authenticated;
grant select on public.hk_request_offers, public.hk_group_reservations,
  public.hk_request_events, public.hk_request_notifications to authenticated;

-- Policies look across tables through these definer helpers, so they never recurse into each other.
create or replace function private.hk_owns_request(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (
    select 1 from public.hk_requests where id = p_request and requester_id = p_user);
$$;
create or replace function private.hk_offered_on(p_request uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (
    select 1 from public.hk_request_offers where request_id = p_request and host_id = p_user);
$$;
create or replace function private.hk_hosts_offer(p_offer uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_user is not null and exists (
    select 1 from public.hk_request_offers where id = p_offer and host_id = p_user);
$$;
revoke all on function private.hk_owns_request(uuid, uuid) from public;
revoke all on function private.hk_offered_on(uuid, uuid) from public;
revoke all on function private.hk_hosts_offer(uuid, uuid) from public;
grant execute on function private.hk_owns_request(uuid, uuid) to anon, authenticated;
grant execute on function private.hk_offered_on(uuid, uuid) to anon, authenticated;
grant execute on function private.hk_hosts_offer(uuid, uuid) to anon, authenticated;

create policy "Open requests are public; the people involved see the rest"
  on public.hk_requests for select to anon, authenticated using (
    (status = 'open' and expires_at > now())
    or requester_id = (select auth.uid())
    or private.hk_offered_on(id, (select auth.uid()))
    or private.is_admin()
  );

create policy "Offers are seen by their host and the request owner"
  on public.hk_request_offers for select to authenticated using (
    host_id = (select auth.uid())
    or private.hk_owns_request(request_id, (select auth.uid()))
    or private.is_admin()
  );

create policy "Reservations are seen by the requester and the group owner"
  on public.hk_group_reservations for select to authenticated using (
    requester_id = (select auth.uid())
    or private.hk_hosts_offer(offer_id, (select auth.uid()))
    or private.is_admin()
  );

create policy "Events are seen by the people involved"
  on public.hk_request_events for select to authenticated using (
    private.hk_owns_request(request_id, (select auth.uid()))
    or private.hk_hosts_offer(offer_id, (select auth.uid()))
    or private.is_admin()
  );

create policy "Notifications are read by their owner"
  on public.hk_request_notifications for select to authenticated
  using (user_id = (select auth.uid()));

grant execute on function private.is_admin() to anon;

-- ============================================================ helpers (private, not callable by clients)
create or replace function private.hk_log(
  p_request uuid, p_offer uuid, p_actor uuid, p_type text, p_meta jsonb default '{}'::jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.hk_request_events(request_id, offer_id, actor_id, event_type, metadata)
  values (p_request, p_offer, p_actor, p_type, coalesce(p_meta, '{}'::jsonb));
$$;

create or replace function private.hk_notify(p_user uuid, p_request uuid, p_offer uuid, p_type text)
returns void language sql security definer set search_path = '' as $$
  insert into public.hk_request_notifications(user_id, request_id, offer_id, type)
  select p_user, p_request, p_offer, p_type where p_user is not null;
$$;

-- Seats nobody holds yet: capacity minus members minus live reservations (other than p_except).
create or replace function private.hk_free_seats(p_group uuid, p_except uuid default null)
returns integer language sql stable security definer set search_path = '' as $$
  select g.capacity
    - (select count(*) from public.group_members m where m.group_id = g.id)::integer
    - (select coalesce(sum(r.seats_reserved), 0) from public.hk_group_reservations r
       where r.group_id = g.id and r.status = 'reserved' and r.expires_at > now()
         and r.requester_id is distinct from p_except)::integer
  from public.groups g where g.id = p_group;
$$;

-- What the next member would pay for one seat, from the group's own seat pricing.
create or replace function private.hk_next_seat_satang(p_group uuid)
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare
  v_group public.groups%rowtype;
  v_members uuid[];
  v_probe uuid := '00000000-0000-0000-0000-000000000000';
  v_amount bigint;
begin
  select * into v_group from public.groups where id = p_group;
  if not found or v_group.pricing_mode <> 'seat_v3' then return null; end if;
  v_members := private.group_seat_members(p_group);
  if coalesce(cardinality(v_members), 0) >= v_group.capacity then return null; end if;
  select s.amount_satang into v_amount
  from private.seat_amounts(v_group.owner_id, v_group.capacity, v_group.product_satang,
    v_group.delivery_per_member_satang, v_members || v_probe) s
  where s.user_id = v_probe;
  return v_amount;
end; $$;

-- Is this group able to take a new member right now (ignoring seats)?
create or replace function private.hk_group_open(p_group uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.groups g
    where g.id = p_group and g.status <> 'cancelled' and g.closed_at is null
      and g.pricing_mode = 'seat_v3'
      and not (coalesce(g.details->>'closesAt', '') <> '' and (g.details->>'closesAt')::date < current_date)
  );
$$;

-- Lazy expiry: called at the top of every RPC (and by clients through hk_sync) so time-outs
-- apply without a scheduler. Safe to run any number of times.
create or replace function private.hk_expire()
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  -- Reservations past their time give the seat back and reopen the request if it can still run.
  for r in
    update public.hk_group_reservations set status = 'expired', updated_at = now()
    where status = 'reserved' and expires_at <= now()
    returning id, offer_id, request_id, requester_id
  loop
    update public.hk_request_offers set status = 'cancelled', updated_at = now()
      where id = r.offer_id and status = 'accepted';
    update public.hk_requests set status = case when expires_at > now() then 'open' else 'expired' end,
      updated_at = now()
      where id = r.request_id and status = 'matched';
    perform private.hk_log(r.request_id, r.offer_id, null, 'reservation_expired');
    perform private.hk_notify(r.requester_id, r.request_id, r.offer_id, 'reservation_expired');
    perform private.hk_notify((select host_id from public.hk_request_offers where id = r.offer_id),
      r.request_id, r.offer_id, 'reservation_expired');
  end loop;

  for r in
    update public.hk_request_offers set status = 'expired', updated_at = now()
    where status = 'pending' and expires_at <= now()
    returning id, request_id
  loop
    perform private.hk_log(r.request_id, r.id, null, 'offer_expired');
  end loop;

  for r in
    update public.hk_requests set status = 'expired', updated_at = now()
    where status = 'open' and expires_at <= now()
    returning id, requester_id
  loop
    update public.hk_request_offers set status = 'expired', updated_at = now()
      where request_id = r.id and status = 'pending';
    perform private.hk_log(r.id, null, null, 'request_expired');
    perform private.hk_notify(r.requester_id, r.id, null, 'request_expired');
  end loop;
end; $$;

revoke all on function private.hk_log(uuid, uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function private.hk_notify(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function private.hk_free_seats(uuid, uuid) from public, anon, authenticated;
revoke all on function private.hk_next_seat_satang(uuid) from public, anon, authenticated;
revoke all on function private.hk_group_open(uuid) from public, anon, authenticated;
revoke all on function private.hk_expire() from public, anon, authenticated;

-- ============================================================ requester RPCs
create or replace function public.hk_create_request(
  p_title text, p_category text, p_budget_max_satang bigint,
  p_billing_cycle text default 'monthly', p_description text default '',
  p_budget_min_satang bigint default null, p_product_id text default null,
  p_expires_in_days integer default 7)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_name text; v_id uuid;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  perform private.hk_expire();
  select display_name into v_name from public.profiles where id = v_user;
  if v_name is null then raise exception 'profile_required' using errcode = '23514'; end if;
  if p_expires_in_days is null or p_expires_in_days not between 1 and 30 then
    raise exception 'invalid_request_expiry' using errcode = '22023';
  end if;
  if p_product_id is not null and not exists (select 1 from public.products where id = p_product_id and active) then
    raise exception 'product_unavailable' using errcode = 'P0002';
  end if;
  if (select count(*) from public.hk_requests where requester_id = v_user and status in ('open', 'matched')) >= 10 then
    raise exception 'too_many_open_requests' using errcode = '23514';
  end if;
  insert into public.hk_requests(requester_id, requester_name, product_id, category, title, description,
    budget_min_satang, budget_max_satang, billing_cycle, expires_at)
  values (v_user, v_name, p_product_id, btrim(p_category), btrim(p_title), btrim(coalesce(p_description, '')),
    p_budget_min_satang, p_budget_max_satang, p_billing_cycle, now() + make_interval(days => p_expires_in_days))
  returning id into v_id;
  perform private.hk_log(v_id, null, v_user, 'request_created');
  return v_id;
end; $$;

-- Only open requests with no live offers can be edited, so hosts never answer a moving target.
create or replace function public.hk_update_request(
  p_request uuid, p_title text, p_description text, p_budget_max_satang bigint,
  p_budget_min_satang bigint default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_req public.hk_requests%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  perform private.hk_expire();
  select * into v_req from public.hk_requests where id = p_request for update;
  if not found or v_req.requester_id <> v_user then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if v_req.status <> 'open' then raise exception 'request_not_open' using errcode = '23514'; end if;
  if exists (select 1 from public.hk_request_offers where request_id = p_request and status = 'pending') then
    raise exception 'request_has_offers' using errcode = '23514';
  end if;
  update public.hk_requests set title = btrim(p_title), description = btrim(coalesce(p_description, '')),
    budget_min_satang = p_budget_min_satang, budget_max_satang = p_budget_max_satang, updated_at = now()
  where id = p_request;
  perform private.hk_log(p_request, null, v_user, 'request_updated');
  return p_request;
end; $$;

create or replace function public.hk_cancel_request(p_request uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_req public.hk_requests%rowtype; r record;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  perform private.hk_expire();
  select * into v_req from public.hk_requests where id = p_request for update;
  if not found or v_req.requester_id <> v_user then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if v_req.status not in ('open', 'matched') then raise exception 'request_not_open' using errcode = '23514'; end if;
  update public.hk_group_reservations set status = 'cancelled', updated_at = now()
    where request_id = p_request and status = 'reserved';
  for r in
    update public.hk_request_offers set status = 'cancelled', updated_at = now()
    where request_id = p_request and status in ('pending', 'accepted')
    returning id, host_id
  loop
    perform private.hk_notify(r.host_id, p_request, r.id, 'request_cancelled');
  end loop;
  update public.hk_requests set status = 'cancelled', updated_at = now() where id = p_request;
  perform private.hk_log(p_request, null, v_user, 'request_cancelled');
  return p_request;
end; $$;

-- ============================================================ host RPCs
-- Hosts pick a group they own. The price is the group's own next-seat price, never a client number,
-- and is frozen in the snapshot. Offers live 72 hours or until the request ends.
create or replace function public.hk_submit_offer(p_request uuid, p_group uuid, p_message text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_req public.hk_requests%rowtype;
  v_group public.groups%rowtype;
  v_price bigint;
  v_name text;
  v_id uuid;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  perform private.hk_expire();
  select * into v_req from public.hk_requests where id = p_request for update;
  if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  if v_req.status <> 'open' or v_req.expires_at <= now() then raise exception 'request_not_open' using errcode = '23514'; end if;
  if v_req.requester_id = v_user then raise exception 'own_request' using errcode = '42501'; end if;
  select display_name into v_name from public.profiles where id = v_user;
  if v_name is null then raise exception 'profile_required' using errcode = '23514'; end if;
  select * into v_group from public.groups where id = p_group for update;
  if not found or v_group.owner_id <> v_user then raise exception 'group_not_owned' using errcode = '42501'; end if;
  if not private.hk_group_open(p_group) then raise exception 'group_unavailable' using errcode = '23514'; end if;
  if v_group.billing_mode <> v_req.billing_cycle then raise exception 'billing_mismatch' using errcode = '23514'; end if;
  if v_req.product_id is not null and v_group.listing_id <> v_req.product_id then
    raise exception 'product_mismatch' using errcode = '23514';
  end if;
  if not (v_req.category = v_group.category or v_req.category = any(v_group.categories)) then
    raise exception 'category_mismatch' using errcode = '23514';
  end if;
  if exists (select 1 from public.group_members where group_id = p_group and user_id = v_req.requester_id) then
    raise exception 'requester_already_member' using errcode = '23514';
  end if;
  if private.hk_free_seats(p_group) < v_req.seats_needed then raise exception 'full_group' using errcode = '23514'; end if;
  v_price := private.hk_next_seat_satang(p_group);
  if v_price is null then raise exception 'group_unavailable' using errcode = '23514'; end if;
  if v_price > v_req.budget_max_satang then raise exception 'over_budget' using errcode = '23514'; end if;
  begin
    insert into public.hk_request_offers(request_id, host_id, host_name, group_id, offered_satang, message, group_snapshot, expires_at)
    values (p_request, v_user, v_name, p_group, v_price, btrim(coalesce(p_message, '')),
      jsonb_build_object(
        'group_name', v_group.name, 'categories', to_jsonb(v_group.categories), 'listing_id', v_group.listing_id,
        'capacity', v_group.capacity, 'billing_cycle', v_group.billing_mode, 'pay_day', v_group.pay_day,
        'offered_satang', v_price, 'seats_offered', 1,
        'free_seats', private.hk_free_seats(p_group), 'captured_at', now()),
      least(now() + interval '72 hours', v_req.expires_at))
    returning id into v_id;
  exception when unique_violation then
    raise exception 'duplicate_offer' using errcode = '23505';
  end;
  update public.hk_requests set offer_count = offer_count + 1, updated_at = now() where id = p_request;
  perform private.hk_log(p_request, v_id, v_user, 'offer_submitted', jsonb_build_object('offered_satang', v_price));
  perform private.hk_notify(v_req.requester_id, p_request, v_id, 'offer_received');
  return v_id;
end; $$;

create or replace function public.hk_withdraw_offer(p_offer uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_offer public.hk_request_offers%rowtype; v_req public.hk_requests%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  perform private.hk_expire();
  select * into v_offer from public.hk_request_offers where id = p_offer;
  if not found or v_offer.host_id <> v_user then raise exception 'offer_not_found' using errcode = 'P0002'; end if;
  select * into v_req from public.hk_requests where id = v_offer.request_id for update;
  select * into v_offer from public.hk_request_offers where id = p_offer for update;
  if v_offer.status not in ('pending', 'accepted') then raise exception 'offer_not_pending' using errcode = '23514'; end if;
  if v_offer.status = 'accepted' then
    -- Backing out after acceptance releases the seat and reopens the request.
    update public.hk_group_reservations set status = 'cancelled', updated_at = now()
      where offer_id = p_offer and status = 'reserved';
    update public.hk_requests set status = case when expires_at > now() then 'open' else 'expired' end, updated_at = now()
      where id = v_offer.request_id and status = 'matched';
  end if;
  update public.hk_request_offers set status = 'withdrawn', updated_at = now() where id = p_offer;
  perform private.hk_log(v_offer.request_id, p_offer, v_user, 'offer_withdrawn');
  perform private.hk_notify(v_req.requester_id, v_offer.request_id, p_offer, 'offer_withdrawn');
  return p_offer;
end; $$;

-- ============================================================ matching RPCs
create or replace function public.hk_reject_offer(p_offer uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_offer public.hk_request_offers%rowtype; v_req public.hk_requests%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  perform private.hk_expire();
  select * into v_offer from public.hk_request_offers where id = p_offer;
  if not found then raise exception 'offer_not_found' using errcode = 'P0002'; end if;
  select * into v_req from public.hk_requests where id = v_offer.request_id for update;
  if v_req.requester_id <> v_user then raise exception 'offer_not_found' using errcode = 'P0002'; end if;
  select * into v_offer from public.hk_request_offers where id = p_offer for update;
  if v_offer.status <> 'pending' then raise exception 'offer_not_pending' using errcode = '23514'; end if;
  update public.hk_request_offers set status = 'rejected', updated_at = now() where id = p_offer;
  perform private.hk_log(v_req.id, p_offer, v_user, 'offer_rejected');
  perform private.hk_notify(v_offer.host_id, v_req.id, p_offer, 'offer_rejected');
  return p_offer;
end; $$;

-- Lock order everywhere: request, then group, then offer. The group row lock is the same one
-- private.join_group takes, so accepting and joining are serialized per group.
create or replace function public.hk_accept_offer(p_offer uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_offer public.hk_request_offers%rowtype;
  v_req public.hk_requests%rowtype;
  v_group public.groups%rowtype;
  v_res uuid;
  r record;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  perform private.hk_expire();
  select * into v_offer from public.hk_request_offers where id = p_offer;
  if not found then raise exception 'offer_not_found' using errcode = 'P0002'; end if;
  select * into v_req from public.hk_requests where id = v_offer.request_id for update;
  if v_req.requester_id <> v_user then raise exception 'offer_not_found' using errcode = 'P0002'; end if;
  if v_req.status <> 'open' or v_req.expires_at <= now() then raise exception 'request_not_open' using errcode = '23514'; end if;
  if v_offer.group_id is null then raise exception 'group_unavailable' using errcode = '23514'; end if;
  select * into v_group from public.groups where id = v_offer.group_id for update;
  select * into v_offer from public.hk_request_offers where id = p_offer for update;
  if v_offer.status <> 'pending' or v_offer.expires_at <= now() then raise exception 'offer_not_pending' using errcode = '23514'; end if;
  if v_group.id is null or v_group.owner_id <> v_offer.host_id or not private.hk_group_open(v_group.id) then
    raise exception 'group_unavailable' using errcode = '23514';
  end if;
  if exists (select 1 from public.group_members where group_id = v_group.id and user_id = v_user) then
    raise exception 'requester_already_member' using errcode = '23514';
  end if;
  if private.hk_free_seats(v_group.id) < v_req.seats_needed then raise exception 'full_group' using errcode = '23514'; end if;
  -- The group may have changed its prices since the offer: never charge more than was offered.
  if coalesce(private.hk_next_seat_satang(v_group.id), v_offer.offered_satang + 1) > v_offer.offered_satang then
    raise exception 'offer_price_changed' using errcode = '23514';
  end if;

  insert into public.hk_group_reservations(offer_id, request_id, group_id, requester_id, seats_reserved, expires_at)
  values (p_offer, v_req.id, v_group.id, v_user, v_req.seats_needed, now() + interval '24 hours')
  returning id into v_res;
  update public.hk_request_offers set status = 'accepted', updated_at = now() where id = p_offer;
  -- One offer per request: the rest are turned down.
  for r in
    update public.hk_request_offers set status = 'rejected', updated_at = now()
    where request_id = v_req.id and status = 'pending' and id <> p_offer
    returning id, host_id
  loop
    perform private.hk_log(v_req.id, r.id, v_user, 'offer_rejected', '{"reason":"another_offer_accepted"}');
    perform private.hk_notify(r.host_id, v_req.id, r.id, 'offer_rejected');
  end loop;
  update public.hk_requests set status = 'matched', updated_at = now() where id = v_req.id;
  perform private.hk_log(v_req.id, p_offer, v_user, 'offer_accepted', jsonb_build_object('reservation_id', v_res));
  perform private.hk_notify(v_offer.host_id, v_req.id, p_offer, 'offer_accepted');
  return v_res;
end; $$;

-- The requester takes the held seat through the normal join path (invite token supplied for
-- link-only groups). Payment then follows the group's existing admin-verified flow.
create or replace function public.hk_join_reserved_group(p_reservation uuid, p_request_key uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_res public.hk_group_reservations%rowtype;
  v_token uuid;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  perform private.hk_expire();
  select * into v_res from public.hk_group_reservations where id = p_reservation;
  if not found or v_res.requester_id <> v_user then raise exception 'reservation_not_found' using errcode = 'P0002'; end if;
  perform 1 from public.hk_requests where id = v_res.request_id for update;
  select * into v_res from public.hk_group_reservations where id = p_reservation for update;
  if v_res.status <> 'reserved' or v_res.expires_at <= now() or v_res.group_id is null then
    raise exception 'reservation_not_active' using errcode = '23514';
  end if;
  select token into v_token from private.group_invites where group_id = v_res.group_id;
  perform private.hk_log(v_res.request_id, v_res.offer_id, v_user, 'join_started');
  perform private.join_group(v_res.group_id, p_request_key, v_token);
  update public.hk_group_reservations set status = 'confirmed', updated_at = now() where id = p_reservation;
  update public.hk_request_offers set status = 'completed', updated_at = now() where id = v_res.offer_id;
  update public.hk_requests set status = 'completed', updated_at = now() where id = v_res.request_id;
  perform private.hk_log(v_res.request_id, v_res.offer_id, v_user, 'join_completed', jsonb_build_object('group_id', v_res.group_id));
  perform private.hk_notify((select host_id from public.hk_request_offers where id = v_res.offer_id),
    v_res.request_id, v_res.offer_id, 'join_completed');
  return v_res.group_id;
end; $$;

-- ============================================================ reads and notifications
-- Groups this host could offer for a request, with free seats and the next-seat price.
create or replace function public.hk_my_offerable_groups(p_request uuid)
returns table (group_id uuid, name text, capacity integer, free_seats integer, seat_satang bigint,
  billing_mode text, matches boolean, reason text)
language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_req public.hk_requests%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into v_req from public.hk_requests where id = p_request;
  if not found then raise exception 'request_not_found' using errcode = 'P0002'; end if;
  return query
    select g.id, g.name, g.capacity::integer, private.hk_free_seats(g.id), private.hk_next_seat_satang(g.id),
      g.billing_mode, x.reason is null, x.reason
    from public.groups g
    cross join lateral (select case
      when not private.hk_group_open(g.id) then 'group_unavailable'
      when g.billing_mode <> v_req.billing_cycle then 'billing_mismatch'
      when v_req.product_id is not null and g.listing_id <> v_req.product_id then 'product_mismatch'
      when not (v_req.category = g.category or v_req.category = any(g.categories)) then 'category_mismatch'
      when private.hk_free_seats(g.id) < v_req.seats_needed then 'full_group'
      when private.hk_next_seat_satang(g.id) > v_req.budget_max_satang then 'over_budget'
      when exists (select 1 from public.hk_request_offers o where o.request_id = p_request and o.group_id = g.id
                   and o.status in ('pending', 'accepted', 'completed')) then 'duplicate_offer'
      else null end as reason) x
    where g.owner_id = v_user and g.status <> 'cancelled' and g.closed_at is null
    order by x.reason is null desc, g.created_at desc;
end; $$;

create or replace function public.hk_mark_notifications_read(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_count integer;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  update public.hk_request_notifications set is_read = true
  where user_id = v_user and not is_read and (p_ids is null or id = any(p_ids));
  get diagnostics v_count = row_count;
  return v_count;
end; $$;

-- Lets a page apply expiries before it reads (no scheduler in this project).
create or replace function public.hk_sync()
returns void language sql security definer set search_path = '' as $$ select private.hk_expire(); $$;

-- ============================================================ keeping the existing group system honest
-- A held seat counts as taken: nobody else may join into it through the normal join path.
create or replace function private.hk_block_join_into_reserved_seat()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.hk_group_reservations r
             where r.group_id = new.group_id and r.status = 'reserved' and r.expires_at > now())
     and private.hk_free_seats(new.group_id, new.user_id) <= 0 then
    raise exception 'full_group' using errcode = '23514';
  end if;
  return new;
end; $$;
drop trigger if exists group_members_hk_reserved_seats on public.group_members;
create trigger group_members_hk_reserved_seats before insert on public.group_members
  for each row execute function private.hk_block_join_into_reserved_seat();

-- A group that goes away (deleted or cancelled) takes its offers and held seats with it.
create or replace function private.hk_release_group(p_group uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  update public.hk_group_reservations set status = 'cancelled', updated_at = now()
    where group_id = p_group and status = 'reserved';
  for r in
    update public.hk_request_offers set status = 'cancelled', updated_at = now()
    where group_id = p_group and status in ('pending', 'accepted')
    returning id, request_id, (select requester_id from public.hk_requests q where q.id = request_id) as requester_id
  loop
    update public.hk_requests set status = case when expires_at > now() then 'open' else 'expired' end, updated_at = now()
      where id = r.request_id and status = 'matched';
    perform private.hk_log(r.request_id, r.id, null, 'offer_cancelled', '{"reason":"group_unavailable"}');
    perform private.hk_notify(r.requester_id, r.request_id, r.id, 'offer_cancelled');
  end loop;
end; $$;

create or replace function private.hk_on_group_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.hk_release_group(old.id);
    return old;
  end if;
  if (new.status = 'cancelled' and old.status <> 'cancelled')
     or (new.closed_at is not null and old.closed_at is null) then
    perform private.hk_release_group(new.id);
  end if;
  return new;
end; $$;
drop trigger if exists groups_hk_release on public.groups;
create trigger groups_hk_release before delete or update of status, closed_at on public.groups
  for each row execute function private.hk_on_group_change();

revoke all on function private.hk_block_join_into_reserved_seat() from public, anon, authenticated;
revoke all on function private.hk_release_group(uuid) from public, anon, authenticated;
revoke all on function private.hk_on_group_change() from public, anon, authenticated;

-- ============================================================ grants
revoke all on function public.hk_create_request(text, text, bigint, text, text, bigint, text, integer) from public, anon;
revoke all on function public.hk_update_request(uuid, text, text, bigint, bigint) from public, anon;
revoke all on function public.hk_cancel_request(uuid) from public, anon;
revoke all on function public.hk_submit_offer(uuid, uuid, text) from public, anon;
revoke all on function public.hk_withdraw_offer(uuid) from public, anon;
revoke all on function public.hk_reject_offer(uuid) from public, anon;
revoke all on function public.hk_accept_offer(uuid) from public, anon;
revoke all on function public.hk_join_reserved_group(uuid, uuid) from public, anon;
revoke all on function public.hk_my_offerable_groups(uuid) from public, anon;
revoke all on function public.hk_mark_notifications_read(uuid[]) from public, anon;
revoke all on function public.hk_sync() from public;
grant execute on function public.hk_create_request(text, text, bigint, text, text, bigint, text, integer) to authenticated;
grant execute on function public.hk_update_request(uuid, text, text, bigint, bigint) to authenticated;
grant execute on function public.hk_cancel_request(uuid) to authenticated;
grant execute on function public.hk_submit_offer(uuid, uuid, text) to authenticated;
grant execute on function public.hk_withdraw_offer(uuid) to authenticated;
grant execute on function public.hk_reject_offer(uuid) to authenticated;
grant execute on function public.hk_accept_offer(uuid) to authenticated;
grant execute on function public.hk_join_reserved_group(uuid, uuid) to authenticated;
grant execute on function public.hk_my_offerable_groups(uuid) to authenticated;
grant execute on function public.hk_mark_notifications_read(uuid[]) to authenticated;
grant execute on function public.hk_sync() to anon, authenticated;

-- In-app notifications over Supabase Realtime (RLS still decides who receives what).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.hk_request_notifications;
  end if;
end $$;
