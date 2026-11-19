-- P0 billing: fixed seat prices with an owner-only 2% fee, monthly group cycles,
-- and the HarnKhong Plus subscription paid by transfer slip and verified by an admin.
--
-- Existing groups keep pricing_mode 'per_member_v2' and their approved amounts.
-- Every group created from now on uses 'seat_v3'.

-- ============================================================ groups: pricing and billing mode
alter table public.groups
  add column if not exists pricing_mode text not null default 'per_member_v2',
  add column if not exists billing_mode text not null default 'one_time',
  add column if not exists cycle_anchor timestamptz;
alter table public.groups drop constraint if exists groups_pricing_mode_check;
alter table public.groups add constraint groups_pricing_mode_check
  check (pricing_mode in ('per_member_v2', 'seat_v3'));
alter table public.groups drop constraint if exists groups_billing_mode_check;
alter table public.groups add constraint groups_billing_mode_check
  check (billing_mode in ('one_time', 'monthly'));
alter table public.groups drop constraint if exists groups_monthly_seat_pricing_check;
alter table public.groups add constraint groups_monthly_seat_pricing_check
  check (billing_mode = 'one_time' or pricing_mode = 'seat_v3');
alter table public.groups alter column pricing_mode set default 'seat_v3';

-- Seat amounts for a seat_v3 group: the product cost is split over every seat (remainder satang
-- to the lowest seats), each seat adds its own delivery. The owner holds seat 0, the others follow
-- join order. The owner also covers every empty seat and alone pays the 2% fee.
create or replace function private.seat_amounts(
  p_owner uuid, p_capacity integer, p_product bigint, p_delivery bigint, p_members uuid[]
)
returns table (user_id uuid, seat_index integer, amount_satang bigint)
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_count integer := coalesce(cardinality(p_members), 0);
  v_base bigint;
  v_rem bigint;
  v_fee bigint;
  v_empty bigint;
begin
  if p_capacity not between 2 and 20 or v_count not between 1 and p_capacity
    or p_product not between 0 and 9007199254740991 or p_delivery not between 0 and 9007199254740991
    or p_members[1] is distinct from p_owner then
    raise exception 'invalid_seat_pricing' using errcode = '22023';
  end if;
  v_base := p_product / p_capacity;
  v_rem := mod(p_product, p_capacity);
  v_fee := floor(((p_product::numeric + p_delivery::numeric * p_capacity) * 2 + 50) / 100)::bigint;
  v_empty := (p_capacity - v_count) * (v_base + p_delivery) + greatest(0, v_rem - v_count);
  return query
    select m.id,
           (m.ord - 1)::integer,
           v_base + case when m.ord - 1 < v_rem then 1 else 0 end + p_delivery
             + case when m.ord = 1 then v_empty + v_fee else 0 end
    from unnest(p_members) with ordinality as m(id, ord);
end;
$$;

-- Members of a group in seat order: owner first, then by join time.
create or replace function private.group_seat_members(p_group uuid)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select array_agg(m.user_id order by (m.user_id = g.owner_id) desc, m.joined_at, m.user_id)
  from public.group_members m
  join public.groups g on g.id = m.group_id
  where m.group_id = p_group;
$$;

create or replace function private.group_member_amount(p_group uuid, p_user uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_amount bigint;
begin
  select * into v_group from public.groups where id = p_group;
  if not found or v_group.pricing_mode <> 'seat_v3' then
    raise exception 'seat_pricing_required' using errcode = '22023';
  end if;
  select s.amount_satang into v_amount
  from private.seat_amounts(v_group.owner_id, v_group.capacity, v_group.product_satang,
    v_group.delivery_per_member_satang, private.group_seat_members(p_group)) s
  where s.user_id = p_user;
  return v_amount;
end;
$$;

-- Totals: seat_v3 groups price every seat, so the total never moves when people join or leave.
create or replace function private.refresh_group_totals(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_count integer;
  v_fee bigint;
  v_total bigint;
begin
  select * into v_group from public.groups where id = p_group_id;
  select count(*) into v_count from public.group_members where group_id = p_group_id;
  select service_satang, total_satang into v_fee, v_total
  from private.compute_group_totals(
    v_group.product_satang,
    v_group.delivery_per_member_satang,
    case when v_group.pricing_mode = 'seat_v3' then v_group.capacity else greatest(v_count, 1) end
  );
  update public.groups set service_satang = v_fee, total_satang = v_total where id = p_group_id;
end;
$$;

-- ============================================================ Plus subscription
create table if not exists public.subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'plus')),
  status text not null default 'none' check (status in ('none', 'pending_payment', 'active', 'expired')),
  period_start timestamptz,
  period_end timestamptz,
  updated_at timestamptz not null default now(),
  check (status <> 'active' or (period_start is not null and period_end > period_start))
);

