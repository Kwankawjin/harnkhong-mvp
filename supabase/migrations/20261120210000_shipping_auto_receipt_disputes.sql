-- Buyer and seller protection for escrowed group payments.
-- 1. The owner marks a group (or one monthly cycle) as shipped / handed over.
-- 2. Seven days later, every paying member who neither confirmed receipt nor reported a problem
--    counts as having received it, so the owner's money can be released.
-- 3. A member can report a problem instead. That freezes the whole group's (or cycle's) payout
--    until an admin settles it: release to the owner, or refund the member (outside the app).

-- ============================================================ shipments
create table if not exists public.group_shipments (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  cycle_number integer,
  shipped_at timestamptz not null default now(),
  shipped_by uuid not null references auth.users(id) on delete restrict,
  note text check (note is null or char_length(note) <= 300)
);
create unique index if not exists group_shipments_one_time_idx on public.group_shipments (group_id) where cycle_number is null;
create unique index if not exists group_shipments_cycle_idx on public.group_shipments (group_id, cycle_number) where cycle_number is not null;
create index if not exists group_shipments_shipped_by_idx on public.group_shipments (shipped_by);
alter table public.group_shipments enable row level security;
revoke all on public.group_shipments from public, anon, authenticated;
grant select on public.group_shipments to authenticated;
drop policy if exists "Group members read shipments" on public.group_shipments;
create policy "Group members read shipments" on public.group_shipments
  for select to authenticated using (private.is_group_member(group_id, (select auth.uid())));

-- ============================================================ problem reports
create table if not exists public.group_disputes (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  cycle_number integer,
  user_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (char_length(reason) between 5 and 1000),
  status text not null default 'open' check (status in ('open', 'released', 'refunded')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500)
);
-- One report per member per group (or cycle); an admin decision closes it.
create unique index if not exists group_disputes_one_time_idx on public.group_disputes (group_id, user_id) where cycle_number is null;
create unique index if not exists group_disputes_cycle_idx on public.group_disputes (group_id, cycle_number, user_id) where cycle_number is not null;
create index if not exists group_disputes_user_idx on public.group_disputes (user_id);
create index if not exists group_disputes_resolved_by_idx on public.group_disputes (resolved_by);
create index if not exists group_disputes_open_idx on public.group_disputes (group_id) where status = 'open';
alter table public.group_disputes enable row level security;
revoke all on public.group_disputes from public, anon, authenticated;
grant select on public.group_disputes to authenticated;
-- The member who reported and the group owner can read it; admins use the admin RPC.
drop policy if exists "Reporters and owners read disputes" on public.group_disputes;
create policy "Reporters and owners read disputes" on public.group_disputes
  for select to authenticated using (
    user_id = (select auth.uid())
    or exists (select 1 from public.groups g where g.id = group_disputes.group_id and g.owner_id = (select auth.uid()))
  );

