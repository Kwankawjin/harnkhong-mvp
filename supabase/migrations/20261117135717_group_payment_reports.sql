create table public.group_payment_reports (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  revision integer not null check (revision > 0),
  amount_satang bigint not null check (amount_satang > 0 and amount_satang <= 9007199254740991),
  status text not null default 'reported' check (status in ('reported', 'verified', 'rejected')),
  reported_at timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid references auth.users(id) on delete restrict,
  rejection_note text,
  unique (group_id, user_id, revision),
  check ((status = 'verified' and verified_at is not null and verified_by is not null) or (status <> 'verified' and verified_at is null and verified_by is null)),
  check (rejection_note is null or char_length(rejection_note) <= 500)
);

create index group_payment_reports_status_reported_idx
  on public.group_payment_reports (reported_at desc)
  where status = 'reported';
create index group_payment_reports_user_created_idx
  on public.group_payment_reports (user_id, reported_at desc);

alter table public.group_payment_reports enable row level security;
revoke all on public.group_payment_reports from public, anon, authenticated;
grant select on public.group_payment_reports to authenticated;
grant select, update on public.group_payment_reports to service_role;

create policy "Members can read their own group payment reports"
  on public.group_payment_reports for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function private.report_group_payment(p_group uuid, p_revision integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  if not found then raise exception 'group_unavailable' using errcode = 'P0002'; end if;
  if v_group.revision <> p_revision then raise exception 'stale_revision' using errcode = '40001'; end if;
  if v_group.status <> 'ready' then raise exception 'group_not_ready' using errcode = '23514'; end if;
  if not exists (
    select 1 from public.group_members m
    join public.group_approvals a on a.group_id = m.group_id and a.user_id = m.user_id
    where m.group_id = p_group and m.user_id = v_user and a.revision = p_revision
  ) then raise exception 'not_approved_group_member' using errcode = '42501'; end if;

  select count(*)::integer into v_count from public.group_members where group_id = p_group;
  if v_count <> v_group.capacity or v_count < 1 then raise exception 'group_not_ready' using errcode = '23514'; end if;
  select count(*)::integer into v_rank
  from (
    select m.user_id, row_number() over (order by m.joined_at, m.user_id)::integer as member_rank
    from public.group_members m
    where m.group_id = p_group
  ) ranked
  where ranked.user_id = v_user;
  if v_rank is null then raise exception 'not_group_member' using errcode = '42501'; end if;

  v_base := (v_group.product_satang + v_group.service_satang) / v_count;
  v_remainder := mod(v_group.product_satang + v_group.service_satang, v_count);
  v_amount := v_base + case when v_rank <= v_remainder then 1 else 0 end + v_group.delivery_per_member_satang;

  insert into public.group_payment_reports (group_id, user_id, revision, amount_satang)
  values (p_group, v_user, p_revision, v_amount)
  on conflict (group_id, user_id, revision) do update
    set amount_satang = excluded.amount_satang,
        status = 'reported',
        reported_at = now(),
        verified_at = null,
        verified_by = null,
        rejection_note = null
    where public.group_payment_reports.status = 'rejected'
  returning * into v_report;

  if not found then
    select * into v_report from public.group_payment_reports
    where group_id = p_group and user_id = v_user and revision = p_revision;
  end if;

  return jsonb_build_object(
    'id', v_report.id,
    'group_id', v_report.group_id,
    'revision', v_report.revision,
    'amount_satang', v_report.amount_satang,
    'status', v_report.status,
    'reported_at', v_report.reported_at
  );
end;
$$;
revoke all on function private.report_group_payment(uuid, integer) from public, anon, authenticated;
grant execute on function private.report_group_payment(uuid, integer) to authenticated;

create or replace function public.report_group_payment(p_group uuid, p_revision integer)
returns jsonb
language sql
security invoker
set search_path = ''
as $$ select private.report_group_payment(p_group, p_revision) $$;
revoke all on function public.report_group_payment(uuid, integer) from public, anon, authenticated;
grant execute on function public.report_group_payment(uuid, integer) to authenticated;