create table if not exists public.subscription_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  amount_satang bigint not null default 4900 check (amount_satang = 4900),
  status text not null default 'reported' check (status in ('reported', 'verified', 'rejected')),
  slip_path text not null,
  transferred_at timestamptz not null,
  reported_at timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete restrict,
  covers_from timestamptz,
  covers_to timestamptz,
  rejection_note text check (rejection_note is null or char_length(rejection_note) <= 500),
  check ((status = 'verified') = (verified_at is not null and verified_by is not null and covers_from is not null and covers_to is not null))
);
create unique index if not exists subscription_payments_one_pending_idx
  on public.subscription_payments (user_id) where status = 'reported';
create index if not exists subscription_payments_reported_idx
  on public.subscription_payments (reported_at desc) where status = 'reported';
create index if not exists subscription_payments_user_idx
  on public.subscription_payments (user_id, reported_at desc);
create index if not exists subscription_payments_verified_by_idx
  on public.subscription_payments (verified_by);

alter table public.subscriptions enable row level security;
alter table public.subscription_payments enable row level security;
revoke all on public.subscriptions, public.subscription_payments from public, anon, authenticated;
grant select on public.subscriptions, public.subscription_payments to authenticated;
grant select, insert, update on public.subscriptions, public.subscription_payments to service_role;
drop policy if exists "Members read their own subscription" on public.subscriptions;
create policy "Members read their own subscription" on public.subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Members read their own subscription payments" on public.subscription_payments;
create policy "Members read their own subscription payments" on public.subscription_payments
  for select to authenticated using ((select auth.uid()) = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('subscription-payment-slips', 'subscription-payment-slips', false, 8388608,
  array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "Members upload their own subscription slips" on storage.objects;
create policy "Members upload their own subscription slips" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'subscription-payment-slips'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- Same day next month; a missing day clamps to the month's last day (Postgres interval does this).
create or replace function private.add_month(p_at timestamptz, p_months integer default 1)
returns timestamptz
language sql
immutable
set search_path = ''
as $$ select (p_at at time zone 'UTC' + make_interval(months => p_months)) at time zone 'UTC' $$;

-- The plan that applies now. Marks an ended Plus period as expired on the way.
create or replace function private.effective_plan(p_user uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sub public.subscriptions%rowtype;
begin
  select * into v_sub from public.subscriptions where user_id = p_user;
  if not found then return 'free'; end if;
  if v_sub.status = 'active' and v_sub.period_end <= now() then
    update public.subscriptions set status = 'expired', plan = 'free', updated_at = now()
    where user_id = p_user and status = 'active';
    return 'free';
  end if;
  return case when v_sub.status = 'active' then v_sub.plan else 'free' end;
end;
$$;

create or replace function public.my_subscription()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_plan text;
  v_sub public.subscriptions%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  v_plan := private.effective_plan(v_user);
  select * into v_sub from public.subscriptions where user_id = v_user;
  return jsonb_build_object(
    'plan', v_plan,
    'status', coalesce(v_sub.status, 'none'),
    'periodStart', v_sub.period_start,
    'periodEnd', v_sub.period_end,
    'groupLimit', case when v_plan = 'plus' then 5 else 2 end,
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'amount', p.amount_satang, 'status', p.status, 'reportedAt', p.reported_at,
        'verifiedAt', p.verified_at, 'coversFrom', p.covers_from, 'coversTo', p.covers_to,
        'note', p.rejection_note) order by p.reported_at desc)
      from public.subscription_payments p where p.user_id = v_user), '[]'::jsonb)
  );
