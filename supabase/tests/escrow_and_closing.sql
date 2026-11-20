-- Checks for 20261120210000_shipping_auto_receipt_disputes.sql. Run the whole file in one
-- transaction: it creates fake users and a group, prints the results, then rolls everything back.
-- Needs a products row with id 'p1'.
begin;
-- 1. Money held / released at each step
create temp table out(step text, held bigint, releasable bigint, owed bigint) on commit drop;
-- owner o, members a and b, both paid 100.00 (10000 satang), verified
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c');
insert into public.groups (id, owner_id, request_id, listing_id, name, visibility, capacity, product_satang, delivery_per_member_satang, pricing_mode)
values ('11111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000c', gen_random_uuid(), 'p1', 'QA group', 'link', 3, 30000, 0, 'seat_v3');
insert into public.group_payment_reports (group_id, user_id, revision, amount_satang, status, verified_at, verified_by)
values ('11111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a',1,10000,'verified',now(),'00000000-0000-0000-0000-00000000000c'),
       ('11111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b',1,10000,'verified',now(),'00000000-0000-0000-0000-00000000000c');
insert into out select 'paid, not shipped', held_satang, releasable_satang, owed_satang from private.group_payout_summary('11111111-0000-0000-0000-000000000001');
insert into public.group_shipments (group_id, shipped_at, shipped_by) values ('11111111-0000-0000-0000-000000000001', now() - interval '3 days', '00000000-0000-0000-0000-00000000000c');
insert into out select 'shipped 3 days ago', held_satang, releasable_satang, owed_satang from private.group_payout_summary('11111111-0000-0000-0000-000000000001');
update public.group_shipments set shipped_at = now() - interval '8 days';
insert into out select 'shipped 8 days ago -> auto', held_satang, releasable_satang, owed_satang from private.group_payout_summary('11111111-0000-0000-0000-000000000001');
insert into public.group_disputes (group_id, user_id, reason) values ('11111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b','ของไม่มาถึง');
insert into out select 'b reported problem', held_satang, releasable_satang, owed_satang from private.group_payout_summary('11111111-0000-0000-0000-000000000001');
update public.group_disputes set status = 'refunded';
insert into out select 'admin refunded b', held_satang, releasable_satang, owed_satang from private.group_payout_summary('11111111-0000-0000-0000-000000000001');
update public.group_disputes set status = 'released';
insert into out select 'admin released b instead', held_satang, releasable_satang, owed_satang from private.group_payout_summary('11111111-0000-0000-0000-000000000001');
select * from out;

rollback;

begin;
-- 2. Who may call which function
create temp table out(step text, held bigint, releasable bigint, owed bigint) on commit drop;
-- owner o, members a and b, both paid 100.00 (10000 satang), verified
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c');
insert into public.groups (id, owner_id, request_id, listing_id, name, visibility, capacity, product_satang, delivery_per_member_satang, pricing_mode)
values ('11111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000c', gen_random_uuid(), 'p1', 'QA group', 'link', 3, 30000, 0, 'seat_v3');
insert into public.group_payment_reports (group_id, user_id, revision, amount_satang, status, verified_at, verified_by)
values ('11111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a',1,10000,'verified',now(),'00000000-0000-0000-0000-00000000000c'),
       ('11111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b',1,10000,'verified',now(),'00000000-0000-0000-0000-00000000000c');
create temp table r(step text, result text) on commit drop;
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); $$;
-- member a cannot mark shipped
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin perform public.mark_group_shipped('11111111-0000-0000-0000-000000000001'); insert into r values ('a marks shipped','ALLOWED (bad)'); exception when others then insert into r values ('a marks shipped', sqlerrm); end $$;
-- owner marks shipped twice: keeps first time
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
insert into r select 'owner ship #1', (public.mark_group_shipped('11111111-0000-0000-0000-000000000001', null, 'Kerry 123'))->>'shippedAt';
update public.group_shipments set shipped_at = shipped_at - interval '2 days';
insert into r select 'owner ship #2 keeps first', ((public.mark_group_shipped('11111111-0000-0000-0000-000000000001'))->>'shippedAt')::timestamptz < now() - interval '1 day';
-- b reports a problem; twice fails
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into r select 'b reports', (public.report_group_problem('11111111-0000-0000-0000-000000000001', null, 'ของยังไม่ถึงเลย'))->>'status';
do $$ begin perform public.report_group_problem('11111111-0000-0000-0000-000000000001', null, 'ซ้ำอีกครั้ง'); insert into r values ('b reports again','ALLOWED (bad)'); exception when others then insert into r values ('b reports again', sqlerrm); end $$;
-- a confirms receipt, then cannot report
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
insert into r select 'a confirms', (public.confirm_group_receipt('11111111-0000-0000-0000-000000000001'))->>'received';
do $$ begin perform public.report_group_problem('11111111-0000-0000-0000-000000000001', null, 'เปลี่ยนใจ'); insert into r values ('a reports after receipt','ALLOWED (bad)'); exception when others then insert into r values ('a reports after receipt', sqlerrm); end $$;
-- non-admin cannot resolve
do $$ begin perform public.admin_resolve_dispute((select id from public.group_disputes limit 1), 'released', 'ok'); insert into r values ('member resolves','ALLOWED (bad)'); exception when others then insert into r values ('member resolves', sqlerrm); end $$;
-- b confirms receipt after reporting: settles the report
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
insert into r select 'b confirms after report', (public.confirm_group_receipt('11111111-0000-0000-0000-000000000001'))->>'received';
insert into r select 'dispute now', status from public.group_disputes;
insert into r select 'summary owed', owed_satang::text from private.group_payout_summary('11111111-0000-0000-0000-000000000001');
select * from r;

