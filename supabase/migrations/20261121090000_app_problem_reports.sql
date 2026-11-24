-- "รายงานปัญหา" from the account page: anyone signed in can tell the team something is broken.
-- Not tied to a group or money; admins read and close them on the admin page.

create table if not exists public.app_problem_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  topic text not null check (char_length(topic) between 1 and 80),
  message text not null check (char_length(message) between 5 and 1000),
  page text check (page is null or char_length(page) <= 300),
  user_agent text check (user_agent is null or char_length(user_agent) <= 400),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 500)
);
create index if not exists app_problem_reports_user_idx on public.app_problem_reports (user_id);
create index if not exists app_problem_reports_resolved_by_idx on public.app_problem_reports (resolved_by);
create index if not exists app_problem_reports_open_idx on public.app_problem_reports (created_at desc) where status = 'open';
alter table public.app_problem_reports enable row level security;
revoke all on public.app_problem_reports from public, anon, authenticated;
grant select on public.app_problem_reports to authenticated;
drop policy if exists "Reporters read their own problem reports" on public.app_problem_reports;
create policy "Reporters read their own problem reports" on public.app_problem_reports
  for select to authenticated using (user_id = (select auth.uid()));

-- Member sends a report. At most 10 a day per person to keep the queue usable.
create or replace function public.submit_app_problem_report(p_topic text, p_message text, p_page text default null, p_user_agent text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_topic text := btrim(coalesce(p_topic, ''));
  v_message text := btrim(coalesce(p_message, ''));
  v_id uuid;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if char_length(v_topic) not between 1 and 80 then raise exception 'invalid_topic' using errcode = '22023'; end if;
  if char_length(v_message) not between 5 and 1000 then raise exception 'invalid_message' using errcode = '22023'; end if;
  if (select count(*) from public.app_problem_reports r
      where r.user_id = v_user and r.created_at > now() - interval '1 day') >= 10 then
    raise exception 'too_many_reports' using errcode = '54000';
  end if;
  insert into public.app_problem_reports (user_id, topic, message, page, user_agent)
  values (v_user, v_topic, v_message, left(nullif(btrim(coalesce(p_page, '')), ''), 300), left(nullif(btrim(coalesce(p_user_agent, '')), ''), 400))
  returning id into v_id;
  return v_id;
end;
$$;

-- Admin list: open reports first, newest first.
create or replace function public.admin_app_problem_reports()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by (x.status = 'open') desc, x.created_at desc)
    from (
      select r.id, r.user_id, coalesce(p.display_name, 'สมาชิก') as member_name, coalesce(u.email, '') as member_email,
             r.topic, r.message, r.page, r.user_agent, r.status, r.created_at, r.resolved_at, r.resolution_note
      from public.app_problem_reports r
      left join public.profiles p on p.id = r.user_id
      left join auth.users u on u.id = r.user_id
      order by r.created_at desc
      limit 300
    ) x), '[]'::jsonb);
end;
$$;

-- Admin closes a report with a short note.
create or replace function public.admin_resolve_app_problem_report(p_report uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_note text := btrim(coalesce(p_note, ''));
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if char_length(v_note) not between 1 and 500 then raise exception 'resolution_note_required' using errcode = '22023'; end if;
  update public.app_problem_reports
     set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(), resolution_note = v_note
   where id = p_report and status = 'open';
  if not found then raise exception 'report_not_open' using errcode = 'P0002'; end if;
end;
$$;

revoke all on function public.submit_app_problem_report(text, text, text, text) from public, anon;
revoke all on function public.admin_app_problem_reports() from public, anon;
revoke all on function public.admin_resolve_app_problem_report(uuid, text) from public, anon;
grant execute on function public.submit_app_problem_report(text, text, text, text) to authenticated;
grant execute on function public.admin_app_problem_reports() to authenticated;
grant execute on function public.admin_resolve_app_problem_report(uuid, text) to authenticated;
