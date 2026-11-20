-- Owners can attach a QR image (PromptPay or bank app QR) to their payout account,
-- so the admin can scan it when sending the payout. Only the owner and admins can see it.

alter table public.payout_accounts add column if not exists qr_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payout-qr', 'payout-qr', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update
set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Path: <owner id>/<uuid>.<ext>. The owner uploads and removes their own; the owner and admins read.
drop policy if exists "Owners upload their payout QR" on storage.objects;
create policy "Owners upload their payout QR" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'payout-qr' and (storage.foldername(objects.name))[1] = (select auth.uid())::text);
drop policy if exists "Owners remove their payout QR" on storage.objects;
create policy "Owners remove their payout QR" on storage.objects
  for delete to authenticated
  using (bucket_id = 'payout-qr' and (storage.foldername(objects.name))[1] = (select auth.uid())::text);
drop policy if exists "Owners and admins read payout QR" on storage.objects;
create policy "Owners and admins read payout QR" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'payout-qr'
    and (private.is_admin() or (storage.foldername(objects.name))[1] = (select auth.uid())::text)
  );

-- Attach (or, with null, detach) the QR on my payout account. Returns the previous path so the
-- app can delete the old image.
create or replace function public.set_my_payout_qr(p_qr_path text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_old text;
  v_parts text[] := string_to_array(coalesce(p_qr_path, ''), '/');
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select qr_path into v_old from public.payout_accounts where user_id = v_user for update;
  if not found then raise exception 'payout_account_missing' using errcode = 'P0002'; end if;
  if p_qr_path is not null then
    if cardinality(v_parts) <> 2 or v_parts[1] <> v_user::text
      or v_parts[2] !~ '^[a-f0-9-]{36}\.(jpg|jpeg|png|webp)$' then
      raise exception 'invalid_payout_qr_path' using errcode = '23514';
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'payout-qr' and o.name = p_qr_path) then
      raise exception 'payout_qr_missing' using errcode = '23514';
    end if;
  end if;
  update public.payout_accounts set qr_path = p_qr_path, updated_at = now() where user_id = v_user;
  return jsonb_build_object('qrPath', p_qr_path, 'previous', v_old);
end;
$$;
revoke all on function public.set_my_payout_qr(text) from public, anon;
grant execute on function public.set_my_payout_qr(text) to authenticated;

-- Admin payout list, now with the owner's QR.
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
             pa.account_name, pa.qr_path as payout_qr_path, pa.updated_at as payout_account_updated_at
      from public.groups g
      cross join lateral private.group_payout_summary(g.id) s
      left join public.profiles pr on pr.id = g.owner_id
      left join auth.users u on u.id = g.owner_id
      left join public.payout_accounts pa on pa.user_id = g.owner_id
      where g.pricing_mode = 'seat_v3' and s.payments > 0
    ) x), '[]'::jsonb);
end;
$$;
