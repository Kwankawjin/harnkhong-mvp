-- Escrow: member payments wait in the platform account until every paying member confirms they
-- received the product (or can use the app). Then the owner is paid, minus the 2% commission.
-- Launch promo: the first 50 people to enter HARN-WITH-JINN pay no commission for 2 months.

-- ============================================================ receipt confirmations
-- One-time groups: one row per paying member.
create table if not exists public.group_receipts (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  confirmed_at timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index if not exists group_receipts_user_idx on public.group_receipts (user_id);
alter table public.group_receipts enable row level security;
revoke all on public.group_receipts from public, anon, authenticated;
grant select on public.group_receipts to authenticated;
drop policy if exists "Group members read receipts" on public.group_receipts;
create policy "Group members read receipts" on public.group_receipts
  for select to authenticated using (private.is_group_member(group_id, (select auth.uid())));

-- Monthly groups: confirmed per cycle.
alter table public.group_cycle_members add column if not exists received_at timestamptz;

-- Admin release when a member never confirms (dispute handled outside the app).
create table if not exists public.group_payout_releases (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  cycle_number integer,
  released_by uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(reason) between 3 and 500),
  released_at timestamptz not null default now(),
  unique (group_id, cycle_number)
);
create unique index if not exists group_payout_releases_one_time_idx
  on public.group_payout_releases (group_id) where cycle_number is null;
create index if not exists group_payout_releases_released_by_idx on public.group_payout_releases (released_by);
alter table public.group_payout_releases enable row level security;
revoke all on public.group_payout_releases from public, anon, authenticated;

