-- Group payment slips reviewed straight from the admin page, like Plus and monthly slips.
-- The deployed admin-api Edge Function is an older build that does not return slip_path, so
-- the page showed "no slip" and offered no approve/reject even after a member attached one.

-- Payment reports with group, member and slip path, newest first.
create or replace function public.admin_group_payment_reports(p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.reported_at desc)
    from (
      select r.id, r.group_id, r.user_id, r.revision, r.amount_satang, r.status, r.reported_at,
             r.transferred_at, r.slip_path, r.verified_at, r.verified_by, r.rejection_note,
             coalesce(g.name, 'กลุ่มที่ถูกลบ') as group_name,
             g.revision as current_revision,
             (g.id is not null and r.revision <> g.revision) as stale_revision,
             coalesce(u.email, '') as member_email,
             coalesce(p.display_name, u.email, 'สมาชิก') as member_name
      from public.group_payment_reports r
      left join public.groups g on g.id = r.group_id
      left join auth.users u on u.id = r.user_id
      left join public.profiles p on p.id = r.user_id
      order by r.reported_at desc
      limit greatest(1, least(coalesce(p_limit, 200), 500))
    ) x), '[]'::jsonb);
end;
$$;

-- Approve (verify the money arrived) or reject with a reason. Needs an attached slip.
create or replace function public.admin_review_group_payment(p_payment uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_slip text;
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  select slip_path into v_slip from public.group_payment_reports where id = p_payment;
  if not found then raise exception 'payment_report_unavailable' using errcode = 'P0002'; end if;
  if v_slip is null then raise exception 'payment_slip_missing' using errcode = '23514'; end if;
  if p_approve then
    return public.verify_group_payment_report(p_payment, auth.uid());
  end if;
  return public.reject_group_payment_report(p_payment, auth.uid(), p_note);
end;
$$;

revoke all on function public.admin_group_payment_reports(integer) from public, anon;
grant execute on function public.admin_group_payment_reports(integer) to authenticated;
revoke all on function public.admin_review_group_payment(uuid, boolean, text) from public, anon;
grant execute on function public.admin_review_group_payment(uuid, boolean, text) to authenticated;

-- Admins may open (sign) group payment slips from the browser.
drop policy if exists "Admins read group payment slips" on storage.objects;
create policy "Admins read group payment slips" on storage.objects
  for select to authenticated
  using (bucket_id = 'group-payment-slips' and private.is_admin());
