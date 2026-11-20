-- History of changes to monthly payment cycles: a cycle started, or moved to confirmed, paid
-- or closed. Kept for 3 days: every new entry clears older ones, and reads only see 3 days.

create table if not exists public.group_cycle_history (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  cycle_number integer not null,
  event text not null check (event in ('started', 'confirmed', 'paid', 'closed')),
  created_at timestamptz not null default now()
);
create index if not exists group_cycle_history_group_idx on public.group_cycle_history (group_id, created_at desc);
create index if not exists group_cycle_history_created_idx on public.group_cycle_history (created_at);

alter table public.group_cycle_history enable row level security;
revoke all on public.group_cycle_history from public, anon, authenticated;
-- anon gets the grant so an embedded read never fails the whole request; RLS gives it no rows.
grant select on public.group_cycle_history to anon, authenticated;
drop policy if exists "Group members read recent cycle history" on public.group_cycle_history;
create policy "Group members read recent cycle history" on public.group_cycle_history
  for select to authenticated
  using (
    created_at >= now() - interval '3 days'
    and private.is_group_member(group_id, (select auth.uid()))
  );

create or replace function private.record_cycle_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.group_cycle_history (group_id, cycle_number, event)
    values (new.group_id, new.cycle_number, 'started');
  elsif new.status is distinct from old.status and new.status in ('confirmed', 'paid', 'closed') then
    insert into public.group_cycle_history (group_id, cycle_number, event)
    values (new.group_id, new.cycle_number, new.status);
  end if;
  delete from public.group_cycle_history where created_at < now() - interval '3 days';
  return new;
end;
$$;
revoke all on function private.record_cycle_history() from public, anon, authenticated;

drop trigger if exists group_cycles_history on public.group_cycles;
create trigger group_cycles_history
  after insert or update of status on public.group_cycles
  for each row execute function private.record_cycle_history();
