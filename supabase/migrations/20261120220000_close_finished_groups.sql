-- Finishing groups without deleting their money records.
-- * One-time group: once everyone who paid has the goods and the owner has been paid in full,
--   the owner can close it. A closed group leaves Explore and "My groups" but keeps every slip,
--   payment and payout for disputes and accounting.
-- * Any member can hide a closed group (or one whose goods they already received) from their list.
-- * Monthly group: the owner picks the last cycle. No new cycle opens after it; once it ends and
--   the owner is paid, the owner can close the group.

alter table public.groups add column if not exists closed_at timestamptz;
alter table public.groups add column if not exists closed_by uuid references auth.users(id) on delete set null;
alter table public.groups add column if not exists last_cycle_number integer check (last_cycle_number is null or last_cycle_number > 0);
create index if not exists groups_closed_by_idx on public.groups (closed_by);

create table if not exists public.group_hidden (
  user_id uuid not null references auth.users(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  hidden_at timestamptz not null default now(),
  primary key (user_id, group_id)
);
create index if not exists group_hidden_group_idx on public.group_hidden (group_id);
alter table public.group_hidden enable row level security;
revoke all on public.group_hidden from public, anon, authenticated;
grant select on public.group_hidden to authenticated;
drop policy if exists "Members read their hidden groups" on public.group_hidden;
create policy "Members read their hidden groups" on public.group_hidden
  for select to authenticated using (user_id = (select auth.uid()));

-- Nobody joins a closed group.
create or replace function private.block_join_closed_group()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.groups g where g.id = new.group_id and g.closed_at is not null) then
    raise exception 'group_closed' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists group_members_block_closed on public.group_members;
create trigger group_members_block_closed before insert on public.group_members
  for each row execute function private.block_join_closed_group();

-- Is there nothing left to do with this group's money? Someone must have paid, nothing may be
-- held or still owed to the owner, and no problem report may be open. Monthly groups also need
-- their chosen last cycle to have ended.
create or replace function private.group_finished(p_group uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.groups g
    cross join lateral private.group_payout_summary(g.id) s
    where g.id = p_group
      and s.payments > 0 and s.held_satang = 0 and s.owed_satang = 0
      and not exists (select 1 from public.group_disputes d where d.group_id = g.id and d.status = 'open')
      and (
        g.billing_mode = 'one_time'
        or (g.last_cycle_number is not null and exists (
          select 1 from public.group_cycles c
          where c.group_id = g.id and c.cycle_number = g.last_cycle_number and c.ends_at <= now()))
      )
  );
$$;
revoke all on function private.group_finished(uuid) from public;

create or replace function public.close_group(p_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.groups where id = p_group and owner_id = v_user for update) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  if not private.group_finished(p_group) then raise exception 'group_not_finished' using errcode = '23514'; end if;
  update public.groups set closed_at = coalesce(closed_at, now()), closed_by = coalesce(closed_by, v_user)
  where id = p_group;
  return jsonb_build_object('groupId', p_group, 'closed', true);
end;
$$;

create or replace function public.hide_group_for_me(p_group uuid, p_hidden boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.group_members where group_id = p_group and user_id = v_user) then
    raise exception 'member_only' using errcode = '42501';
  end if;
  if not p_hidden then
    delete from public.group_hidden where user_id = v_user and group_id = p_group;
    return jsonb_build_object('groupId', p_group, 'hidden', false);
  end if;
  -- Only once it is over for this person: the group is closed or they have their goods.
  if not exists (select 1 from public.groups where id = p_group and closed_at is not null)
     and not private.member_received(p_group, null, v_user) then
    raise exception 'group_still_active' using errcode = '23514';
  end if;
  insert into public.group_hidden (user_id, group_id) values (v_user, p_group) on conflict do nothing;
  return jsonb_build_object('groupId', p_group, 'hidden', true);
end;
$$;

-- Monthly: the owner chooses the last cycle (null = keep going). It cannot be before the running one.
create or replace function public.end_group_after_cycle(p_group uuid, p_cycle_number integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_current integer;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if not exists (select 1 from public.groups where id = p_group and owner_id = v_user and billing_mode = 'monthly' and closed_at is null for update) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  select max(cycle_number) into v_current from public.group_cycles where group_id = p_group;
  if p_cycle_number is not null and (v_current is null or p_cycle_number < v_current) then
    raise exception 'invalid_last_cycle' using errcode = '22023';
  end if;
  update public.groups set last_cycle_number = p_cycle_number where id = p_group;
  return jsonb_build_object('groupId', p_group, 'lastCycle', p_cycle_number);
end;
$$;

-- Same as the live definition, plus: stop after the owner's last cycle or once the group is closed.
create or replace function private.roll_group_cycles(p_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
  v_last public.group_cycles%rowtype;
  v_guard integer := 0;
begin
  select * into v_group from public.groups where id = p_group for update;
  if not found or v_group.billing_mode <> 'monthly' or v_group.cycle_anchor is null then return; end if;
  loop
    select * into v_last from public.group_cycles where group_id = p_group
    order by cycle_number desc limit 1 for update;
    exit when not found or v_last.ends_at > now();
    v_guard := v_guard + 1;
    if v_guard > 120 then raise exception 'cycle_overflow' using errcode = '54000'; end if;
    update public.group_cycles set status = 'closed', closed_from = v_last.status where id = v_last.id;
    exit when v_group.status = 'cancelled' or v_group.closed_at is not null
      or (v_group.last_cycle_number is not null and v_last.cycle_number >= v_group.last_cycle_number);
    perform private.open_group_cycle(p_group, v_last.cycle_number + 1);
  end loop;
end;
$$;

revoke all on function public.close_group(uuid) from public, anon;
revoke all on function public.hide_group_for_me(uuid, boolean) from public, anon;
revoke all on function public.end_group_after_cycle(uuid, integer) from public, anon;
grant execute on function public.close_group(uuid) to authenticated;
grant execute on function public.hide_group_for_me(uuid, boolean) to authenticated;
grant execute on function public.end_group_after_cycle(uuid, integer) to authenticated;
