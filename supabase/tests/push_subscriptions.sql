-- Push subscriptions: per-user, per-device, and nobody can touch another user's rows. Rolled back.
begin;
do $$
declare
  a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  key text := repeat('B', 87); secret text := repeat('a', 22);
  ep1 text := 'https://fcm.googleapis.com/fcm/send/device-1';
  ep2 text := 'https://web.push.apple.com/device-2';
  n integer;
begin
  insert into auth.users(id, aud, role, email)
    select id, 'authenticated', 'authenticated', id::text || '@example.invalid' from unnest(array[a, b]) id;

  -- Anonymous callers cannot save.
  begin
    perform public.save_push_subscription(ep1, key, secret, '{}');
    raise exception 'saved without a user';
  exception when insufficient_privilege then null; end;

  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  perform public.save_push_subscription(ep1, key, secret, '{"platform":"android","junk":"x"}');
  perform public.save_push_subscription(ep2, key, secret, '{"platform":"ios","standalone":"true"}');
  perform public.save_push_subscription(ep1, key, secret, '{"platform":"android"}'); -- same device again
  select count(*) into n from public.push_subscriptions;
  assert n = 2, 'one row per device, several devices per account';
  assert not exists (select 1 from public.push_subscriptions where device_info ? 'junk'), 'unknown device fields dropped';
  begin
    insert into public.push_subscriptions(user_id, endpoint, p256dh, auth) values (a, 'https://x.example/1', key, secret);
    raise exception 'direct insert allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform public.save_push_subscription('http://insecure.example/1', key, secret, '{}');
    raise exception 'accepted a non-https endpoint';
  exception when check_violation then null; end;
  reset role;

  -- B cannot see, take over (without the keys), or delete A's devices.
  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  select count(*) into n from public.push_subscriptions;
  assert n = 0, 'B sees none of A''s devices';
  begin
    perform public.save_push_subscription(ep1, repeat('C', 87), repeat('c', 22), '{}');
    raise exception 'B took A''s endpoint with other keys';
  exception when insufficient_privilege then null; end;
  assert not public.delete_push_subscription(ep1), 'B cannot delete A''s device';
  begin
    update public.push_subscriptions set user_id = b;
    raise exception 'direct update allowed';
  exception when insufficient_privilege then null; end;
  -- Same browser, same keys: B signs in on A's old phone, the device moves to B.
  perform public.save_push_subscription(ep1, key, secret, '{}');
  reset role;
  assert (select user_id = b from public.push_subscriptions where endpoint = ep1), 'device follows the signed-in account';

  -- A removes their remaining device.
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  assert public.delete_push_subscription(ep2), 'A unsubscribes a device';
  -- Device cap: 12 saves keep 10.
  for i in 1..12 loop
    perform public.save_push_subscription('https://fcm.googleapis.com/fcm/send/cap-' || i, key, secret, '{}');
  end loop;
  select count(*) into n from public.push_subscriptions;
  assert n = 10, 'at most 10 devices per account';
  reset role;
end $$;
rollback;
