-- The 2% is a commission taken from what the owner receives, not a fee anyone pays on top.
-- Members transfer their seat price to the platform; the platform keeps 2% of each payment and
-- passes the rest to the group owner (a member pays 50.00, the owner receives 49.00).
-- The owner never transfers money for their own seat. Applies to seat_v3 groups only;
-- per_member_v2 groups keep their old amounts.

-- ============================================================ seat amounts: no fee on top
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
  v_empty bigint;
begin
  if p_capacity not between 2 and 20 or v_count not between 1 and p_capacity
    or p_product not between 0 and 9007199254740991 or p_delivery not between 0 and 9007199254740991
    or p_members[1] is distinct from p_owner then
    raise exception 'invalid_seat_pricing' using errcode = '22023';
  end if;
  v_base := p_product / p_capacity;
  v_rem := mod(p_product, p_capacity);
  v_empty := (p_capacity - v_count) * (v_base + p_delivery) + greatest(0, v_rem - v_count);
  return query
    select m.id,
           (m.ord - 1)::integer,
           v_base + case when m.ord - 1 < v_rem then 1 else 0 end + p_delivery
             + case when m.ord = 1 then v_empty else 0 end
    from unnest(p_members) with ordinality as m(id, ord);
end;
$$;

-- 2% of one payment, rounded to the nearest satang.
create or replace function private.platform_commission(p_amount bigint)
returns bigint
language sql
immutable
set search_path = ''
as $$ select floor((p_amount::numeric * 2 + 50) / 100)::bigint $$;

-- Seat-priced totals are the seats themselves; there is no service line any more.
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
  if v_group.pricing_mode = 'seat_v3' then
    update public.groups
    set service_satang = 0,
        total_satang = v_group.product_satang + v_group.delivery_per_member_satang * v_group.capacity
    where id = p_group_id;
    return;
  end if;
  select count(*) into v_count from public.group_members where group_id = p_group_id;
  select service_satang, total_satang into v_fee, v_total
  from private.compute_group_totals(v_group.product_satang, v_group.delivery_per_member_satang, greatest(v_count, 1));
  update public.groups set service_satang = v_fee, total_satang = v_total where id = p_group_id;
end;
$$;

do $$
declare r record;
begin
  for r in select id from public.groups where pricing_mode = 'seat_v3' loop
    perform private.refresh_group_totals(r.id);
  end loop;
end $$;

create or replace function private.open_group_cycle(p_group uuid, p_number integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_cycle uuid;
  v_total bigint;
begin
  select * into v_group from public.groups where id = p_group;
  v_total := v_group.product_satang + v_group.delivery_per_member_satang * v_group.capacity;
  insert into public.group_cycles (group_id, cycle_number, starts_at, ends_at, capacity,
    product_satang, delivery_per_member_satang, service_satang, total_satang)
  values (p_group, p_number, private.add_month(v_group.cycle_anchor, p_number - 1),
    private.add_month(v_group.cycle_anchor, p_number), v_group.capacity,
    v_group.product_satang, v_group.delivery_per_member_satang, 0, v_total)
  returning id into v_cycle;
  insert into public.group_cycle_members (cycle_id, user_id, seat_index, amount_satang)
  select v_cycle, s.user_id, s.seat_index, s.amount_satang
  from private.seat_amounts(v_group.owner_id, v_group.capacity, v_group.product_satang,
    v_group.delivery_per_member_satang, private.group_seat_members(p_group)) s;
  return v_cycle;
end;
$$;

-- ============================================================ monthly: the owner does not transfer
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
  if exists (select 1 from public.groups where id = p_group and owner_id = v_user) then
    raise exception 'owner_receives_payout' using errcode = '23514';
  end if;
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
  v_owner uuid;
begin
  if p_verified_by is null then raise exception 'verifier_required' using errcode = '22023'; end if;
  select * into v_cycle from public.group_cycles where group_id = p_group and cycle_number = p_cycle_number for update;
  if not found then raise exception 'no_cycle' using errcode = 'P0002'; end if;
  select owner_id into v_owner from public.groups where id = p_group;
  update public.group_cycle_members
  set payment_status = 'verified', verified_at = now(), verified_by = p_verified_by
  where cycle_id = v_cycle.id and user_id = p_user and payment_status = 'reported';
  if not found then raise exception 'payment_not_pending' using errcode = '23514'; end if;
  -- Paid once every member except the owner has a verified payment.
  if v_cycle.status = 'confirmed' and not exists (
    select 1 from public.group_cycle_members
    where cycle_id = v_cycle.id and user_id <> v_owner and payment_status is distinct from 'verified') then
    update public.group_cycles set status = 'paid' where id = v_cycle.id;
  end if;
  return jsonb_build_object('cycle', p_cycle_number, 'userId', p_user, 'status', 'verified');
end;
$$;

-- ============================================================ payouts to owners
create table if not exists public.group_payouts (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  net_satang bigint not null check (net_satang > 0),
  paid_at timestamptz not null default now(),
  paid_by uuid not null references auth.users(id) on delete restrict,
  note text check (note is null or char_length(note) <= 500)
);
create index if not exists group_payouts_group_idx on public.group_payouts (group_id, paid_at desc);
create index if not exists group_payouts_owner_idx on public.group_payouts (owner_id);
create index if not exists group_payouts_paid_by_idx on public.group_payouts (paid_by);
alter table public.group_payouts enable row level security;
revoke all on public.group_payouts from public, anon, authenticated;
grant select on public.group_payouts to authenticated;
grant select, insert on public.group_payouts to service_role;
drop policy if exists "Owners read their payouts" on public.group_payouts;
create policy "Owners read their payouts" on public.group_payouts
  for select to authenticated using ((select auth.uid()) = owner_id);

-- Verified member payments of a seat-priced group (one-time reports and monthly cycles), the 2%
-- kept per payment, what the owner is owed in total, and what has been paid out so far.
create or replace function private.group_payout_summary(p_group uuid)
returns table (gross_satang bigint, commission_satang bigint, net_satang bigint, paid_out_satang bigint, owed_satang bigint, payments integer)
language sql
stable
security definer
set search_path = ''
as $$
  with g as (
    select id, owner_id from public.groups where id = p_group and pricing_mode = 'seat_v3'
  ), received as (
    select r.amount_satang as amount
    from public.group_payment_reports r join g on g.id = r.group_id
    where r.status = 'verified' and r.user_id <> g.owner_id
    union all
    select m.amount_satang
    from public.group_cycle_members m
    join public.group_cycles c on c.id = m.cycle_id
    join g on g.id = c.group_id
    where m.payment_status = 'verified' and m.user_id <> g.owner_id
  ), totals as (
    select coalesce(sum(amount), 0)::bigint as gross,
           coalesce(sum(private.platform_commission(amount)), 0)::bigint as commission,
           count(*)::integer as payments
    from received
  ), paid as (
    select coalesce(sum(p.net_satang), 0)::bigint as paid_out from public.group_payouts p where p.group_id = p_group
  )
  select t.gross, t.commission, t.gross - t.commission, p.paid_out, greatest(t.gross - t.commission - p.paid_out, 0), t.payments
  from totals t cross join paid p;
$$;

-- The owner's own view of what they will receive.
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
    'net', v_row.net_satang, 'paidOut', v_row.paid_out_satang, 'owed', v_row.owed_satang, 'payments', v_row.payments);
