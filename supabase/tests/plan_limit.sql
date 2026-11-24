-- Free/Plus group limit on every creation path. Run with supabase/tests/local/run.sh. Rolled back.
begin;
do $$
declare
  free_user uuid := gen_random_uuid(); plus_user uuid := gen_random_uuid();
  g1 uuid; g2 uuid; listing text; n integer;
  product jsonb := '{"type":"digital","title":"Netflix Premium","category":"แอปพลิเคชันและเว็บไซต์"}';
  form_details jsonb := jsonb_build_object('minimumMembers', 2, 'closesAt', (current_date + 7)::text);
  cats text[] := array['แอปพลิเคชันและเว็บไซต์'];
begin
  insert into auth.users(id, aud, role, email)
    select id, 'authenticated', 'authenticated', id::text || '@example.invalid'
    from unnest(array[free_user, plus_user]) id;
  insert into public.profiles(id, display_name) values (free_user, 'Free'), (plus_user, 'Plus')
    on conflict (id) do update set display_name = excluded.display_name;

  -- ------------------------------------------------------------ Free: 2 groups, then blocked everywhere
  perform set_config('request.jwt.claim.sub', free_user::text, true);
  set local role authenticated;
  g1 := public.create_group_from_form(gen_random_uuid(), 'F1', cats, '[]'::jsonb, 'public', 3, 0, 9000, product, form_details);
  g2 := public.create_group_from_form(gen_random_uuid(), 'F2', cats, '[]'::jsonb, 'public', 3, 0, 9000, product, form_details);
  reset role;
  select listing_id into listing from public.groups where id = g1;
  set local role authenticated;
  begin
    perform public.create_group_from_form(gen_random_uuid(), 'F3', cats, '[]'::jsonb, 'public', 3, 0, 9000, product, form_details);
    raise exception 'Free opened a third group with the form';
  exception when check_violation then if sqlerrm <> 'group_limit_reached' then raise; end if; end;
  begin
    perform public.create_group(listing, gen_random_uuid(), 'F3 old rpc', 'public', 3, 0::bigint);
    raise exception 'Free opened a third group through public.create_group (6 args)';
  exception when check_violation then if sqlerrm <> 'group_limit_reached' then raise; end if; end;
  begin
    perform public.create_group(listing, gen_random_uuid(), 'F3 old rpc', cats[1], 'public', 3, 0::bigint, 9000::bigint);
    raise exception 'Free opened a third group through public.create_group (8 args)';
  exception when check_violation then if sqlerrm <> 'group_limit_reached' then raise; end if; end;
  begin
    perform public.create_group_with_metadata(listing, gen_random_uuid(), 'F3 meta', cats, '[]'::jsonb, 'public', 3, 0::bigint, 9000::bigint);
    raise exception 'Free opened a third group through create_group_with_metadata';
  exception when check_violation then if sqlerrm <> 'group_limit_reached' then raise; end if; end;
  reset role;

  -- A closed group no longer counts, so the owner may open another one.
  update public.groups set closed_at = now(), closed_by = free_user where id = g2;
  set local role authenticated;
  perform public.create_group_from_form(gen_random_uuid(), 'F3 after close', cats, '[]'::jsonb, 'public', 3, 0, 9000, product, form_details);
  reset role;
  assert private.owned_open_group_count(free_user) = 2, 'closed groups are not counted';

  -- ------------------------------------------------------------ Plus: 5 groups, sixth blocked
  insert into public.subscriptions(user_id, plan, status, period_start, period_end)
    values (plus_user, 'plus', 'active', now() - interval '1 day', now() + interval '29 days');
  perform set_config('request.jwt.claim.sub', plus_user::text, true);
  set local role authenticated;
  for i in 1..5 loop
    perform public.create_group_from_form(gen_random_uuid(), 'P' || i, cats, '[]'::jsonb, 'public', 3, 0, 9000, product, form_details);
  end loop;
  begin
    perform public.create_group_from_form(gen_random_uuid(), 'P6', cats, '[]'::jsonb, 'public', 3, 0, 9000, product, form_details);
    raise exception 'Plus opened a sixth group';
  exception when check_violation then if sqlerrm <> 'group_limit_reached' then raise; end if; end;
  reset role;

  -- ------------------------------------------------------------ Plus expires: back to Free, nothing deleted
  update public.subscriptions set period_start = now() - interval '40 days', period_end = now() - interval '1 minute'
    where user_id = plus_user;
  set local role authenticated;
  begin
    perform public.create_group_from_form(gen_random_uuid(), 'After expiry', cats, '[]'::jsonb, 'public', 3, 0, 9000, product, form_details);
    raise exception 'an expired Plus account above the Free limit opened a group';
  exception when check_violation then if sqlerrm <> 'group_limit_reached' then raise; end if; end;
  reset role;
  assert private.effective_plan(plus_user) = 'free', 'Plus expired to Free';
  assert (select plan = 'free' and status = 'expired' from public.subscriptions where user_id = plus_user), 'the expiry is recorded';
  select count(*) into n from public.groups where owner_id = plus_user and status <> 'cancelled';
  assert n = 5, 'groups opened on Plus are kept after expiry';

  -- ------------------------------------------------------------ trusted server code is not limited
  perform set_config('request.jwt.claim.sub', '', true);
  assert private.group_limit_for(plus_user) = 2, 'limit follows the effective plan';
end $$;
rollback;
