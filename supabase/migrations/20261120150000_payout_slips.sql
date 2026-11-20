-- The admin attaches the transfer slip when paying an owner; the owner can open it.

alter table public.group_payouts add column if not exists slip_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payout-slips', 'payout-slips', false, 8388608, array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Path: <owner id>/<group id>/<uuid>.<ext>. Admins upload; the owner (first folder) and admins read.
drop policy if exists "Admins upload payout slips" on storage.objects;
create policy "Admins upload payout slips" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payout-slips' and private.is_admin());
drop policy if exists "Owners and admins read payout slips" on storage.objects;
create policy "Owners and admins read payout slips" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payout-slips'
    and (private.is_admin() or (storage.foldername(objects.name))[1] = (select auth.uid())::text)
  );

drop function if exists public.admin_record_payout(uuid, text);
create or replace function public.admin_record_payout(p_group uuid, p_slip_path text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owed bigint;
  v_owner uuid;
  v_id uuid;
  v_parts text[] := string_to_array(coalesce(p_slip_path, ''), '/');
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select owner_id into v_owner from public.groups where id = p_group for update;
  if not found then raise exception 'group_not_found' using errcode = 'P0002'; end if;
  if cardinality(v_parts) <> 3 or v_parts[1] <> v_owner::text or v_parts[2] <> p_group::text
    or v_parts[3] !~ '^[a-f0-9-]{36}\.(jpg|jpeg|png|webp)$' then
    raise exception 'invalid_payout_slip_path' using errcode = '23514';
  end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'payout-slips' and o.name = p_slip_path) then
    raise exception 'payout_slip_missing' using errcode = '23514';
  end if;
  select owed_satang into v_owed from private.group_payout_summary(p_group);
  if coalesce(v_owed, 0) <= 0 then raise exception 'nothing_owed' using errcode = '23514'; end if;
  insert into public.group_payouts (group_id, owner_id, net_satang, paid_by, note, slip_path)
  values (p_group, v_owner, v_owed, auth.uid(), left(nullif(btrim(coalesce(p_note, '')), ''), 500), p_slip_path)
  returning id into v_id;
  return jsonb_build_object('payoutId', v_id, 'groupId', p_group, 'net', v_owed);
end;
$$;
revoke all on function public.admin_record_payout(uuid, text, text) from public, anon;
grant execute on function public.admin_record_payout(uuid, text, text) to authenticated;
