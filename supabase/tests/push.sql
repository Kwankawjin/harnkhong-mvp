-- Phone notifications: saving devices, what queues a push, and daily payment reminders.
-- Run as postgres (SQL editor or supabase/tests/local/run.sh supabase/tests/push.sql).
-- Everything is rolled back.
begin;

-- Stand-ins for Vault and pg_net where they are missing (plain Postgres), so the wake-up call
-- can be checked. On a real project the existing ones are used and nothing is called for real
-- because the whole test rolls back.
create schema if not exists vault;
create schema if not exists net;
do $$
begin
  if to_regclass('vault.decrypted_secrets') is null then
    create table vault.decrypted_secrets (name text primary key, decrypted_secret text);
    insert into vault.decrypted_secrets values
      ('push_function_url', 'https://example.invalid/functions/v1/push-send'),
      ('push_cron_secret', 'test-secret');
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then
    create table net.test_calls (url text, headers jsonb, at timestamptz default clock_timestamp());
    create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
      headers jsonb default '{}', timeout_milliseconds integer default 5000)
    returns bigint language sql as $f$
      insert into net.test_calls(url, headers) values (url, headers) returning 1::bigint;
    $f$;
  end if;
end;
$$;

do $$
declare
  owner uuid := gen_random_uuid(); a uuid := gen_random_uuid(); outsider uuid := gen_random_uuid();
  g uuid; n integer; ids bigint[];
  product jsonb := '{"type":"digital","title":"Netflix Premium","category":"แอปพลิเคชันและเว็บไซต์"}';
  form_details jsonb := jsonb_build_object('minimumMembers', 2, 'closesAt', (current_date + 7)::text);