-- ============================================================ helpers
-- Has this paying member received the goods for the group (p_cycle null) or a monthly cycle?
-- Confirmed by the member, settled for the owner by an admin, or seven days after shipping with
-- no problem reported. A refunded member is never counted (see private.member_refunded).
create or replace function private.member_received(p_group uuid, p_cycle integer, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (p_cycle is null and exists (select 1 from public.group_receipts r where r.group_id = p_group and r.user_id = p_user))
    or (p_cycle is not null and exists (
      select 1 from public.group_cycle_members m join public.group_cycles c on c.id = m.cycle_id
      where c.group_id = p_group and c.cycle_number = p_cycle and m.user_id = p_user and m.received_at is not null))
    or exists (
      select 1 from public.group_disputes d
      where d.group_id = p_group and d.cycle_number is not distinct from p_cycle and d.user_id = p_user and d.status = 'released')
    or (
      exists (
        select 1 from public.group_shipments s
        where s.group_id = p_group and s.cycle_number is not distinct from p_cycle and s.shipped_at <= now() - interval '7 days')
      and not exists (
        select 1 from public.group_disputes d
        where d.group_id = p_group and d.cycle_number is not distinct from p_cycle and d.user_id = p_user)
    );
$$;
revoke all on function private.member_received(uuid, integer, uuid) from public;

create or replace function private.member_refunded(p_group uuid, p_cycle integer, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.group_disputes d
    where d.group_id = p_group and d.cycle_number is not distinct from p_cycle and d.user_id = p_user and d.status = 'refunded');
$$;
revoke all on function private.member_refunded(uuid, integer, uuid) from public;

-- ============================================================ payout summary
-- Same as 20261120130000, with three changes: a member counts as having received through
-- private.member_received (adds auto-receipt and admin release), refunded payments are left out,
-- and an admin release of the whole group never overrides an open problem report.
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
  one_time as (
    select r.user_id, r.amount_satang as amount, r.verified_at,
           (not exists (select 1 from public.group_disputes d where d.group_id = g.id and d.cycle_number is null and d.status = 'open')
            and (exists (select 1 from public.group_payout_releases x where x.group_id = g.id and x.cycle_number is null)
              or not exists (
                select 1 from public.group_payment_reports r2
                where r2.group_id = g.id and r2.status = 'verified' and r2.user_id <> g.owner_id
                  and not private.member_received(g.id, null, r2.user_id)
                  and not private.member_refunded(g.id, null, r2.user_id)
              ))) as released
    from public.group_payment_reports r join g on g.id = r.group_id
    where r.status = 'verified' and r.user_id <> g.owner_id
      and not private.member_refunded(g.id, null, r.user_id)
  ),
  monthly as (
    select m.user_id, m.amount_satang as amount, m.verified_at,
           (not exists (select 1 from public.group_disputes d where d.group_id = g.id and d.cycle_number = c.cycle_number and d.status = 'open')
            and (exists (select 1 from public.group_payout_releases x where x.group_id = g.id and x.cycle_number = c.cycle_number)
              or not exists (
                select 1 from public.group_cycle_members m2
                where m2.cycle_id = c.id and m2.user_id <> g.owner_id
                  and not private.member_refunded(g.id, c.cycle_number, m2.user_id)
                  and (m2.payment_status is distinct from 'verified' or not private.member_received(g.id, c.cycle_number, m2.user_id))
              ))) as released
    from public.group_cycle_members m
    join public.group_cycles c on c.id = m.cycle_id
    join g on g.id = c.group_id
    where m.payment_status = 'verified' and m.user_id <> g.owner_id
      and not private.member_refunded(g.id, c.cycle_number, m.user_id)
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

-- ============================================================ owner: mark shipped
create or replace function public.mark_group_shipped(p_group uuid, p_cycle_number integer default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_at timestamptz;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.groups where id = p_group and owner_id = v_user) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if p_cycle_number is null then
    if not exists (select 1 from public.group_payment_reports r join public.groups g on g.id = r.group_id
                   where r.group_id = p_group and r.status = 'verified' and r.user_id <> g.owner_id) then
      raise exception 'nothing_paid_yet' using errcode = '23514';
    end if;
  elsif not exists (select 1 from public.group_cycles c join public.group_cycle_members m on m.cycle_id = c.id
                    join public.groups g on g.id = c.group_id
                    where c.group_id = p_group and c.cycle_number = p_cycle_number
                      and m.payment_status = 'verified' and m.user_id <> g.owner_id) then
    raise exception 'nothing_paid_yet' using errcode = '23514';
  end if;
  -- Marking twice keeps the first time, so the seven days cannot be restarted.
  select shipped_at into v_at from public.group_shipments
  where group_id = p_group and cycle_number is not distinct from p_cycle_number;
  if v_at is null then
    insert into public.group_shipments (group_id, cycle_number, shipped_by, note)
    values (p_group, p_cycle_number, v_user, left(nullif(btrim(coalesce(p_note, '')), ''), 300))
    returning shipped_at into v_at;
  end if;
  return jsonb_build_object('groupId', p_group, 'cycle', p_cycle_number, 'shippedAt', v_at,
    'autoReceiptAt', v_at + interval '7 days');
end;
$$;

-- ============================================================ member: report a problem
create or replace function public.report_group_problem(p_group uuid, p_cycle_number integer, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id uuid;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if char_length(v_reason) not between 5 and 1000 then raise exception 'problem_reason_required' using errcode = '22023'; end if;
  if p_cycle_number is null then
    if not exists (select 1 from public.group_payment_reports r join public.groups g on g.id = r.group_id
                   where r.group_id = p_group and r.user_id = v_user and r.status = 'verified' and g.owner_id <> v_user) then
      raise exception 'payment_not_verified' using errcode = '23514';
    end if;
  elsif not exists (select 1 from public.group_cycle_members m join public.group_cycles c on c.id = m.cycle_id
                    where c.group_id = p_group and c.cycle_number = p_cycle_number
                      and m.user_id = v_user and m.payment_status = 'verified') then
    raise exception 'payment_not_verified' using errcode = '23514';
  end if;
  -- Too late once receipt is confirmed, by the member or automatically.
  if private.member_received(p_group, p_cycle_number, v_user) then
    raise exception 'already_received' using errcode = '23514';
  end if;
  insert into public.group_disputes (group_id, cycle_number, user_id, reason)
  values (p_group, p_cycle_number, v_user, v_reason)
  returning id into v_id;
  return jsonb_build_object('disputeId', v_id, 'status', 'open');
exception when unique_violation then
  raise exception 'problem_already_reported' using errcode = '23505';
end;
$$;

-- Confirming receipt after a report is fine (the problem was sorted out): it settles the report.
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
  update public.group_disputes set status = 'released', resolved_at = now(), resolved_by = v_user,
    resolution_note = 'ผู้ซื้อยืนยันรับของเอง'
  where group_id = p_group and cycle_number is null and user_id = v_user and status = 'open';
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
  update public.group_disputes set status = 'released', resolved_at = now(), resolved_by = v_user,
    resolution_note = 'ผู้ซื้อยืนยันรับของเอง'
  where group_id = p_group and cycle_number = p_cycle_number and user_id = v_user and status = 'open';
  return jsonb_build_object('groupId', p_group, 'cycle', p_cycle_number, 'received', true);
end;
$$;

-- ============================================================ admin: list and settle
create or replace function public.admin_disputes()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by (x.status = 'open') desc, x.created_at desc)
    from (
      select d.id, d.group_id, g.name as group_name, d.cycle_number, d.user_id,
             coalesce(pm.display_name, 'สมาชิก') as member_name, coalesce(um.email, '') as member_email,
             g.owner_id, coalesce(po.display_name, 'เจ้าของกลุ่ม') as owner_name,
             d.reason, d.status, d.created_at, d.resolved_at, d.resolution_note,
             s.shipped_at
      from public.group_disputes d
      join public.groups g on g.id = d.group_id
      left join public.profiles pm on pm.id = d.user_id
      left join auth.users um on um.id = d.user_id
      left join public.profiles po on po.id = g.owner_id
      left join public.group_shipments s on s.group_id = d.group_id and s.cycle_number is not distinct from d.cycle_number
      order by d.created_at desc
      limit 200
    ) x), '[]'::jsonb);