end;
$$;

create or replace function public.report_subscription_payment(p_slip_path text, p_transferred_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_parts text[] := string_to_array(coalesce(p_slip_path, ''), '/');
  v_payment public.subscription_payments%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_transferred_at is null or p_transferred_at > now() + interval '10 minutes' then
    raise exception 'invalid_transfer_time' using errcode = '23514';
  end if;
  if cardinality(v_parts) <> 2 or v_parts[1] <> v_user::text
    or v_parts[2] !~ '^[a-f0-9-]{36}\.(jpg|jpeg|png|webp)$' then
    raise exception 'invalid_payment_slip_path' using errcode = '23514';
  end if;
  if not exists (select 1 from storage.objects o
                 where o.bucket_id = 'subscription-payment-slips' and o.name = p_slip_path) then
    raise exception 'payment_slip_missing' using errcode = '23514';
  end if;
  if exists (select 1 from public.subscription_payments where user_id = v_user and status = 'reported') then
    raise exception 'payment_pending' using errcode = '23505';
  end if;
  perform private.effective_plan(v_user);
  insert into public.subscriptions (user_id, status) values (v_user, 'pending_payment')
  on conflict (user_id) do update
    set status = case when public.subscriptions.status = 'active' then 'active' else 'pending_payment' end,
        updated_at = now();
  insert into public.subscription_payments (user_id, slip_path, transferred_at)
  values (v_user, p_slip_path, p_transferred_at)
  returning * into v_payment;
  return jsonb_build_object('id', v_payment.id, 'status', v_payment.status, 'amount', v_payment.amount_satang);
end;
$$;

-- Admin verification: a new month starts now, or right after the month already paid for.
create or replace function public.verify_subscription_payment(p_payment uuid, p_verified_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.subscription_payments%rowtype;
  v_sub public.subscriptions%rowtype;
  v_start timestamptz;
  v_end timestamptz;
begin
  if p_verified_by is null then raise exception 'verifier_required' using errcode = '22023'; end if;
  select * into v_payment from public.subscription_payments where id = p_payment for update;
  if not found then raise exception 'payment_not_found' using errcode = 'P0002'; end if;
  if v_payment.status <> 'reported' then raise exception 'payment_not_pending' using errcode = '23514'; end if;
  select * into v_sub from public.subscriptions where user_id = v_payment.user_id for update;
  v_start := case when v_sub.status = 'active' and v_sub.period_end > now() then v_sub.period_end else now() end;
  v_end := private.add_month(v_start);
  update public.subscription_payments
  set status = 'verified', verified_at = now(), verified_by = p_verified_by,
      covers_from = v_start, covers_to = v_end
  where id = p_payment;
  insert into public.subscriptions (user_id, plan, status, period_start, period_end)
  values (v_payment.user_id, 'plus', 'active', v_start, v_end)
  on conflict (user_id) do update
    set plan = 'plus',
        status = 'active',
        period_start = case when public.subscriptions.status = 'active'
                             and public.subscriptions.period_end > now()
                            then public.subscriptions.period_start else v_start end,
        period_end = v_end,
        updated_at = now();
  return jsonb_build_object('paymentId', p_payment, 'userId', v_payment.user_id,
    'coversFrom', v_start, 'coversTo', v_end);
end;
$$;

create or replace function public.reject_subscription_payment(p_payment uuid, p_verified_by uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.subscription_payments%rowtype;
begin
  select * into v_payment from public.subscription_payments where id = p_payment for update;
  if not found then raise exception 'payment_not_found' using errcode = 'P0002'; end if;
  if v_payment.status <> 'reported' then raise exception 'payment_not_pending' using errcode = '23514'; end if;
  update public.subscription_payments
  set status = 'rejected', rejection_note = left(nullif(btrim(coalesce(p_note, '')), ''), 500)
  where id = p_payment;
  update public.subscriptions
  set status = case when period_end is null then 'none' else 'expired' end, updated_at = now()
  where user_id = v_payment.user_id and status = 'pending_payment';
  return jsonb_build_object('paymentId', p_payment, 'status', 'rejected');
end;
$$;

-- ============================================================ monthly group cycles
create table if not exists public.group_cycles (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  cycle_number integer not null check (cycle_number > 0),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'awaiting_confirmation'
    check (status in ('awaiting_confirmation', 'confirmed', 'paid', 'closed')),
  closed_from text check (closed_from is null or closed_from in ('awaiting_confirmation', 'confirmed', 'paid')),
  capacity smallint not null,
  product_satang bigint not null,
  delivery_per_member_satang bigint not null,
  service_satang bigint not null,
  total_satang bigint not null,
  created_at timestamptz not null default now(),
  unique (group_id, cycle_number),
  check (ends_at > starts_at)
);

create table if not exists public.group_cycle_members (
  cycle_id uuid not null references public.group_cycles(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete restrict,
  seat_index integer not null check (seat_index >= 0),
  amount_satang bigint not null check (amount_satang >= 0),
  confirmed_at timestamptz,
  payment_status text check (payment_status in ('reported', 'verified', 'rejected')),
  slip_path text,
  transferred_at timestamptz,
  reported_at timestamptz,
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete restrict,
  rejection_note text check (rejection_note is null or char_length(rejection_note) <= 500),
  primary key (cycle_id, user_id),
  unique (cycle_id, seat_index),
  check (payment_status is null or confirmed_at is not null),
  check ((payment_status = 'verified') = (verified_at is not null and verified_by is not null))
);
create index if not exists group_cycle_members_user_idx on public.group_cycle_members (user_id);
create index if not exists group_cycle_members_verified_by_idx on public.group_cycle_members (verified_by);
create index if not exists group_cycle_members_reported_idx
  on public.group_cycle_members (reported_at desc) where payment_status = 'reported';

alter table public.group_cycles enable row level security;
alter table public.group_cycle_members enable row level security;
revoke all on public.group_cycles, public.group_cycle_members from public, anon, authenticated;
grant select on public.group_cycles, public.group_cycle_members to authenticated;
grant select, insert, update on public.group_cycles, public.group_cycle_members to service_role;
drop policy if exists "Group members read cycles" on public.group_cycles;
create policy "Group members read cycles" on public.group_cycles
  for select to authenticated using (private.is_group_member(group_id, (select auth.uid())));
drop policy if exists "Group members read cycle shares" on public.group_cycle_members;
create policy "Group members read cycle shares" on public.group_cycle_members
  for select to authenticated using (exists (
    select 1 from public.group_cycles c
    where c.id = cycle_id and private.is_group_member(c.group_id, (select auth.uid()))));

-- Lock this month's people and amounts. Cycle k runs anchor + (k-1) months .. anchor + k months.
create or replace function private.open_group_cycle(p_group uuid, p_number integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_cycle uuid;
  v_fee bigint;
  v_total bigint;
begin
  select * into v_group from public.groups where id = p_group;
  select service_satang, total_satang into v_fee, v_total
  from private.compute_group_totals(v_group.product_satang, v_group.delivery_per_member_satang, v_group.capacity);
  insert into public.group_cycles (group_id, cycle_number, starts_at, ends_at, capacity,
    product_satang, delivery_per_member_satang, service_satang, total_satang)
  values (p_group, p_number, private.add_month(v_group.cycle_anchor, p_number - 1),
    private.add_month(v_group.cycle_anchor, p_number), v_group.capacity,
    v_group.product_satang, v_group.delivery_per_member_satang, v_fee, v_total)
  returning id into v_cycle;
  insert into public.group_cycle_members (cycle_id, user_id, seat_index, amount_satang)
  select v_cycle, s.user_id, s.seat_index, s.amount_satang
  from private.seat_amounts(v_group.owner_id, v_group.capacity, v_group.product_satang,
    v_group.delivery_per_member_satang, private.group_seat_members(p_group)) s;
  return v_cycle;
end;
$$;

-- Close every month that has ended and open the next with the people in the group today.
create or replace function private.roll_group_cycles(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_last public.group_cycles%rowtype;
  v_guard integer := 0;
begin
  select * into v_group from public.groups where id = p_group for update;
  if not found or v_group.billing_mode <> 'monthly' or v_group.cycle_anchor is null then return; end if;
  loop
    select * into v_last from public.group_cycles where group_id = p_group
    order by cycle_number desc limit 1 for update;
    exit when not found or v_last.ends_at > now();
    v_guard := v_guard + 1;
    if v_guard > 120 then raise exception 'cycle_overflow' using errcode = '54000'; end if;
    update public.group_cycles set status = 'closed', closed_from = v_last.status where id = v_last.id;
    exit when v_group.status = 'cancelled';
    perform private.open_group_cycle(p_group, v_last.cycle_number + 1);
  end loop;
end;
$$;

create or replace function public.sync_group_cycles(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not private.is_group_member(p_group, auth.uid()) then
    raise exception 'not_group_member' using errcode = '42501';
  end if;
  perform private.roll_group_cycles(p_group);
end;
$$;

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
  update public.groups set cycle_anchor = now(), updated_at = now() where id = p_group;
  return private.open_group_cycle(p_group, 1);
end;
$$;

-- One confirmation per person per cycle. A fully confirmed cycle is complete and never asks again.
create or replace function public.confirm_group_cycle(p_group uuid, p_cycle_number integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_cycle public.group_cycles%rowtype;
  v_share public.group_cycle_members%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  perform private.roll_group_cycles(p_group);
  select * into v_cycle from public.group_cycles where group_id = p_group
  order by cycle_number desc limit 1 for update;
  if not found then raise exception 'no_cycle' using errcode = 'P0002'; end if;
  if v_cycle.cycle_number <> p_cycle_number then raise exception 'stale_cycle' using errcode = '40001'; end if;
  if v_cycle.status = 'closed' then raise exception 'cycle_closed' using errcode = '23514'; end if;
  select * into v_share from public.group_cycle_members
  where cycle_id = v_cycle.id and user_id = v_user for update;
  if not found then raise exception 'not_in_cycle' using errcode = '42501'; end if;
  if v_share.confirmed_at is not null then raise exception 'already_confirmed' using errcode = '23505'; end if;
  update public.group_cycle_members set confirmed_at = now() where cycle_id = v_cycle.id and user_id = v_user;
  if not exists (select 1 from public.group_cycle_members where cycle_id = v_cycle.id and confirmed_at is null) then
    update public.group_cycles set status = 'confirmed' where id = v_cycle.id and status = 'awaiting_confirmation';
  end if;
  return jsonb_build_object('cycle', v_cycle.cycle_number, 'amount', v_share.amount_satang);
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cycle-payment-slips', 'cycle-payment-slips', false, 8388608,
  array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "Cycle members upload their own slips" on storage.objects;
create policy "Cycle members upload their own slips" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'cycle-payment-slips'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.group_cycle_members m
      join public.group_cycles c on c.id = m.cycle_id
      where m.user_id = (select auth.uid())
        and c.group_id::text = (storage.foldername(name))[2]
        and c.cycle_number::text = (storage.foldername(name))[3]
        and m.confirmed_at is not null
        and c.status <> 'closed'
    )
  );

create or replace function public.report_group_cycle_payment(
  p_group uuid, p_cycle_number integer, p_slip_path text, p_transferred_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_parts text[] := string_to_array(coalesce(p_slip_path, ''), '/');
  v_cycle public.group_cycles%rowtype;
  v_share public.group_cycle_members%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_transferred_at is null or p_transferred_at > now() + interval '10 minutes' then
    raise exception 'invalid_transfer_time' using errcode = '23514';
  end if;
  if cardinality(v_parts) <> 4 or v_parts[1] <> v_user::text or v_parts[2] <> p_group::text
    or v_parts[3] <> p_cycle_number::text or v_parts[4] !~ '^[a-f0-9-]{36}\.(jpg|jpeg|png|webp)$' then
    raise exception 'invalid_payment_slip_path' using errcode = '23514';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'cycle-payment-slips' and o.name = p_slip_path) then
    raise exception 'payment_slip_missing' using errcode = '23514';
  end if;
  select * into v_cycle from public.group_cycles where group_id = p_group and cycle_number = p_cycle_number;
  if not found then raise exception 'no_cycle' using errcode = 'P0002'; end if;
  if v_cycle.status = 'closed' then raise exception 'cycle_closed' using errcode = '23514'; end if;
  select * into v_share from public.group_cycle_members where cycle_id = v_cycle.id and user_id = v_user for update;
  if not found then raise exception 'not_in_cycle' using errcode = '42501'; end if;
  if v_share.confirmed_at is null then raise exception 'confirm_first' using errcode = '23514'; end if;
  if v_share.payment_status = 'verified' then raise exception 'already_verified' using errcode = '23505'; end if;
  update public.group_cycle_members
  set payment_status = 'reported', slip_path = p_slip_path, transferred_at = p_transferred_at,
      reported_at = now(), rejection_note = null
  where cycle_id = v_cycle.id and user_id = v_user;
  return jsonb_build_object('cycle', p_cycle_number, 'amount', v_share.amount_satang, 'status', 'reported');
end;
$$;

create or replace function public.verify_group_cycle_payment(
  p_group uuid, p_cycle_number integer, p_user uuid, p_verified_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cycle public.group_cycles%rowtype;
begin
  if p_verified_by is null then raise exception 'verifier_required' using errcode = '22023'; end if;
  select * into v_cycle from public.group_cycles where group_id = p_group and cycle_number = p_cycle_number for update;
  if not found then raise exception 'no_cycle' using errcode = 'P0002'; end if;
  update public.group_cycle_members
  set payment_status = 'verified', verified_at = now(), verified_by = p_verified_by
  where cycle_id = v_cycle.id and user_id = p_user and payment_status = 'reported';
  if not found then raise exception 'payment_not_pending' using errcode = '23514'; end if;
  if v_cycle.status = 'confirmed' and not exists (
    select 1 from public.group_cycle_members
    where cycle_id = v_cycle.id and payment_status is distinct from 'verified') then
    update public.group_cycles set status = 'paid' where id = v_cycle.id;
  end if;
  return jsonb_build_object('cycle', p_cycle_number, 'userId', p_user, 'status', 'verified');
end;
$$;

create or replace function public.reject_group_cycle_payment(
  p_group uuid, p_cycle_number integer, p_user uuid, p_verified_by uuid, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_verified_by is null then raise exception 'verifier_required' using errcode = '22023'; end if;
  update public.group_cycle_members m
  set payment_status = 'rejected', rejection_note = left(nullif(btrim(coalesce(p_note, '')), ''), 500)
  from public.group_cycles c
  where c.id = m.cycle_id and c.group_id = p_group and c.cycle_number = p_cycle_number
    and m.user_id = p_user and m.payment_status = 'reported';
  if not found then raise exception 'payment_not_pending' using errcode = '23514'; end if;
  return jsonb_build_object('cycle', p_cycle_number, 'userId', p_user, 'status', 'rejected');
end;
$$;

-- ============================================================ grants
revoke all on function private.seat_amounts(uuid, integer, bigint, bigint, uuid[]) from public;
revoke all on function private.group_seat_members(uuid) from public;
revoke all on function private.group_member_amount(uuid, uuid) from public;
revoke all on function private.add_month(timestamptz, integer) from public;
revoke all on function private.effective_plan(uuid) from public;
revoke all on function private.open_group_cycle(uuid, integer) from public;
revoke all on function private.roll_group_cycles(uuid) from public;
revoke all on function public.my_subscription() from public, anon;
revoke all on function public.report_subscription_payment(text, timestamptz) from public, anon;
revoke all on function public.verify_subscription_payment(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reject_subscription_payment(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.sync_group_cycles(uuid) from public, anon;
revoke all on function public.start_group_cycle(uuid) from public, anon;
revoke all on function public.confirm_group_cycle(uuid, integer) from public, anon;
revoke all on function public.report_group_cycle_payment(uuid, integer, text, timestamptz) from public, anon;
revoke all on function public.verify_group_cycle_payment(uuid, integer, uuid, uuid) from public, anon, authenticated;
revoke all on function public.reject_group_cycle_payment(uuid, integer, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.my_subscription() to authenticated;
grant execute on function public.report_subscription_payment(text, timestamptz) to authenticated;
grant execute on function public.sync_group_cycles(uuid) to authenticated;
grant execute on function public.start_group_cycle(uuid) to authenticated;
grant execute on function public.confirm_group_cycle(uuid, integer) to authenticated;
grant execute on function public.report_group_cycle_payment(uuid, integer, text, timestamptz) to authenticated;
grant execute on function public.verify_subscription_payment(uuid, uuid) to service_role;
grant execute on function public.reject_subscription_payment(uuid, uuid, text) to service_role;
grant execute on function public.verify_group_cycle_payment(uuid, integer, uuid, uuid) to service_role;
grant execute on function public.reject_group_cycle_payment(uuid, integer, uuid, uuid, text) to service_role;

-- ============================================================ existing functions, patched

-- Seat-priced groups charge each member their seat; only the owner carries the 2% fee.
CREATE OR REPLACE FUNCTION private.report_group_payment(p_group uuid, p_revision integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_group public.groups%rowtype;
  v_count integer;
  v_rank integer;
  v_base bigint;
  v_remainder bigint;
  v_amount bigint;
  v_report public.group_payment_reports%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into v_group from public.groups where id = p_group for share;
  if not found or v_group.status = 'cancelled' then raise exception 'group_unavailable' using errcode = 'P0002'; end if;
  if v_group.revision <> p_revision then raise exception 'stale_revision' using errcode = '40001'; end if;
  if not exists (
    select 1 from public.group_members m
    join public.group_approvals a on a.group_id = m.group_id and a.user_id = m.user_id
    where m.group_id = p_group and m.user_id = v_user and a.revision = p_revision
  ) then raise exception 'not_approved_group_member' using errcode = '42501'; end if;

  select count(*)::integer into v_count from public.group_members where group_id = p_group;
  if v_count < 1 then raise exception 'group_unavailable' using errcode = 'P0002'; end if;
  select count(*)::integer into v_rank
  from (
    select m.user_id, row_number() over (order by m.joined_at, m.user_id)::integer as member_rank
    from public.group_members m where m.group_id = p_group
  ) ranked where ranked.user_id = v_user;
  if v_rank is null then raise exception 'not_group_member' using errcode = '42501'; end if;

  if v_group.pricing_mode = 'seat_v3' then
    v_amount := private.group_member_amount(p_group, v_user);
  else
    v_base := (v_group.product_satang + v_group.service_satang) / v_count;
    v_remainder := mod(v_group.product_satang + v_group.service_satang, v_count);
    v_amount := v_base + case when v_rank <= v_remainder then 1 else 0 end + v_group.delivery_per_member_satang;
  end if;

  insert into public.group_payment_reports (group_id, user_id, revision, amount_satang)
  values (p_group, v_user, p_revision, v_amount)
  on conflict (group_id, user_id, revision) do update
    set amount_satang = excluded.amount_satang, status = 'reported', reported_at = now(),
        verified_at = null, verified_by = null, rejection_note = null
    where public.group_payment_reports.status = 'rejected'
  returning * into v_report;
  if not found then
    select * into v_report from public.group_payment_reports
    where group_id = p_group and user_id = v_user and revision = p_revision;
  end if;

  return jsonb_build_object('id', v_report.id, 'group_id', v_report.group_id,
    'revision', v_report.revision, 'amount_satang', v_report.amount_satang,
    'status', v_report.status, 'reported_at', v_report.reported_at);
end;
$function$;

CREATE OR REPLACE FUNCTION private.report_group_payment_with_slip(p_group uuid, p_revision integer, p_slip_path text, p_transferred_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid := auth.uid();
  v_group public.groups%rowtype;
  v_count integer;
  v_rank integer;
  v_base bigint;
  v_remainder bigint;
  v_amount bigint;
  v_report public.group_payment_reports%rowtype;
  v_slip_parts text[];
begin
  if v_user is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_transferred_at is null or p_transferred_at > now() + interval '10 minutes' then
    raise exception 'invalid_transfer_time' using errcode = '23514';
  end if;

  v_slip_parts := string_to_array(coalesce(p_slip_path, ''), '/');
  if cardinality(v_slip_parts) <> 4
    or v_slip_parts[1] <> v_user::text
    or v_slip_parts[2] <> p_group::text
    or v_slip_parts[3] <> p_revision::text
    or v_slip_parts[4] !~ '^[a-f0-9-]{36}\.(jpg|jpeg|png|webp)$' then
    raise exception 'invalid_payment_slip_path' using errcode = '23514';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'group-payment-slips' and o.name = p_slip_path
  ) then
    raise exception 'payment_slip_missing' using errcode = '23514';
  end if;

  select * into v_group
  from public.groups
  where id = p_group
  for share;
  if not found or v_group.status = 'cancelled' then
    raise exception 'group_unavailable' using errcode = 'P0002';
  end if;
  if v_group.revision <> p_revision then
    raise exception 'stale_revision' using errcode = '40001';
  end if;
  if not exists (
    select 1
    from public.group_members m
    join public.group_approvals a on a.group_id = m.group_id and a.user_id = m.user_id
    where m.group_id = p_group and m.user_id = v_user and a.revision = p_revision
  ) then
    raise exception 'not_approved_group_member' using errcode = '42501';
  end if;

  select count(*)::integer into v_count
  from public.group_members where group_id = p_group;
  if v_count < 1 then
    raise exception 'group_unavailable' using errcode = 'P0002';
  end if;
  select count(*)::integer into v_rank
  from (
    select m.user_id, row_number() over (order by m.joined_at, m.user_id)::integer as member_rank
    from public.group_members m where m.group_id = p_group
  ) ranked
  where ranked.user_id = v_user;
  if v_rank is null then
    raise exception 'not_group_member' using errcode = '42501';
  end if;

  if v_group.pricing_mode = 'seat_v3' then
    v_amount := private.group_member_amount(p_group, v_user);
  else
    v_base := (v_group.product_satang + v_group.service_satang) / v_count;
    v_remainder := mod(v_group.product_satang + v_group.service_satang, v_count);
    v_amount := v_base + case when v_rank <= v_remainder then 1 else 0 end
      + v_group.delivery_per_member_satang;
  end if;

  insert into public.group_payment_reports (
    group_id, user_id, revision, amount_satang, slip_path, transferred_at
  ) values (
    p_group, v_user, p_revision, v_amount, p_slip_path, p_transferred_at
  )
  on conflict (group_id, user_id, revision) do update
    set amount_satang = excluded.amount_satang,
        slip_path = excluded.slip_path,
        transferred_at = excluded.transferred_at,
        status = 'reported',
        reported_at = now(),
        verified_at = null,
        verified_by = null,
        rejection_note = null
    where public.group_payment_reports.status = 'rejected'
       or (public.group_payment_reports.status = 'reported'
           and public.group_payment_reports.slip_path is null)
  returning * into v_report;

  if not found then
    raise exception 'payment_report_already_reviewed' using errcode = '23514';
  end if;

  return jsonb_build_object(
    'id', v_report.id,
    'group_id', v_report.group_id,
    'revision', v_report.revision,
    'amount_satang', v_report.amount_satang,
    'status', v_report.status,
    'reported_at', v_report.reported_at,
    'transferred_at', v_report.transferred_at,
    'slip_path', v_report.slip_path
  );
end;
$function$;

-- The form chooses one_time or monthly billing (details.billing) and respects the plan limit.
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
  -- Plan limit: Free owns up to 2 open groups at once, Plus up to 5.
  if ((select count(*) from public.groups g where g.owner_id = v_user and g.status <> 'cancelled')
     >= (case when private.effective_plan(v_user) = 'plus' then 5 else 2 end)) then
    raise exception 'group_limit_reached' using errcode = '23514';
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
  update public.groups
  set details = v_details - 'billing',
      billing_mode = coalesce(v_details->>'billing', 'one_time'),
      pricing_mode = 'seat_v3'
  where id = v_group and owner_id = v_user;
  perform private.refresh_group_totals(v_group);
  return v_group;
end;
$function$;
