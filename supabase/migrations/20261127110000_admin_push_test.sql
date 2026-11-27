-- Admin "ทดลองแจ้งเตือน" page: pick a user who has push turned on, send any title/body,
-- and see the latest pushes in the outbox (sent / waiting / failed).

-- Test pushes use tags starting with 'test' so they never count toward the Home Screen badge.
create or replace function public.push_badge_counts(p_users uuid[])
returns table (user_id uuid, unread integer)
language sql stable security definer set search_path = '' as $$
  select o.user_id, count(*)::integer
  from private.push_outbox o
  where o.user_id = any (p_users) and o.created_at > now() - interval '3 days'
    and coalesce(o.tag, '') not like 'test%'
  group by o.user_id;
$$;

create or replace function public.admin_push_targets()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.is_me desc, x.display_name)
    from (
      select s.user_id as id,
             coalesce(nullif(p.display_name, ''), u.email, 'ไม่มีชื่อ') as display_name,
             u.email,
             count(*)::integer as devices,
             max(s.last_seen_at) as last_seen_at,
             s.user_id = auth.uid() as is_me
      from public.push_subscriptions s
      join auth.users u on u.id = s.user_id
      left join public.profiles p on p.id = s.user_id
      group by s.user_id, p.display_name, u.email
    ) x), '[]'::jsonb);
end;
$$;

create or replace function public.admin_send_test_push(p_user uuid, p_title text, p_body text, p_url text default '/notifications')
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  if p_user is null then raise exception 'USER_REQUIRED' using errcode = 'P0001'; end if;
  if char_length(v_title) < 1 then raise exception 'TITLE_REQUIRED' using errcode = 'P0001'; end if;
  if (select count(*) from private.push_outbox
      where tag like 'test:admin%' and created_at > now() - interval '1 minute') >= 20 then
    raise exception 'PUSH_TEST_TOO_SOON' using errcode = 'P0001';
  end if;
  return private.queue_push(
    array[p_user], left(v_title, 120), left(coalesce(p_body, ''), 300),
    case when p_url like '/%' then p_url else '/notifications' end,
    'test:admin:' || extract(epoch from clock_timestamp())::bigint
  );
end;
$$;

create or replace function public.admin_push_log(p_limit integer default 30)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.id desc)
    from (
      select o.id, o.title, o.body, o.tag, o.created_at, o.sent_at, o.attempts,
             coalesce(nullif(p.display_name, ''), u.email, '—') as user_name
      from private.push_outbox o
      left join auth.users u on u.id = o.user_id
      left join public.profiles p on p.id = o.user_id
      order by o.id desc
      limit greatest(1, least(coalesce(p_limit, 30), 200))
    ) x), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_push_targets() from public, anon;
revoke all on function public.admin_send_test_push(uuid, text, text, text) from public, anon;
revoke all on function public.admin_push_log(integer) from public, anon;
grant execute on function public.admin_push_targets() to authenticated;
grant execute on function public.admin_send_test_push(uuid, text, text, text) to authenticated;
grant execute on function public.admin_push_log(integer) to authenticated;