end;
$$;

-- Release the member's payment to the owner, or record that the member was refunded outside the app.
create or replace function public.admin_resolve_dispute(p_dispute uuid, p_outcome text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if p_outcome not in ('released', 'refunded') then raise exception 'invalid_outcome' using errcode = '22023'; end if;
  if char_length(v_note) not between 3 and 500 then raise exception 'resolution_note_required' using errcode = '22023'; end if;
  update public.group_disputes
  set status = p_outcome, resolved_at = now(), resolved_by = auth.uid(), resolution_note = v_note
  where id = p_dispute and status = 'open';
  if not found then raise exception 'dispute_not_open' using errcode = 'P0002'; end if;
  return jsonb_build_object('disputeId', p_dispute, 'status', p_outcome);
end;
$$;

-- Admin payout list, now with open problem reports and the shipping date.
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
             private.commission_waived(g.owner_id, now()) as commission_waived_now,
             pa.method as payout_method, pa.promptpay_id, pa.bank_name, pa.account_number,
             pa.account_name, pa.qr_path as payout_qr_path, pa.updated_at as payout_account_updated_at,
             (select count(*) from public.group_disputes d where d.group_id = g.id and d.status = 'open')::integer as open_disputes,
             (select max(sh.shipped_at) from public.group_shipments sh where sh.group_id = g.id) as last_shipped_at
      from public.groups g
      cross join lateral private.group_payout_summary(g.id) s
      left join public.profiles pr on pr.id = g.owner_id
      left join auth.users u on u.id = g.owner_id
      left join public.payout_accounts pa on pa.user_id = g.owner_id
      where g.pricing_mode = 'seat_v3' and s.payments > 0
    ) x), '[]'::jsonb);
end;
$$;

revoke all on function public.mark_group_shipped(uuid, integer, text) from public, anon;
revoke all on function public.report_group_problem(uuid, integer, text) from public, anon;
revoke all on function public.admin_disputes() from public, anon;
revoke all on function public.admin_resolve_dispute(uuid, text, text) from public, anon;
grant execute on function public.mark_group_shipped(uuid, integer, text) to authenticated;
grant execute on function public.report_group_problem(uuid, integer, text) to authenticated;
grant execute on function public.admin_disputes() to authenticated;
grant execute on function public.admin_resolve_dispute(uuid, text, text) to authenticated;
