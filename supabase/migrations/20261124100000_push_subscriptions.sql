-- Web Push subscriptions: one row per browser/device that turned on notifications.
--
-- * A user may have several devices (max 10; the oldest is dropped when an 11th is added).
-- * Rows are written only through save_push_subscription / delete_push_subscription, never by a
--   direct insert or update from the browser, so nobody can point a row at another account.
-- * The endpoint is unique: when another account signs in on the same browser and turns
--   notifications on, the row moves to that account (it must present the same keys, which only
--   that browser has), so the previous account stops receiving pushes on a device it left.
-- * Only the service role (the push Edge Function) reads every row; a user reads their own.
--
-- Rollback: drop function public.save_push_subscription(text, text, text, jsonb);
-- drop function public.delete_push_subscription(text); drop table public.push_subscriptions;

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique
    check (endpoint ~ '^https://[^\s/]+/' and char_length(endpoint) <= 2048),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  device_info jsonb not null default '{}'::jsonb
    check (jsonb_typeof(device_info) = 'object' and pg_column_size(device_info) <= 2048),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_success_at timestamptz,
  failure_count integer not null default 0 check (failure_count >= 0)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id, created_at desc);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
grant select on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;
drop policy if exists "Members read their own push devices" on public.push_subscriptions;
create policy "Members read their own push devices" on public.push_subscriptions
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_device_info jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_existing public.push_subscriptions%rowtype;
  v_id uuid;
  v_info jsonb := coalesce(p_device_info, '{}'::jsonb);
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if jsonb_typeof(v_info) <> 'object' then v_info := '{}'::jsonb; end if;
  -- Keep only short, known fields so device_info cannot grow into a data store.
  v_info := jsonb_strip_nulls(jsonb_build_object(
    'platform', left(v_info->>'platform', 40),
    'browser', left(v_info->>'browser', 40),
    'standalone', case when v_info->>'standalone' in ('true', 'false') then (v_info->>'standalone')::boolean end,
    'label', left(v_info->>'label', 80)
  ));

  select * into v_existing from public.push_subscriptions where endpoint = p_endpoint for update;
  if found and v_existing.user_id <> v_user
     and (v_existing.p256dh <> p_p256dh or v_existing.auth <> p_auth) then
    raise exception 'push_subscription_conflict' using errcode = '42501';
  end if;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, device_info)
  values (v_user, p_endpoint, p_p256dh, p_auth, v_info)
  on conflict (endpoint) do update
    set user_id = v_user, p256dh = excluded.p256dh, auth = excluded.auth,
        device_info = excluded.device_info, updated_at = now(), failure_count = 0
  returning id into v_id;

  -- At most 10 devices per account: drop the least recently updated beyond that.
  delete from public.push_subscriptions
  where id in (
    select id from public.push_subscriptions where user_id = v_user
    order by updated_at desc, created_at desc offset 10
  );
  return v_id;
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = v_user;
  return found;
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, jsonb) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, jsonb) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;

notify pgrst, 'reload schema';