end;
$$;

-- Admin: every seat-priced group with money waiting to go to its owner.
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
    select jsonb_agg(row_to_json(x) order by x.owed_satang desc, x.group_name)
    from (
      select g.id as group_id, g.name as group_name, g.owner_id,
             coalesce(pr.display_name, 'เจ้าของกลุ่ม') as owner_name, coalesce(u.email, '') as owner_email,
             s.gross_satang, s.commission_satang, s.net_satang, s.paid_out_satang, s.owed_satang, s.payments
      from public.groups g
      cross join lateral private.group_payout_summary(g.id) s
      left join public.profiles pr on pr.id = g.owner_id
      left join auth.users u on u.id = g.owner_id
      where g.pricing_mode = 'seat_v3' and s.payments > 0
    ) x), '[]'::jsonb);
end;
$$;

-- Admin transferred the owed amount to the owner: record it so it is not paid twice.
create or replace function public.admin_record_payout(p_group uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owed bigint;
  v_owner uuid;
  v_id uuid;
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select owner_id into v_owner from public.groups where id = p_group for update;
  if not found then raise exception 'group_not_found' using errcode = 'P0002'; end if;
  select owed_satang into v_owed from private.group_payout_summary(p_group);
  if coalesce(v_owed, 0) <= 0 then raise exception 'nothing_owed' using errcode = '23514'; end if;
  insert into public.group_payouts (group_id, owner_id, net_satang, paid_by, note)
  values (p_group, v_owner, v_owed, auth.uid(), left(nullif(btrim(coalesce(p_note, '')), ''), 500))
  returning id into v_id;
  return jsonb_build_object('payoutId', v_id, 'groupId', p_group, 'net', v_owed);
end;
$$;

revoke all on function private.platform_commission(bigint) from public;
revoke all on function private.group_payout_summary(uuid) from public;
revoke all on function public.my_group_payout(uuid) from public, anon;
revoke all on function public.admin_payouts() from public, anon;
revoke all on function public.admin_record_payout(uuid, text) from public, anon;
grant execute on function public.my_group_payout(uuid) to authenticated;
grant execute on function public.admin_payouts() to authenticated;
grant execute on function public.admin_record_payout(uuid, text) to authenticated;

-- ============================================================ one-time groups: the owner does not report a transfer

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
  if v_group.pricing_mode = 'seat_v3' and v_group.owner_id = v_user then
    raise exception 'owner_receives_payout' using errcode = '23514';
  end if;
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
  if v_group.pricing_mode = 'seat_v3' and v_group.owner_id = v_user then
    raise exception 'owner_receives_payout' using errcode = '23514';
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