create or replace function public.confirm_group_receipt(p_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if not exists (
    select 1 from public.group_payment_reports r
    join public.groups g on g.id = r.group_id
    where r.group_id = p_group and r.user_id = v_user and r.status = 'verified' and g.owner_id <> v_user
  ) then
    raise exception 'payment_not_verified' using errcode = '23514';
  end if;
  insert into public.group_receipts (group_id, user_id) values (p_group, v_user)
  on conflict (group_id, user_id) do nothing;
  return jsonb_build_object('groupId', p_group, 'received', true);
end;
$$;

create or replace function public.confirm_cycle_receipt(p_group uuid, p_cycle_number integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  update public.group_cycle_members m
  set received_at = coalesce(m.received_at, now())
  from public.group_cycles c
  where c.id = m.cycle_id and c.group_id = p_group and c.cycle_number = p_cycle_number
    and m.user_id = v_user and m.payment_status = 'verified';
  if not found then raise exception 'payment_not_verified' using errcode = '23514'; end if;
  return jsonb_build_object('groupId', p_group, 'cycle', p_cycle_number, 'received', true);
end;
$$;

-- ============================================================ launch promo: 2% waived
create table if not exists public.promo_codes (
  code text primary key check (code = upper(code)),
  max_redemptions integer not null check (max_redemptions > 0),
  waiver_months integer not null check (waiver_months between 1 and 24),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists public.promo_redemptions (
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null references public.promo_codes(code) on delete restrict,
  redeemed_at timestamptz not null default now(),
  waiver_until timestamptz not null,
  primary key (user_id, code)
);
create index if not exists promo_redemptions_code_idx on public.promo_redemptions (code);
alter table public.promo_codes enable row level security;
alter table public.promo_redemptions enable row level security;
revoke all on public.promo_codes, public.promo_redemptions from public, anon, authenticated;
grant select on public.promo_redemptions to authenticated;
drop policy if exists "Members read their own promo" on public.promo_redemptions;
create policy "Members read their own promo" on public.promo_redemptions
  for select to authenticated using ((select auth.uid()) = user_id);

insert into public.promo_codes (code, max_redemptions, waiver_months)
values ('HARN-WITH-JINN', 50, 2)
on conflict (code) do nothing;

create or replace function public.redeem_promo_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_code public.promo_codes%rowtype;
  v_used integer;
  v_until timestamptz;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into v_code from public.promo_codes where code = upper(btrim(coalesce(p_code, ''))) for update;
  if not found or not v_code.active then raise exception 'promo_invalid' using errcode = '22023'; end if;
  if exists (select 1 from public.promo_redemptions where user_id = v_user and code = v_code.code) then
    raise exception 'promo_already_used' using errcode = '23505';
  end if;
  select count(*) into v_used from public.promo_redemptions where code = v_code.code;
  if v_used >= v_code.max_redemptions then raise exception 'promo_sold_out' using errcode = '23514'; end if;
  v_until := private.add_month(now(), v_code.waiver_months);
  insert into public.promo_redemptions (user_id, code, waiver_until) values (v_user, v_code.code, v_until);
  return jsonb_build_object('code', v_code.code, 'waiverUntil', v_until, 'months', v_code.waiver_months);
end;
$$;

-- Is the owner's commission waived for a payment verified at this moment?
create or replace function private.commission_waived(p_owner uuid, p_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.promo_redemptions r
    where r.user_id = p_owner and coalesce(p_at, now()) >= r.redeemed_at and coalesce(p_at, now()) < r.waiver_until
  )
$$;

-- ============================================================ payout summary with escrow
drop function if exists private.group_payout_summary(uuid);
create function private.group_payout_summary(p_group uuid)
returns table (
  gross_satang bigint, commission_satang bigint, net_satang bigint,
  held_satang bigint, releasable_satang bigint,
  paid_out_satang bigint, owed_satang bigint, payments integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with g as (
    select id, owner_id from public.groups where id = p_group and pricing_mode = 'seat_v3'
  ),
  -- One-time: released when every member who paid has confirmed receipt, or an admin released it.
  one_time as (
    select r.user_id, r.amount_satang as amount, r.verified_at,
           (exists (select 1 from public.group_payout_releases x where x.group_id = g.id and x.cycle_number is null)
            or not exists (
              select 1 from public.group_payment_reports r2
              where r2.group_id = g.id and r2.status = 'verified' and r2.user_id <> g.owner_id
                and not exists (select 1 from public.group_receipts gr where gr.group_id = g.id and gr.user_id = r2.user_id)
            )) as released
    from public.group_payment_reports r join g on g.id = r.group_id
    where r.status = 'verified' and r.user_id <> g.owner_id
  ),
  -- Monthly: a cycle is released when every payer in it is verified and confirmed receipt.
  monthly as (
    select m.user_id, m.amount_satang as amount, m.verified_at,
           (exists (select 1 from public.group_payout_releases x where x.group_id = g.id and x.cycle_number = c.cycle_number)
            or not exists (
              select 1 from public.group_cycle_members m2
              where m2.cycle_id = c.id and m2.user_id <> g.owner_id
                and (m2.payment_status is distinct from 'verified' or m2.received_at is null)
            )) as released
    from public.group_cycle_members m
    join public.group_cycles c on c.id = m.cycle_id
    join g on g.id = c.group_id
    where m.payment_status = 'verified' and m.user_id <> g.owner_id
  ),
  received as (
    select p.amount, p.released,
           case when private.commission_waived(g.owner_id, p.verified_at) then 0
                else private.platform_commission(p.amount) end as commission
    from (select * from one_time union all select * from monthly) p cross join g
  ),
  totals as (
    select coalesce(sum(amount), 0)::bigint as gross,
           coalesce(sum(commission), 0)::bigint as commission,
           coalesce(sum(amount - commission) filter (where not released), 0)::bigint as held,
           coalesce(sum(amount - commission) filter (where released), 0)::bigint as releasable,
           count(*)::integer as payments
    from received
  ),
  paid as (
    select coalesce(sum(p.net_satang), 0)::bigint as paid_out from public.group_payouts p where p.group_id = p_group
  )
  select t.gross, t.commission, t.gross - t.commission, t.held, t.releasable, p.paid_out,
         greatest(t.releasable - p.paid_out, 0), t.payments
  from totals t cross join paid p;
$$;
revoke all on function private.group_payout_summary(uuid) from public;

create or replace function public.my_group_payout(p_group uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  if auth.uid() is null or not exists (select 1 from public.groups where id = p_group and owner_id = auth.uid()) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  select * into v_row from private.group_payout_summary(p_group);
  return jsonb_build_object('gross', v_row.gross_satang, 'commission', v_row.commission_satang,
    'net', v_row.net_satang, 'held', v_row.held_satang, 'releasable', v_row.releasable_satang,
    'paidOut', v_row.paid_out_satang, 'owed', v_row.owed_satang, 'payments', v_row.payments);
end;
$$;

create or replace function public.admin_payouts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.owed_satang desc, x.held_satang desc, x.group_name)
    from (
      select g.id as group_id, g.name as group_name, g.owner_id, g.billing_mode,
             coalesce(pr.display_name, 'เจ้าของกลุ่ม') as owner_name, coalesce(u.email, '') as owner_email,
             s.gross_satang, s.commission_satang, s.net_satang, s.held_satang, s.releasable_satang,
             s.paid_out_satang, s.owed_satang, s.payments,
             private.commission_waived(g.owner_id, now()) as commission_waived_now
      from public.groups g
      cross join lateral private.group_payout_summary(g.id) s
      left join public.profiles pr on pr.id = g.owner_id
      left join auth.users u on u.id = g.owner_id
      where g.pricing_mode = 'seat_v3' and s.payments > 0
    ) x), '[]'::jsonb);
end;
$$;

-- Release money held for a group (or one monthly cycle) without waiting for every receipt.
create or replace function public.admin_release_payout(p_group uuid, p_cycle_number integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 3 and 500 then
    raise exception 'release_reason_required' using errcode = '22023';
  end if;
  if not exists (select 1 from public.groups where id = p_group) then
    raise exception 'group_not_found' using errcode = 'P0002';
  end if;
  insert into public.group_payout_releases (group_id, cycle_number, released_by, reason)
  values (p_group, p_cycle_number, auth.uid(), btrim(p_reason))
  on conflict do nothing;
  return jsonb_build_object('groupId', p_group, 'cycle', p_cycle_number, 'released', true);
end;
$$;

-- my_subscription also reports the commission waiver.
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
    'feeWaiverUntil', (select max(r.waiver_until) from public.promo_redemptions r where r.user_id = v_user and r.waiver_until > now()),
    'promoCodes', coalesce((select jsonb_agg(r.code) from public.promo_redemptions r where r.user_id = v_user), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id, 'amount', p.amount_satang, 'status', p.status, 'reportedAt', p.reported_at,
        'verifiedAt', p.verified_at, 'coversFrom', p.covers_from, 'coversTo', p.covers_to,
        'note', p.rejection_note) order by p.reported_at desc)
      from public.subscription_payments p where p.user_id = v_user), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.confirm_group_receipt(uuid) from public, anon;
revoke all on function public.confirm_cycle_receipt(uuid, integer) from public, anon;
revoke all on function public.redeem_promo_code(text) from public, anon;
revoke all on function private.commission_waived(uuid, timestamptz) from public;
revoke all on function public.admin_release_payout(uuid, integer, text) from public, anon;
grant execute on function public.confirm_group_receipt(uuid) to authenticated;
grant execute on function public.confirm_cycle_receipt(uuid, integer) to authenticated;
grant execute on function public.redeem_promo_code(text) to authenticated;
grant execute on function public.admin_release_payout(uuid, integer, text) to authenticated;
