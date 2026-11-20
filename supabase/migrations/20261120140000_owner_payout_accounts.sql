-- Where the admin sends an owner's payout: PromptPay or a Thai bank account.
-- Kept apart from profiles (which group members can read): only the owner and admins see it.

create table if not exists public.payout_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  method text not null check (method in ('promptpay', 'bank')),
  promptpay_id text,
  bank_name text,
  account_number text,
  account_name text not null check (char_length(account_name) between 2 and 100),
  updated_at timestamptz not null default now(),
  check (
    (method = 'promptpay' and promptpay_id ~ '^(0[0-9]{9}|[0-9]{13})$' and bank_name is null and account_number is null)
    or (method = 'bank' and promptpay_id is null and char_length(bank_name) between 2 and 60
        and account_number ~ '^[0-9]{10,15}$')
  )
);
alter table public.payout_accounts enable row level security;
revoke all on public.payout_accounts from public, anon, authenticated;
grant select on public.payout_accounts to authenticated;
drop policy if exists "Owners read their payout account" on public.payout_accounts;
create policy "Owners read their payout account" on public.payout_accounts
  for select to authenticated using ((select auth.uid()) = user_id);

-- Save (or replace) my payout account. Spaces and dashes are removed from the numbers.
create or replace function public.set_my_payout_account(
  p_method text, p_account_name text, p_promptpay_id text default null,
  p_bank_name text default null, p_account_number text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_promptpay text := nullif(regexp_replace(coalesce(p_promptpay_id, ''), '[^0-9]', '', 'g'), '');
  v_number text := nullif(regexp_replace(coalesce(p_account_number, ''), '[^0-9]', '', 'g'), '');
  v_bank text := nullif(btrim(coalesce(p_bank_name, '')), '');
  v_name text := btrim(coalesce(p_account_name, ''));
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_method = 'promptpay' then
    if v_promptpay is null or v_promptpay !~ '^(0[0-9]{9}|[0-9]{13})$' then
      raise exception 'invalid_promptpay' using errcode = '22023';
    end if;
    v_bank := null; v_number := null;
  elsif p_method = 'bank' then
    if v_bank is null or char_length(v_bank) not between 2 and 60 then raise exception 'invalid_bank' using errcode = '22023'; end if;
    if v_number is null or v_number !~ '^[0-9]{10,15}$' then raise exception 'invalid_account_number' using errcode = '22023'; end if;
    v_promptpay := null;
  else
    raise exception 'invalid_payout_method' using errcode = '22023';
  end if;
  if char_length(v_name) not between 2 and 100 then raise exception 'invalid_account_name' using errcode = '22023'; end if;
  insert into public.payout_accounts (user_id, method, promptpay_id, bank_name, account_number, account_name, updated_at)
  values (v_user, p_method, v_promptpay, v_bank, v_number, v_name, now())
  on conflict (user_id) do update
    set method = excluded.method, promptpay_id = excluded.promptpay_id, bank_name = excluded.bank_name,
        account_number = excluded.account_number, account_name = excluded.account_name, updated_at = now();
  return jsonb_build_object('method', p_method, 'saved', true);
end;
$$;

-- Admin payout list, now with where to send the money.
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
             pa.account_name, pa.updated_at as payout_account_updated_at
      from public.groups g
      cross join lateral private.group_payout_summary(g.id) s
      left join public.profiles pr on pr.id = g.owner_id
      left join auth.users u on u.id = g.owner_id
      left join public.payout_accounts pa on pa.user_id = g.owner_id
      where g.pricing_mode = 'seat_v3' and s.payments > 0
    ) x), '[]'::jsonb);
end;
$$;

revoke all on function public.set_my_payout_account(text, text, text, text, text) from public, anon;
grant execute on function public.set_my_payout_account(text, text, text, text, text) to authenticated;
