-- Seat pricing, 2% commission taken from the owner's payout, monthly cycles and Plus subscription.
-- Run as postgres (SQL editor or supabase/tests/local/run.sh). Everything is rolled back.
begin;
do $$
declare
  owner uuid := gen_random_uuid(); a uuid := gen_random_uuid(); b uuid := gen_random_uuid();
  late uuid := gen_random_uuid(); admin uuid := gen_random_uuid();
  g uuid; m uuid; legacy uuid; c1 uuid; c2 uuid; pay uuid; v jsonb; amt bigint;
  slip text; n integer;
  product jsonb := '{"type":"digital","title":"Netflix Premium","category":"แอปพลิเคชันและเว็บไซต์"}';
  form_details jsonb := jsonb_build_object('minimumMembers', 2, 'closesAt', (current_date + 7)::text);
begin
  insert into auth.users(id, aud, role, email)
    select id, 'authenticated', 'authenticated', id::text || '@example.invalid'
    from unnest(array[owner, a, b, late, admin]) id;
  insert into public.profiles(id, display_name)
    values (owner, 'Owner'), (a, 'A'), (b, 'B'), (late, 'Late'), (admin, 'Admin')
    on conflict (id) do update set display_name = excluded.display_name;

  -- ---------------------------------------------------------------- one-time group, seat pricing
  perform set_config('request.jwt.claim.sub', owner::text, true);
  set local role authenticated;
  g := public.create_group_from_form(gen_random_uuid(), 'One-time', array['แอปพลิเคชันและเว็บไซต์'],
    '[]'::jsonb, 'public', 4, 0, 40000, product, form_details);
  reset role;
  assert (select pricing_mode = 'seat_v3' and billing_mode = 'one_time' from public.groups where id = g),
    'new groups use seat pricing and one-time billing by default';
  assert (select service_satang = 0 and total_satang = 40000 from public.groups where id = g),
    'no fee on top: the total is the seats';
  assert private.group_member_amount(g, owner) = 40000,
    'alone, the owner carries every empty seat';
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  perform public.join_group(g, gen_random_uuid(), null);
  reset role;
  assert private.group_member_amount(g, a) = 10000, 'a participant pays one seat and no fee';
  assert private.group_member_amount(g, owner) = 30000, 'the owner carries own seat and two empty seats';
  assert (select total_satang = 40000 from public.groups where id = g), 'the total does not move when people join';

  -- Legacy groups keep the old rule.
  update public.groups set pricing_mode = 'per_member_v2' where id = g;
  perform private.refresh_group_totals(g);
  assert (select total_satang = 40800 and service_satang = 800 from public.groups where id = g),
    'per_member_v2 totals are computed by people present (2 here, no delivery: same numbers)';
  update public.groups set pricing_mode = 'seat_v3' where id = g;
  perform private.refresh_group_totals(g);

  -- A member who approved can upload a slip for the current revision and report it (storage RLS).
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  perform public.approve_group(g, (select revision from public.groups where id = g), gen_random_uuid());
  slip := a::text || '/' || g::text || '/' || (select revision from public.groups where id = g)::text || '/' || gen_random_uuid()::text || '.png';
  insert into storage.objects(bucket_id, name, owner) values ('group-payment-slips', slip, a);
  v := public.report_group_payment_with_slip(g, (select revision from public.groups where id = g), slip, now());
  reset role;
  assert (v->>'amount_satang')::bigint = 10000 or (select amount_satang = 10000 from public.group_payment_reports where group_id = g and user_id = a),
    'the slip report charges the member one seat';
  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  begin
    insert into storage.objects(bucket_id, name, owner)
      values ('group-payment-slips', b::text || '/' || g::text || '/1/' || gen_random_uuid()::text || '.png', b);
    raise exception 'a non-member uploaded a group slip';
  exception when insufficient_privilege then null; end;
  reset role;

  -- ---------------------------------------------------------------- monthly group
  perform set_config('request.jwt.claim.sub', owner::text, true);
  set local role authenticated;
  m := public.create_group_from_form(gen_random_uuid(), 'Monthly', array['แอปพลิเคชันและเว็บไซต์'],
    '[]'::jsonb, 'public', 4, 0, 41900, product, form_details || '{"billing":"monthly"}');
  reset role;
  assert (select billing_mode = 'monthly' and not details ? 'billing' from public.groups where id = m),
    'billing is stored on the group, not in details';

  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  perform public.join_group(m, gen_random_uuid(), null);
  begin
    perform public.start_group_cycle(m);
    raise exception 'a member started the cycle';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', owner::text, true);
  c1 := public.start_group_cycle(m);
  reset role;
  assert (select count(*) = 2 from public.group_cycle_members where cycle_id = c1), 'cycle 1 holds owner and a';
  assert (select amount_satang = 10475 from public.group_cycle_members where cycle_id = c1 and user_id = a),
    'a pays one seat';
  assert (select sum(amount_satang) = 41900 from public.group_cycle_members where cycle_id = c1),
    'the cycle seats add up to the product, with nothing on top';
  assert (select ends_at = private.add_month(starts_at) from public.group_cycles where id = c1), 'a cycle lasts one month';

  -- Mid-cycle join: this cycle does not change.
  perform set_config('request.jwt.claim.sub', late::text, true);
  set local role authenticated;
  perform public.join_group(m, gen_random_uuid(), null);
  begin
    perform public.confirm_group_cycle(m, 1);
    raise exception 'a mid-cycle joiner confirmed this cycle';
  exception when insufficient_privilege then null; end;
  reset role;
  assert (select count(*) = 2 and sum(amount_satang) = 41900 from public.group_cycle_members where cycle_id = c1),
    'joining mid-cycle changes neither the people nor the amounts of this cycle';

  -- Confirm once; the cycle is complete.
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  perform public.confirm_group_cycle(m, 1);
  begin
    perform public.confirm_group_cycle(m, 1);
    raise exception 'confirmed twice';
  exception when unique_violation then null; end;
  perform set_config('request.jwt.claim.sub', owner::text, true);
  perform public.confirm_group_cycle(m, 1);
  reset role;
  assert (select status = 'confirmed' from public.group_cycles where id = c1), 'everyone confirmed: cycle complete';

  -- Payments: report with a slip, admin verifies; all verified = paid.
  slip := a::text || '/' || m::text || '/1/' || gen_random_uuid()::text || '.jpg';
  insert into storage.objects(bucket_id, name, owner) values ('cycle-payment-slips', slip, a);
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  perform public.report_group_cycle_payment(m, 1, slip, now());
  reset role;
  -- The owner does not transfer for their own seat.
  slip := owner::text || '/' || m::text || '/1/' || gen_random_uuid()::text || '.png';
  insert into storage.objects(bucket_id, name, owner) values ('cycle-payment-slips', slip, owner);
  perform set_config('request.jwt.claim.sub', owner::text, true);
  set local role authenticated;
  begin
    perform public.report_group_cycle_payment(m, 1, slip, now());
    raise exception 'the owner reported a transfer';
  exception when check_violation then
    if sqlerrm <> 'owner_receives_payout' then raise; end if;
  end;
  reset role;
  perform public.verify_group_cycle_payment(m, 1, a, admin);
  assert (select status = 'paid' from public.group_cycles where id = c1), 'every member except the owner verified: cycle paid';
  -- Payout: a paid 10475, the platform keeps 2% (210), the owner is owed 10265.
  assert (select gross_satang = 10475 and commission_satang = 210 and net_satang = 10265 and owed_satang = 10265
          from private.group_payout_summary(m)), 'the owner is owed the member payment minus 2%';
  perform set_config('request.jwt.claim.sub', owner::text, true);
  set local role authenticated;
  assert (public.my_group_payout(m)->>'net')::bigint = 10265, 'the owner sees what they will receive';
  perform set_config('request.jwt.claim.sub', a::text, true);
  begin
    perform public.my_group_payout(m);
    raise exception 'a member read the owner payout';
  exception when insufficient_privilege then null; end;
  reset role;

  -- A leaver keeps this cycle; month two opens with today's people and asks again.
  perform set_config('request.jwt.claim.sub', a::text, true);
  set local role authenticated;
  perform public.leave_group(m, gen_random_uuid());
  reset role;
  update public.groups set cycle_anchor = cycle_anchor - interval '1 month' - interval '1 minute' where id = m;
  update public.group_cycles set starts_at = starts_at - interval '1 month' - interval '1 minute',
    ends_at = ends_at - interval '1 month' - interval '1 minute' where id = c1;
  perform set_config('request.jwt.claim.sub', owner::text, true);
  set local role authenticated;
  perform public.sync_group_cycles(m);
  perform public.sync_group_cycles(m);
  reset role;
  assert (select status = 'closed' and closed_from = 'paid' from public.group_cycles where id = c1), 'month one closed';
  select id into c2 from public.group_cycles where group_id = m and cycle_number = 2;
  assert c2 is not null, 'month two opened';
  assert (select count(*) = 2 from public.group_cycles where group_id = m), 'syncing twice opens one cycle';
  assert (select array_agg(user_id order by seat_index) = array[owner, late] from public.group_cycle_members where cycle_id = c2),
    'month two has the owner and the late joiner, not the leaver';
  assert (select bool_and(confirmed_at is null) from public.group_cycle_members where cycle_id = c2),
    'a new month asks for confirmation again';
  assert (select starts_at = (select ends_at from public.group_cycles where id = c1) from public.group_cycles where id = c2),
    'months are back to back';

  -- ---------------------------------------------------------------- Plus subscription
  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  v := public.my_subscription();
  assert v->>'plan' = 'free' and (v->>'groupLimit')::int = 2, 'everyone starts on Free';
  reset role;
  slip := b::text || '/' || gen_random_uuid()::text || '.webp';
  insert into storage.objects(bucket_id, name, owner) values ('subscription-payment-slips', slip, b);
  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  v := public.report_subscription_payment(slip, now());
  pay := (v->>'id')::uuid;
  assert (v->>'amount')::bigint = 4900, 'Plus costs 49 baht a month';
  begin
    perform public.report_subscription_payment(slip, now());
    raise exception 'two pending slips';
  exception when unique_violation then null; end;
  assert public.my_subscription()->>'plan' = 'free', 'still Free until an admin verifies';
  begin
    perform public.verify_subscription_payment(pay, b);
    raise exception 'a member verified their own payment';
  exception when insufficient_privilege then null; end;
  reset role;
  v := public.verify_subscription_payment(pay, admin);
  assert (select status = 'active' and plan = 'plus' and period_end = private.add_month(period_start)
          from public.subscriptions where user_id = b), 'verified: Plus for one month';
  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  v := public.my_subscription();
  assert v->>'plan' = 'plus' and (v->>'groupLimit')::int = 5, 'Plus raises the group limit';
  reset role;

  -- Renew early: the new month starts where the paid one ends.
  slip := b::text || '/' || gen_random_uuid()::text || '.jpg';
  insert into storage.objects(bucket_id, name, owner) values ('subscription-payment-slips', slip, b);
  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  pay := (public.report_subscription_payment(slip, now())->>'id')::uuid;
  reset role;
  perform public.verify_subscription_payment(pay, admin);
  assert (select period_end = private.add_month(period_start, 2) from public.subscriptions where user_id = b),
    'renewing before the end adds a month after the current end';

  -- Expiry: back to Free.
  update public.subscriptions set period_start = now() - interval '3 months', period_end = now() - interval '1 second'
  where user_id = b;
  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  assert public.my_subscription()->>'plan' = 'free', 'an ended month is Free';
  reset role;
  assert (select status = 'expired' from public.subscriptions where user_id = b), 'and is marked expired';

  -- Rejected slip.
  slip := b::text || '/' || gen_random_uuid()::text || '.jpg';
  insert into storage.objects(bucket_id, name, owner) values ('subscription-payment-slips', slip, b);
  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  pay := (public.report_subscription_payment(slip, now())->>'id')::uuid;
  reset role;
  perform public.reject_subscription_payment(pay, admin, 'ยอดไม่ตรง');
  assert (select status = 'expired' from public.subscriptions where user_id = b), 'rejection leaves the plan expired';
  begin
    perform public.verify_subscription_payment(pay, admin);
    raise exception 'verified a rejected slip';
  exception when check_violation then null; end;

  -- ---------------------------------------------------------------- admin RPCs
  slip := b::text || '/' || gen_random_uuid()::text || '.jpg';
  insert into storage.objects(bucket_id, name, owner) values ('subscription-payment-slips', slip, b);
  perform set_config('request.jwt.claim.sub', b::text, true);
  set local role authenticated;
  pay := (public.report_subscription_payment(slip, now())->>'id')::uuid;
  begin
    perform public.admin_billing_queue();
    raise exception 'a member read the admin queue';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_review_subscription_payment(pay, true);
    raise exception 'a member approved their own slip';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub', admin::text, true);
  perform set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
  v := public.admin_billing_queue();
  assert jsonb_array_length(v->'subscriptions') >= 1 and jsonb_array_length(v->'cycles') >= 1,
    'the admin queue lists Plus and monthly slips';
  begin
    perform public.admin_review_subscription_payment(pay, false, 'x');
    raise exception 'rejected without a reason';
  exception when invalid_parameter_value then null; end;
  perform public.admin_review_subscription_payment(pay, true);
  v := public.admin_payouts();
  assert exists (select 1 from jsonb_array_elements(v) e where (e->>'group_id')::uuid = m and (e->>'owed_satang')::bigint = 10265),
    'the admin sees the money owed to the owner';
  perform public.admin_record_payout(m, 'โอนผ่าน PromptPay');
  assert exists (select 1 from jsonb_array_elements(public.admin_payouts()) e
                 where (e->>'group_id')::uuid = m and (e->>'owed_satang')::bigint = 0 and (e->>'paid_out_satang')::bigint = 10265),
    'a recorded payout clears what is owed';
  begin
    perform public.admin_record_payout(m);
    raise exception 'paid the same money twice';
  exception when check_violation then null; end;
  v := public.admin_list_groups();
  assert jsonb_array_length(v) >= 2 and (v->0) ? 'member_count' and (v->0) ? 'owner_email',
    'the admin sees every group with counts and the owner email';
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', b::text, true);
  begin
    perform public.admin_delete_group(m);
    raise exception 'a member deleted a group through the admin RPC';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_list_groups();
    raise exception 'a member listed every group';
  exception when insufficient_privilege then null; end;
  reset role;
  assert (select status = 'active' from public.subscriptions where user_id = b), 'an admin approval through the RPC activates Plus';

  -- ---------------------------------------------------------------- plan limit
  perform set_config('request.jwt.claim.sub', owner::text, true);
  set local role authenticated;
  begin
    perform public.create_group_from_form(gen_random_uuid(), 'Third', array['แอปพลิเคชันและเว็บไซต์'],
      '[]'::jsonb, 'public', 3, 0, 9000, product, form_details);
    raise exception 'Free created a third open group';
  exception when check_violation then
    if sqlerrm <> 'group_limit_reached' then raise; end if;
  end;
  begin
    perform public.create_group_from_form(gen_random_uuid(), 'Bad billing', array['x'],
      '[]'::jsonb, 'public', 3, 0, 9000, product, form_details || '{"billing":"weekly"}');
    raise exception 'accepted an unknown billing mode';
  exception when invalid_parameter_value then null; end;
  reset role;
  -- ---------------------------------------------------------------- admin delete (last: it frees the owner's quota)
  perform set_config('request.jwt.claim.sub', admin::text, true);
  perform set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', true);
  set local role authenticated;
  perform public.admin_delete_group(g);
  perform set_config('request.jwt.claims', '', true);
  reset role;
  -- Checked as postgres, so row-level security cannot hide a row that still exists.
  assert not exists (select 1 from public.groups where id = g), 'the admin deleted a group that has payment reports';
  assert not exists (select 1 from public.group_payment_reports where group_id = g), 'its payment reports went with it';
end $$;
rollback;
