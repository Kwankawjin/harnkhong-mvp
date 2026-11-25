-- Photos on "แจ้งปัญหา" (problem reports): up to 3 images per report, private, for admins to review.
-- Objects live at dispute-photos/<reporter uid>/<group id>/<random>.<ext>.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dispute-photos', 'dispute-photos', false, 8388608, array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

alter table public.group_disputes
  add column if not exists photo_paths text[] not null default '{}';
alter table public.group_disputes drop constraint if exists group_disputes_photo_paths_max;
alter table public.group_disputes
  add constraint group_disputes_photo_paths_max check (cardinality(photo_paths) <= 3);

-- Members upload into their own folder, for a group they belong to.
drop policy if exists "Members upload dispute photos" on storage.objects;
create policy "Members upload dispute photos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dispute-photos'
    and (storage.foldername(objects.name))[1] = (select auth.uid())::text
    and exists (
      select 1 from public.group_members m
      where m.user_id = (select auth.uid())
        and m.group_id::text = (storage.foldername(objects.name))[2]
    )
  );

-- The reporter can see their own photos; admins can see all of them.
drop policy if exists "Reporters and admins read dispute photos" on storage.objects;
create policy "Reporters and admins read dispute photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'dispute-photos'
    and ((storage.foldername(objects.name))[1] = (select auth.uid())::text or private.is_admin())
  );

-- Clean-up after a failed report: only photos not attached to any report.
drop policy if exists "Members delete unattached dispute photos" on storage.objects;
create policy "Members delete unattached dispute photos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'dispute-photos'
    and (storage.foldername(objects.name))[1] = (select auth.uid())::text
    and not exists (select 1 from public.group_disputes d where objects.name = any (d.photo_paths))
  );

-- Same rules as before, plus optional photos. The old 3-argument call still works through the default.
drop function if exists public.report_group_problem(uuid, integer, text);
create or replace function public.report_group_problem(
  p_group uuid,
  p_cycle_number integer,
  p_reason text,
  p_photo_paths text[] default '{}'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_reason text := btrim(coalesce(p_reason, ''));
  v_photos text[] := coalesce(p_photo_paths, '{}');
  v_id uuid;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if char_length(v_reason) not between 5 and 1000 then raise exception 'problem_reason_required' using errcode = '22023'; end if;
  if cardinality(v_photos) > 3 then raise exception 'too_many_photos' using errcode = '22023'; end if;
  -- Every photo must be the reporter's own upload for this group.
  if exists (
    select 1 from unnest(v_photos) as p(path)
    where p.path not like v_user::text || '/' || p_group::text || '/%'
       or not exists (select 1 from storage.objects o where o.bucket_id = 'dispute-photos' and o.name = p.path)
  ) then
    raise exception 'invalid_photo' using errcode = '22023';
  end if;
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
  insert into public.group_disputes (group_id, cycle_number, user_id, reason, photo_paths)
  values (p_group, p_cycle_number, v_user, v_reason, v_photos)
  returning id into v_id;
  return jsonb_build_object('disputeId', v_id, 'status', 'open');
exception when unique_violation then
  raise exception 'problem_already_reported' using errcode = '23505';
end;
$$;

-- Admin queue now carries the photo paths (the admin page signs them for viewing).
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
             d.reason, d.photo_paths, d.status, d.created_at, d.resolved_at, d.resolution_note,
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

revoke all on function public.report_group_problem(uuid, integer, text, text[]) from public, anon;
grant execute on function public.report_group_problem(uuid, integer, text, text[]) to authenticated;
