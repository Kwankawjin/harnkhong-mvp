-- System announcements written by admins (shown under "System updates" for everyone), and
-- which notifications each person has read, so read marks follow them across devices.

create table if not exists public.system_announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 120),
  body text not null default '' check (char_length(body) <= 1000),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
create index if not exists system_announcements_created_idx on public.system_announcements (created_at desc);
alter table public.system_announcements enable row level security;
revoke all on public.system_announcements from public, anon, authenticated;
grant select on public.system_announcements to authenticated;
drop policy if exists "Signed-in people read current announcements" on public.system_announcements;
create policy "Signed-in people read current announcements" on public.system_announcements
  for select to authenticated
  using (expires_at is null or expires_at > now());

create table if not exists public.notification_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  note_id text not null check (char_length(note_id) between 1 and 200),
  read_at timestamptz not null default now(),
  primary key (user_id, note_id)
);
alter table public.notification_reads enable row level security;
revoke all on public.notification_reads from public, anon, authenticated;
grant select on public.notification_reads to authenticated;
drop policy if exists "People read their own read marks" on public.notification_reads;
create policy "People read their own read marks" on public.notification_reads
  for select to authenticated using ((select auth.uid()) = user_id);

-- Mark notifications read (at most 200 at a time); marks older than 60 days are cleared.
create or replace function public.mark_notifications_read(p_ids text[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_count integer;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then return 0; end if;
  if cardinality(p_ids) > 200 then raise exception 'too_many_ids' using errcode = '22023'; end if;
  insert into public.notification_reads (user_id, note_id)
  select v_user, id from unnest(p_ids) id where char_length(id) between 1 and 200
  on conflict (user_id, note_id) do nothing;
  get diagnostics v_count = row_count;
  delete from public.notification_reads where user_id = v_user and read_at < now() - interval '60 days';
  return v_count;
end;
$$;

create or replace function public.admin_post_announcement(p_title text, p_body text default '', p_days integer default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if char_length(btrim(coalesce(p_title, ''))) not between 2 and 120 or char_length(coalesce(p_body, '')) > 1000 then
    raise exception 'invalid_announcement' using errcode = '22023';
  end if;
  if p_days is not null and p_days not between 1 and 365 then raise exception 'invalid_announcement' using errcode = '22023'; end if;
  insert into public.system_announcements (title, body, created_by, expires_at)
  values (btrim(p_title), btrim(coalesce(p_body, '')), auth.uid(), case when p_days is null then null else now() + make_interval(days => p_days) end)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.admin_announcements()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(row_to_json(a) order by a.created_at desc)
    from (select id, title, body, created_at, expires_at from public.system_announcements order by created_at desc limit 100) a), '[]'::jsonb);
end;
$$;

create or replace function public.admin_delete_announcement(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  delete from public.system_announcements where id = p_id;
end;
$$;

revoke all on function public.mark_notifications_read(text[]) from public, anon;
grant execute on function public.mark_notifications_read(text[]) to authenticated;
revoke all on function public.admin_post_announcement(text, text, integer) from public, anon;
grant execute on function public.admin_post_announcement(text, text, integer) to authenticated;
revoke all on function public.admin_announcements() from public, anon;
grant execute on function public.admin_announcements() to authenticated;
revoke all on function public.admin_delete_announcement(uuid) from public, anon;
grant execute on function public.admin_delete_announcement(uuid) to authenticated;
