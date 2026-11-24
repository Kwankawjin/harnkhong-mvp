-- hk_sync (expire old requests and held seats) is callable by anyone, so a page left polling or
-- a script could run it nonstop. The expiry work now runs at most once every 30 seconds.
create table if not exists private.hk_sync_state (
  id integer primary key default 1 check (id = 1),
  last_run timestamptz not null default '-infinity'
);
insert into private.hk_sync_state (id) values (1) on conflict (id) do nothing;

create or replace function public.hk_sync()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- One caller at a time; others skip instead of queueing.
  if not pg_try_advisory_xact_lock(hashtext('public.hk_sync')) then return; end if;
  if (select last_run from private.hk_sync_state where id = 1) > now() - interval '30 seconds' then return; end if;
  update private.hk_sync_state set last_run = now() where id = 1;
  perform private.hk_expire();
end;
$$;
revoke all on function public.hk_sync() from public;
grant execute on function public.hk_sync() to anon, authenticated;