rollback;

-- 3. Closing finished groups (needs 20261120220000_close_finished_groups.sql)
begin;
create temp table out(step text, held bigint, releasable bigint, owed bigint) on commit drop;
-- owner o, members a and b, both paid 100.00 (10000 satang), verified
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c');
insert into public.groups (id, owner_id, request_id, listing_id, name, visibility, capacity, product_satang, delivery_per_member_satang, pricing_mode)
values ('11111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000c', gen_random_uuid(), 'p1', 'QA group', 'link', 3, 30000, 0, 'seat_v3');
insert into public.group_payment_reports (group_id, user_id, revision, amount_satang, status, verified_at, verified_by)
values ('11111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000a',1,10000,'verified',now(),'00000000-0000-0000-0000-00000000000c'),
       ('11111111-0000-0000-0000-000000000001','00000000-0000-0000-0000-00000000000b',1,10000,'verified',now(),'00000000-0000-0000-0000-00000000000c');
create temp table r(step text, result text) on commit drop;
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); $$;
insert into r select 'finished: paid, not shipped', private.group_finished('11111111-0000-0000-0000-000000000001')::text;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin perform public.close_group('11111111-0000-0000-0000-000000000001'); insert into r values ('owner closes too early','ALLOWED (bad)'); exception when others then insert into r values ('owner closes too early', sqlerrm); end $$;
insert into public.group_shipments (group_id, shipped_at, shipped_by) values ('11111111-0000-0000-0000-000000000001', now() - interval '8 days', '00000000-0000-0000-0000-00000000000c');
insert into r select 'finished: received, owner not paid', private.group_finished('11111111-0000-0000-0000-000000000001')::text;
insert into public.group_payouts (group_id, owner_id, net_satang, paid_by) values ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000c', 19600, '00000000-0000-0000-0000-00000000000c');
insert into r select 'finished: owner paid', private.group_finished('11111111-0000-0000-0000-000000000001')::text;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin perform public.close_group('11111111-0000-0000-0000-000000000001'); insert into r values ('member closes','ALLOWED (bad)'); exception when others then insert into r values ('member closes', sqlerrm); end $$;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
insert into r select 'owner closes', (public.close_group('11111111-0000-0000-0000-000000000001'))->>'closed';
do $$ begin insert into public.group_members (group_id, user_id, display_name) values ('11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'b'); insert into r values ('join closed group','ALLOWED (bad)'); exception when others then insert into r values ('join closed group', sqlerrm); end $$;
insert into public.group_members (group_id, user_id, display_name) select '11111111-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'a' where false;
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b');
do $$ begin perform public.hide_group_for_me('11111111-0000-0000-0000-000000000001'); insert into r values ('non-member hides','ALLOWED (bad)'); exception when others then insert into r values ('non-member hides', sqlerrm); end $$;
select * from r;

rollback;

-- 4. Removing members (needs 20261120230000_kick_member_when_ready.sql)
begin;
create temp table r(step text, result text) on commit drop;
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true); $$;
insert into auth.users (id) values ('00000000-0000-0000-0000-00000000000a'),('00000000-0000-0000-0000-00000000000b'),('00000000-0000-0000-0000-00000000000c');
insert into public.groups (id, owner_id, request_id, listing_id, name, visibility, capacity, product_satang, delivery_per_member_satang, pricing_mode, status, total_satang)
values ('11111111-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000c', gen_random_uuid(), 'p1', 'QA kick', 'link', 3, 30000, 0, 'seat_v3', 'ready', 30000);
insert into public.group_members (group_id, user_id, display_name) values
 ('11111111-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000c','owner'),
 ('11111111-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000a','a'),
 ('11111111-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000b','b');
insert into public.group_payment_reports (group_id, user_id, revision, amount_satang, status)
values ('11111111-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000a',1,10000,'reported');
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c');
do $$ begin perform public.remove_group_member('11111111-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000a', gen_random_uuid()); insert into r values ('kick member who paid','ALLOWED (bad)'); exception when others then insert into r values ('kick member who paid', sqlerrm); end $$;
insert into r select 'kick unpaid member while ready', public.remove_group_member('11111111-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000b', gen_random_uuid())::text;
insert into r select 'status after kick', status from public.groups where id = '11111111-0000-0000-0000-000000000002';
insert into r select 'members left', count(*)::text from public.group_members where group_id = '11111111-0000-0000-0000-000000000002';
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a');
do $$ begin perform public.remove_group_member('11111111-0000-0000-0000-000000000002','00000000-0000-0000-0000-00000000000c', gen_random_uuid()); insert into r values ('member kicks owner','ALLOWED (bad)'); exception when others then insert into r values ('member kicks owner', sqlerrm); end $$;
select * from r;

rollback;