begin
  insert into auth.users(id, aud, role, email)
    select id, 'authenticated', 'authenticated', id::text || '@example.invalid'
    from unnest(array[owner, a, outsider]) id;
  insert into public.profiles(id, display_name)
    values (owner, 'Owner'), (a, 'Ann'), (outsider, 'Out')
    on conflict (id) do update set display_name = excluded.display_name;

  -- ---------------------------------------------------------------- devices
  perform set_config('request.jwt.claim.sub', owner::text, true);
  set local role authenticated;
  perform public.save_push_subscription('https://push.example.invalid/owner', repeat('k', 40), repeat('a', 16), 'test');
  begin
    perform * from public.push_subscriptions;
    raise exception 'people must not read the device table directly';
  exception when insufficient_privilege then null; end;
  g := public.create_group_from_form(gen_random_uuid(), 'Push group', array['แอปพลิเคชันและเว็บไซต์'],
    '[]'::jsonb, 'public', 2, 0, 20000, product, form_details);
  reset role;

  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  perform public.save_push_subscription('https://push.example.invalid/a', repeat('k', 40), repeat('a', 16), 'test');
  -- Saving the same device again updates it instead of adding a second one.
  perform public.save_push_subscription('https://push.example.invalid/a', repeat('j', 40), repeat('b', 16), 'test');
  reset role;
  assert (select count(*) = 1 and min(p256dh) = repeat('j', 40) from public.push_subscriptions where user_id = a),
    'one row per device, keys refreshed';

  -- A device signed into another account moves to that account.
  perform set_config('request.jwt.claim.sub', outsider::text, true);
  set local role authenticated;
  perform public.save_push_subscription('https://push.example.invalid/shared', repeat('k', 40), repeat('a', 16), null);
  reset role;
  perform set_config('request.jwt.claim.sub', owner::text, true);
  set local role authenticated;
  perform public.save_push_subscription('https://push.example.invalid/shared', repeat('k', 40), repeat('a', 16), null);
  -- Nobody can remove someone else's device.
  perform public.delete_push_subscription('https://push.example.invalid/a');
  reset role;
  assert (select user_id = owner from public.push_subscriptions where endpoint = 'https://push.example.invalid/shared'),
    'the device belongs to the last account signed in';
  assert exists (select 1 from public.push_subscriptions where endpoint = 'https://push.example.invalid/a'),
    'another person''s device is untouched';

  -- ---------------------------------------------------------------- group activity
  delete from private.push_outbox;
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  perform public.join_group(g, gen_random_uuid(), null);
  reset role;
  assert (select count(*) = 1 from private.push_outbox where user_id = owner and body like 'Ann เข้าร่วมกลุ่มแล้ว%'),
    'the owner hears that someone joined';
  assert not exists (select 1 from private.push_outbox where user_id = a),
    'the person who joined is not told about themselves';

  delete from private.push_outbox;
  insert into public.group_messages (group_id, sender_id, sender_name, body) values (g, a, 'Ann', 'สวัสดีทุกคน');
  assert (select count(*) = 1 from private.push_outbox
          where user_id = owner and title = 'Push group' and body = 'Ann: สวัสดีทุกคน' and url = '/chat/' || g),
    'a chat message reaches the other members';
  assert not exists (select 1 from private.push_outbox where user_id = a), 'the sender gets no push';
  assert not exists (select 1 from private.push_outbox where user_id = outsider), 'people outside the group get nothing';

  -- ---------------------------------------------------------------- announcements and test pushes
  delete from private.push_outbox;
  insert into public.system_announcements (title, body) values ('ปิดปรับปรุงคืนนี้', 'ช่วง 23:00–24:00');
  assert (select count(distinct user_id) = 2 from private.push_outbox where title = 'ปิดปรับปรุงคืนนี้'),
    'an announcement goes to everyone with a device (owner and a; outsider has none now)';

  delete from private.push_outbox;
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  n := public.send_test_push();
  begin
    perform public.send_test_push();
    raise exception 'a second test push right away must be refused';
  exception when raise_exception then
    if sqlerrm <> 'PUSH_TEST_TOO_SOON' then raise; end if;
  end;
  reset role;
  assert n = 1 and (select count(*) = 1 from private.push_outbox where user_id = a and tag = 'test'),
    'a test push goes to my own devices';

  if to_regclass('net.test_calls') is not null then
    assert (select count(*) > 0 from net.test_calls where headers ->> 'x-push-secret' = 'test-secret'),
      'queuing a push wakes the push-send function with the shared secret';
  end if;

  -- The sender claims rows once and finishes them.
  ids := array(select id from private.push_outbox);
  set local role service_role;
  assert (select count(*) = 1 from public.push_claim_outbox(50)), 'the pending row is claimed';
  perform public.push_finish_outbox(ids);
  assert (select count(*) = 0 from public.push_claim_outbox(50)), 'finished rows are not sent again';
  reset role;

  -- ---------------------------------------------------------------- payment reminders
  -- (Skip the admin review step: mark this revision as already approved by an admin.)
  update public.groups set admin_approved_revision = revision where id = g;
  perform set_config('request.jwt.claim.sub', owner::text, true);
  set local role authenticated;
  perform public.approve_group(g, (select revision from public.groups where id = g), gen_random_uuid());
  reset role;
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  perform public.approve_group(g, (select revision from public.groups where id = g), gen_random_uuid());
  reset role;
  assert (select status = 'ready' from public.groups where id = g), 'everyone approved: the group is ready';
  -- The group became ready two days ago, so the 3-day payment window ends tomorrow.
  update public.group_events set created_at = now() - interval '2 days' where group_id = g;
  delete from private.push_outbox;
  perform private.queue_due_payment_pushes();
  assert (select count(*) = 1 from private.push_outbox where user_id = a and title like 'ครบกำหนดชำระพรุ่งนี้%'),
    'the member who owes is reminded the day before';
  assert not exists (select 1 from private.push_outbox where user_id = owner), 'the owner is not reminded to pay';
  perform private.queue_due_payment_pushes();
  assert (select count(*) = 1 from private.push_outbox where user_id = a), 'each reminder goes once';

  -- Due today -> a second, different reminder.
  update public.group_events set created_at = now() - interval '3 days' where group_id = g;
  perform private.queue_due_payment_pushes();
  assert (select count(*) = 1 from private.push_outbox where user_id = a and title like 'คุณต้องชำระเงินภายในวันนี้%'),
    'and again on the due day';

  -- Removing my device stops pushes.
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  perform public.delete_push_subscription('https://push.example.invalid/a');
  reset role;
  delete from private.push_outbox;
  insert into public.group_messages (group_id, sender_id, sender_name, body) values (g, owner, 'Owner', 'ok');
  assert not exists (select 1 from private.push_outbox where user_id = a), 'no device, no push';
end;
$$;

rollback;
