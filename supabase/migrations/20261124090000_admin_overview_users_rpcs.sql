-- The admin overview and member list straight from the database, like the other admin pages,
-- so they no longer depend on the deployed admin-api Edge Function staying in step with the app.

-- Members, newest first: id, email, confirmation, sign-up time and display name.
create or replace function public.admin_users(p_limit integer default 500)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc)
    from (
      select u.id, u.email, u.email_confirmed_at, u.created_at,
             coalesce(p.display_name, u.raw_user_meta_data->>'display_name', '') as display_name
      from auth.users u
      left join public.profiles p on p.id = u.id
      order by u.created_at desc
      limit greatest(1, least(coalesce(p_limit, 500), 2000))
    ) x), '[]'::jsonb);
end;
$$;

-- Dashboard numbers for the last 7, 30 or 90 days, in the shape the admin page renders.
create or replace function public.admin_overview(p_days integer default 7)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer := case when p_days in (7, 30, 90) then p_days else 7 end;
  v_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc' - make_interval(days => v_days - 1);
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return jsonb_build_object(
    'stats', jsonb_build_object(
      'users', (select count(*) from public.profiles),
      'groups', (select count(*) from public.groups),
      'awaitingGroups', (select count(*) from public.groups where status = 'awaiting_approval'),
      'readyGroups', (select count(*) from public.groups where status = 'ready'),
      'activeProducts', (select count(*) from public.products where active)
    ),
    'analytics', jsonb_build_object(
      'rangeDays', v_days,
      'start', v_start,
      'end', now(),
      'groupsByDay', (
        select coalesce(jsonb_agg(jsonb_build_object('date', d::date, 'count',
          (select count(*) from public.groups g where g.created_at >= d and g.created_at < d + interval '1 day')) order by d), '[]'::jsonb)
        from generate_series(v_start, v_start + make_interval(days => v_days - 1), interval '1 day') d
      ),
      'paidSales', null
    ),
    'paymentOverview', jsonb_build_object('available', false, 'reason', 'ดูยอดชำระได้ที่หน้าการชำระเงิน'),
    'recentActivity', (
      select coalesce(jsonb_agg(a order by a->>'created_at' desc), '[]'::jsonb)
      from (
        select x as a from (
          (select jsonb_build_object('kind', e.event_type, 'actor', coalesce(u.email, 'สมาชิก'),
                    'target', coalesce(g.name, 'กลุ่ม'), 'created_at', e.created_at) as x
           from public.group_events e
           left join auth.users u on u.id = e.actor_id
           left join public.groups g on g.id = e.group_id
           order by e.created_at desc limit 10)
          union all
          (select jsonb_build_object('kind', 'member_registered', 'actor', coalesce(u.email, 'สมาชิก'),
                    'target', 'สมัครสมาชิก', 'created_at', u.created_at)
           from auth.users u where u.created_at >= v_start
           order by u.created_at desc limit 10)
        ) s
        order by x->>'created_at' desc
        limit 10
      ) t
    ),
    'recentGroups', public.admin_list_groups(8),
    'system', jsonb_build_object('supabase', 'connected', 'authentication', 'authorized',
      'paymentVerification', 'available', 'updatedAt', now(),
      'checkedBy', coalesce(auth.jwt() ->> 'email', ''))
  );
end;
$$;

revoke all on function public.admin_users(integer) from public, anon;
grant execute on function public.admin_users(integer) to authenticated;
revoke all on function public.admin_overview(integer) from public, anon;
grant execute on function public.admin_overview(integer) to authenticated;
