-- Private transfer-slip storage with owner-only upload and server-signed admin review.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'group-payment-slips',
  'group-payment-slips',
  false,
  8388608,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.group_payment_reports
  add column if not exists slip_path text,
  add column if not exists transferred_at timestamptz;

drop policy if exists "Members upload payment slips for current group revision" on storage.objects;
create policy "Members upload payment slips for current group revision"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'group-payment-slips'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.group_members m
      join public.groups g on g.id = m.group_id
      join public.group_approvals a on a.group_id = m.group_id and a.user_id = m.user_id
      where m.user_id = (select auth.uid())
        and g.id::text = (storage.foldername(name))[2]
        and g.revision::text = (storage.foldername(name))[3]
        and a.revision = g.revision
        and g.status <> 'cancelled'
    )
  );

drop policy if exists "Members delete unattached payment slips" on storage.objects;
create policy "Members delete unattached payment slips"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'group-payment-slips'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and not exists (
      select 1 from public.group_payment_reports r where r.slip_path = storage.objects.name
    )
  );

-- Keep legacy RPCs from bypassing the new proof requirement.
revoke all on function public.report_group_payment(uuid, integer)
  from public, anon, authenticated, service_role;
revoke all on function private.report_group_payment(uuid, integer)
  from public, anon, authenticated, service_role;

create or replace function private.report_group_payment_with_slip(
  p_group uuid,
  p_revision integer,
  p_slip_path text,
  p_transferred_at timestamptz
)
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

  v_base := (v_group.product_satang + v_group.service_satang) / v_count;
  v_remainder := mod(v_group.product_satang + v_group.service_satang, v_count);
  v_amount := v_base + case when v_rank <= v_remainder then 1 else 0 end
    + v_group.delivery_per_member_satang;

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
$$;

revoke all on function private.report_group_payment_with_slip(uuid, integer, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.report_group_payment_with_slip(uuid, integer, text, timestamptz)
  to authenticated;

create or replace function public.report_group_payment_with_slip(
  p_group uuid,
  p_revision integer,
  p_slip_path text,
  p_transferred_at timestamptz
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.report_group_payment_with_slip(
    p_group, p_revision, p_slip_path, p_transferred_at
  );
$$;

revoke all on function public.report_group_payment_with_slip(uuid, integer, text, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.report_group_payment_with_slip(uuid, integer, text, timestamptz)
  to authenticated;

notify pgrst, 'reload schema';
