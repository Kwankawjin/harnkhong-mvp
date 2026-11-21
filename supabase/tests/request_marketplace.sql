-- Request Marketplace: Request -> Offer -> Accept -> Reservation -> join, plus RLS and edge cases.
-- Run with supabase/tests/local/run.sh supabase/tests/request_marketplace.sql. Everything is rolled back.
begin;
do $$
declare
  req_user uuid := gen_random_uuid(); host uuid := gen_random_uuid(); host2 uuid := gen_random_uuid();
  other uuid := gen_random_uuid(); filler uuid := gen_random_uuid();
  g uuid; g2 uuid; g_link uuid; g_monthly uuid;
  r uuid; r2 uuid; r3 uuid; o uuid; o2 uuid; o3 uuid; res uuid; n integer; ok boolean;
  cat text := 'แอปพลิเคชันและเว็บไซต์';
  product jsonb := '{"type":"digital","title":"YouTube Premium","category":"แอปพลิเคชันและเว็บไซต์"}';
  details jsonb := jsonb_build_object('minimumMembers', 2, 'closesAt', (current_date + 7)::text);
begin
  insert into auth.users(id, aud, role, email)
    select id, 'authenticated', 'authenticated', id::text || '@example.invalid'
    from unnest(array[req_user, host, host2, other, filler]) id;
  insert into public.profiles(id, display_name)
    values (req_user, 'Jin'), (host, 'Host A'), (host2, 'Host B'), (other, 'Other'), (filler, 'Filler')
    on conflict (id) do update set display_name = excluded.display_name;

  -- Hosts own groups: 3 seats at 300 baht -> 100 baht a seat.
  perform set_config('request.jwt.claim.sub', host::text, true);
  set local role authenticated;
  g := public.create_group_from_form(gen_random_uuid(), 'YT Host A', array[cat], '[]'::jsonb, 'public', 3, 0, 30000, product, details);
  g_link := public.create_group_from_form(gen_random_uuid(), 'YT link-only', array[cat], '[]'::jsonb, 'link', 3, 0, 30000, product, details);
  reset role;
  perform set_config('request.jwt.claim.sub', host2::text, true);
  set local role authenticated;
  g2 := public.create_group_from_form(gen_random_uuid(), 'YT Host B', array[cat], '[]'::jsonb, 'public', 3, 0, 60000, product, details);
  reset role;

  -- ------------------------------------------------------------ requester posts
  perform set_config('request.jwt.claim.sub', req_user::text, true);
  set local role authenticated;
  r := public.hk_create_request('หาเพื่อนหาร YouTube Premium', cat, 15000, 'one_time', 'ระยะยาว');
  begin
    insert into public.hk_requests(requester_id, requester_name, category, title, budget_max_satang, expires_at)
      values (req_user, 'Jin', cat, 'direct insert', 1, now() + interval '1 day');
    raise exception 'direct insert should fail';
  exception when insufficient_privilege then null; end;
  begin
    update public.hk_requests set status = 'completed' where id = r;
    raise exception 'direct update should fail';
  exception when insufficient_privilege then null; end;
  reset role;
  assert (select status = 'open' and requester_name = 'Jin' from public.hk_requests where id = r), 'request is open';

  -- Guests see open requests but no offers.
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  assert (select count(*) = 1 from public.hk_requests where id = r), 'anon sees open requests';
  begin
    perform 1 from public.hk_request_offers;
    raise exception 'anon must not read offers';
  exception when insufficient_privilege then null; end;
  reset role;

  -- ------------------------------------------------------------ hosts offer
  perform set_config('request.jwt.claim.sub', req_user::text, true);
  set local role authenticated;
  begin
    perform public.hk_submit_offer(r, g, 'my own request');
    raise exception 'requester must not offer on own request';
  exception when sqlstate '42501' then null; end;
  reset role;

  perform set_config('request.jwt.claim.sub', host2::text, true);
  set local role authenticated;
  begin
    perform public.hk_submit_offer(r, g, 'not my group');
    raise exception 'host must own the group';
  exception when sqlstate '42501' then null; end;
  begin
    perform public.hk_submit_offer(r, g2, 'too expensive');
    raise exception 'offers over budget are refused';
  exception when sqlstate '23514' then
    assert sqlerrm = 'over_budget', 'over budget: ' || sqlerrm;
  end;
  reset role;

  perform set_config('request.jwt.claim.sub', host::text, true);
  set local role authenticated;
  assert (select count(*) = 2 and bool_and(matches) from public.hk_my_offerable_groups(r)), 'both host groups are offerable';
  o := public.hk_submit_offer(r, g, 'ว่าง 1 ที่');
  begin
    perform public.hk_submit_offer(r, g, 'again');
    raise exception 'duplicate offers are refused';
  exception when unique_violation then null; end;
  o2 := public.hk_submit_offer(r, g_link, 'ห้องลิงก์');
  begin
    update public.hk_request_offers set offered_satang = 1 where id = o;
    raise exception 'host must not edit an offer price';
  exception when insufficient_privilege then null; end;
  reset role;
  assert (select offered_satang = 10000 and host_name = 'Host A' and group_snapshot->>'group_name' = 'YT Host A'
          from public.hk_request_offers where id = o), 'price comes from the group seat price, frozen in the snapshot';
  assert (select offer_count = 2 from public.hk_requests where id = r), 'offer count';
  assert (select count(*) = 2 from public.hk_request_notifications where user_id = req_user and type = 'offer_received'),
    'requester is notified of each offer';

  -- Outsiders cannot see the offers.
  perform set_config('request.jwt.claim.sub', other::text, true);
  set local role authenticated;
  assert (select count(*) = 0 from public.hk_request_offers where request_id = r), 'outsiders see no offers';
  assert (select count(*) = 0 from public.hk_request_notifications), 'outsiders see no notifications';
  begin
    perform public.hk_accept_offer(o);
    raise exception 'only the requester accepts';
  exception when sqlstate 'P0002' then null; end;
  reset role;

  -- ------------------------------------------------------------ accept holds a seat
  -- Fill g so exactly one seat is left (owner + filler of 3).
  perform set_config('request.jwt.claim.sub', filler::text, true);
  set local role authenticated;
  perform public.join_group(g, gen_random_uuid(), null);
  reset role;

  perform set_config('request.jwt.claim.sub', req_user::text, true);
  set local role authenticated;
  res := public.hk_accept_offer(o);
  begin
    perform public.hk_accept_offer(o2);
    raise exception 'a request accepts one offer';
  exception when sqlstate '23514' then null; end;
  reset role;
  assert (select status = 'matched' from public.hk_requests where id = r), 'request matched';
  assert (select status = 'accepted' from public.hk_request_offers where id = o), 'offer accepted';
  assert (select status = 'rejected' from public.hk_request_offers where id = o2), 'the other offer is turned down';
  assert (select status = 'reserved' from public.hk_group_reservations where id = res), 'seat reserved';
  assert private.hk_free_seats(g) = 0, 'reserved seat is taken';

  -- The reserved seat cannot be taken through the normal join path.
  perform set_config('request.jwt.claim.sub', other::text, true);
  set local role authenticated;
  begin
    perform public.join_group(g, gen_random_uuid(), null);
    raise exception 'reserved seat must block other joiners';
  exception when sqlstate '23514' then
    assert sqlerrm = 'full_group', 'blocked with full_group: ' || sqlerrm;
  end;
  begin
    perform public.hk_join_reserved_group(res, gen_random_uuid());
    raise exception 'only the requester uses the reservation';
  exception when sqlstate 'P0002' then null; end;
  reset role;

  -- ------------------------------------------------------------ join through the existing flow
  perform set_config('request.jwt.claim.sub', req_user::text, true);
  set local role authenticated;
  assert public.hk_join_reserved_group(res, gen_random_uuid()) = g, 'join returns the group';
  reset role;
  assert private.is_group_member(g, req_user), 'requester is now a member';
  assert private.group_member_amount(g, req_user) = 10000, 'member pays the offered seat price';
  assert (select status = 'confirmed' from public.hk_group_reservations where id = res), 'reservation confirmed';
  assert (select status = 'completed' from public.hk_request_offers where id = o), 'offer completed';
  assert (select status = 'completed' from public.hk_requests where id = r), 'request completed';
  assert (select array_agg(event_type order by id) @> array['request_created','offer_submitted','offer_accepted','join_started','join_completed']
          from public.hk_request_events where request_id = r), 'events recorded';

  -- ------------------------------------------------------------ link-only group, withdraw after accept
  perform set_config('request.jwt.claim.sub', other::text, true);
  set local role authenticated;
  r2 := public.hk_create_request('หากลุ่ม YouTube', cat, 20000, 'one_time');
  reset role;
  perform set_config('request.jwt.claim.sub', host::text, true);
  set local role authenticated;
  o3 := public.hk_submit_offer(r2, g_link, '');
  reset role;
  perform set_config('request.jwt.claim.sub', other::text, true);
  set local role authenticated;
  res := public.hk_accept_offer(o3);
  reset role;
  perform set_config('request.jwt.claim.sub', host::text, true);
  set local role authenticated;
  perform public.hk_withdraw_offer(o3);
  reset role;
  assert (select status = 'open' from public.hk_requests where id = r2), 'withdrawing after accept reopens the request';
  assert (select status = 'cancelled' from public.hk_group_reservations where id = res), 'and releases the seat';
  perform set_config('request.jwt.claim.sub', host::text, true);
  set local role authenticated;
  o3 := public.hk_submit_offer(r2, g_link, 'ส่งใหม่');
  reset role;
  perform set_config('request.jwt.claim.sub', other::text, true);
  set local role authenticated;
  res := public.hk_accept_offer(o3);
  assert public.hk_join_reserved_group(res, gen_random_uuid()) = g_link, 'link-only groups join with the reservation';
  reset role;
  assert private.is_group_member(g_link, other), 'joined the link-only group without an invite link';

  -- ------------------------------------------------------------ expiry
  perform set_config('request.jwt.claim.sub', other::text, true);
  set local role authenticated;
  r3 := public.hk_create_request('หากลุ่มอีกอัน', cat, 20000, 'one_time');
  reset role;
  perform set_config('request.jwt.claim.sub', host2::text, true);
  set local role authenticated;
  o := public.hk_submit_offer(r3, g2, '');
  reset role;
  perform set_config('request.jwt.claim.sub', other::text, true);
  set local role authenticated;
  res := public.hk_accept_offer(o);
  reset role;
  update public.hk_group_reservations set expires_at = now() - interval '1 minute' where id = res;
  perform public.hk_sync();
  assert (select status = 'expired' from public.hk_group_reservations where id = res), 'reservation expires';
  assert (select status = 'open' from public.hk_requests where id = r3), 'request reopens after the hold times out';
  assert private.hk_free_seats(g2) = 2, 'seat goes back';

  -- Group deleted: pending offers are cancelled and the requester is told.
  perform set_config('request.jwt.claim.sub', host2::text, true);
  set local role authenticated;
  o := public.hk_submit_offer(r3, g2, 'อีกครั้ง');
  reset role;
  delete from public.groups where id = g2;
  assert (select status = 'cancelled' and group_id is null from public.hk_request_offers where id = o), 'offer cancelled with the group';
  assert exists (select 1 from public.hk_request_notifications where user_id = other and offer_id = o and type = 'offer_cancelled'),
    'requester notified that the group went away';

  -- Request expiry closes it to new offers.
  update public.hk_requests set expires_at = now() - interval '1 minute' where id = r3;
  perform public.hk_sync();
  assert (select status = 'expired' from public.hk_requests where id = r3), 'request expires';
  perform set_config('request.jwt.claim.sub', '', true);
  set local role anon;
  assert (select count(*) = 0 from public.hk_requests where id = r3), 'expired requests leave the public list';
  reset role;

  -- Cancelling a request cancels its pending offers.
  perform set_config('request.jwt.claim.sub', req_user::text, true);
  set local role authenticated;
  r := public.hk_create_request('ยกเลิกได้', cat, 20000, 'one_time');
  reset role;
  perform set_config('request.jwt.claim.sub', host::text, true);
  set local role authenticated;
  o := public.hk_submit_offer(r, g_link, '');
  reset role;
  perform set_config('request.jwt.claim.sub', req_user::text, true);
  set local role authenticated;
  perform public.hk_cancel_request(r);
  n := public.hk_mark_notifications_read();
  reset role;
  assert (select status = 'cancelled' from public.hk_request_offers where id = o), 'cancel request cancels offers';
  assert n > 0 and not exists (select 1 from public.hk_request_notifications where user_id = req_user and not is_read),
    'notifications marked read';
  raise notice 'request marketplace: all checks passed';
end $$;
rollback;
