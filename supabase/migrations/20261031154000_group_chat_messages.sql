create table public.group_messages (
  id bigint generated always as identity primary key,
  group_id uuid not null references public.groups(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  sender_name text not null check (char_length(sender_name) between 1 and 70),
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now()
);

create index group_messages_group_created_idx on public.group_messages(group_id, created_at, id);

alter table public.group_messages enable row level security;
revoke all on public.group_messages from public, anon, authenticated;
grant select, insert on public.group_messages to authenticated;
grant usage, select on sequence public.group_messages_id_seq to authenticated;

create policy "Group members read group messages"
  on public.group_messages for select to authenticated
  using (private.is_group_member(group_id, (select auth.uid())));

create policy "Group members see other members profiles"
  on public.profiles for select to authenticated
  using (
    exists (
      select 1
      from public.group_members viewer
      join public.group_members profile_member on profile_member.group_id = viewer.group_id
      where viewer.user_id = (select auth.uid())
        and profile_member.user_id = profiles.id
    )
  );

create policy "Group members send messages as themselves"
  on public.group_messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and private.is_group_member(group_id, (select auth.uid()))
  );
