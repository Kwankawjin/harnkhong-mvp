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

  v_base := (v_group.product_satang + v_group.service_satang) / v_count;
  v_remainder := mod(v_group.product_satang + v_group.service_satang, v_count);
  v_amount := v_base + case when v_rank <= v_remainder then 1 else 0 end + v_group.delivery_per_member_satang;

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
$$;

create or replace function public.report_group_payment(p_group uuid, p_revision integer)
returns jsonb language sql security invoker set search_path = ''
as $$ select private.report_group_payment(p_group, p_revision) $$;

create or replace function public.verify_group_payment_report(p_payment_id uuid, p_verified_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_group public.groups%rowtype;
  v_report public.group_payment_reports%rowtype;
begin
  select group_id into v_group_id from public.group_payment_reports where id = p_payment_id;
  if not found then raise exception 'payment_report_unavailable' using errcode = 'P0002'; end if;
  select * into v_group from public.groups where id = v_group_id for update;
  if not found or v_group.status = 'cancelled' then raise exception 'group_unavailable' using errcode = 'P0002'; end if;
  select * into v_report from public.group_payment_reports where id = p_payment_id for update;
  if not found then raise exception 'payment_report_unavailable' using errcode = 'P0002'; end if;
  if v_report.status <> 'reported' then raise exception 'payment_report_not_pending' using errcode = '23514'; end if;
  if v_report.revision <> v_group.revision then raise exception 'stale_revision' using errcode = '40001'; end if;
  if p_verified_by is null then raise exception 'verifier_required' using errcode = '23502'; end if;

  update public.group_payment_reports set status = 'verified', verified_at = now(),
    verified_by = p_verified_by, rejection_note = null
  where id = p_payment_id returning * into v_report;
  return jsonb_build_object('id', v_report.id, 'group_id', v_report.group_id,
    'user_id', v_report.user_id, 'revision', v_report.revision,
    'amount_satang', v_report.amount_satang, 'status', v_report.status,
    'reported_at', v_report.reported_at, 'verified_at', v_report.verified_at,
    'verified_by', v_report.verified_by);
end;
$$;

revoke all on function public.verify_group_payment_report(uuid, uuid) from public, anon, authenticated;
grant execute on function public.verify_group_payment_report(uuid, uuid) to service_role;

notify pgrst, 'reload schema';
