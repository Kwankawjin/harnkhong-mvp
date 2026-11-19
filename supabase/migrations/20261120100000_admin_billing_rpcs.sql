-- Admin review of Plus and monthly-cycle slips straight from the admin page, without the
-- admin-api Edge Function. Every function checks the caller's admin role from the JWT
-- (app_metadata.role, which only the server can set) before it reads or changes anything.

create or replace function private.is_admin()
returns boolean
language sql
stable
set search_path = ''
as $$ select coalesce((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false) $$;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated;

-- Slips the admin page lists, newest first.
create or replace function public.admin_billing_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'subscriptions', coalesce((
      select jsonb_agg(row_to_json(x) order by x.reported_at desc)
      from (
        select p.id, p.user_id, p.amount_satang, p.status, p.slip_path, p.transferred_at, p.reported_at,
               p.verified_at, p.covers_from, p.covers_to, p.rejection_note,
               coalesce(pr.display_name, 'สมาชิก') as member_name
        from public.subscription_payments p
        left join public.profiles pr on pr.id = p.user_id
        order by p.reported_at desc
        limit 200
      ) x), '[]'::jsonb),
    'cycles', coalesce((
      select jsonb_agg(row_to_json(y) order by y.reported_at desc)
      from (
        select c.group_id, coalesce(g.name, 'กลุ่ม') as group_name, c.cycle_number,
               c.starts_at as cycle_starts_at, c.ends_at as cycle_ends_at, c.status as cycle_status,
               m.user_id, coalesce(pr.display_name, 'สมาชิก') as member_name, m.amount_satang,
               m.payment_status as status, m.slip_path, m.transferred_at, m.reported_at, m.verified_at,
               m.rejection_note
        from public.group_cycle_members m
        join public.group_cycles c on c.id = m.cycle_id
        left join public.groups g on g.id = c.group_id
        left join public.profiles pr on pr.id = m.user_id
        where m.payment_status is not null
        order by m.reported_at desc
        limit 200
      ) y), '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_review_subscription_payment(p_payment uuid, p_approve boolean, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if p_approve then
    return public.verify_subscription_payment(p_payment, auth.uid());
  end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 3 and 500 then
    raise exception 'rejection_note_required' using errcode = '22023';
  end if;
  return public.reject_subscription_payment(p_payment, auth.uid(), p_note);
end;
$$;

create or replace function public.admin_review_cycle_payment(
  p_group uuid, p_cycle_number integer, p_user uuid, p_approve boolean, p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if p_approve then
    return public.verify_group_cycle_payment(p_group, p_cycle_number, p_user, auth.uid());
  end if;
  if char_length(btrim(coalesce(p_note, ''))) not between 3 and 500 then
    raise exception 'rejection_note_required' using errcode = '22023';
  end if;
  return public.reject_group_cycle_payment(p_group, p_cycle_number, p_user, auth.uid(), p_note);
end;
$$;

revoke all on function public.admin_billing_queue() from public, anon;
revoke all on function public.admin_review_subscription_payment(uuid, boolean, text) from public, anon;
revoke all on function public.admin_review_cycle_payment(uuid, integer, uuid, boolean, text) from public, anon;
grant execute on function public.admin_billing_queue() to authenticated;
grant execute on function public.admin_review_subscription_payment(uuid, boolean, text) to authenticated;
grant execute on function public.admin_review_cycle_payment(uuid, integer, uuid, boolean, text) to authenticated;

-- Admins may open (sign) Plus and monthly slips from the browser.
drop policy if exists "Admins read billing slips" on storage.objects;
create policy "Admins read billing slips" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('subscription-payment-slips', 'cycle-payment-slips')
    and private.is_admin()
  );
