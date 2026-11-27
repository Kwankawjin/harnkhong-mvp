-- Phone notifications (Web Push).
--
-- Each device that turns on notifications is saved in push_subscriptions. Things worth a
-- notification add rows to private.push_outbox (through private.queue_push), and the
-- `push-send` Edge Function delivers them with the VAPID keys and marks them sent.
--
-- The database wakes the function right away through pg_net, and pg_cron retries every
-- minute and sends the daily payment reminders. Both read two Vault secrets:
--   push_function_url  https://<project-ref>.supabase.co/functions/v1/push-send
--   push_cron_secret   the same random string as the function's PUSH_CRON_SECRET
-- Until those exist, rows simply wait in the outbox; nothing a person does ever fails
-- because a notification could not be sent.

do $$
begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net not available (%); pushes wait for the every-minute retry', sqlerrm;
end;
$$;

-- ============================================================ devices
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%' and char_length(endpoint) <= 1000),
  p256dh text not null check (char_length(p256dh) between 20 and 200),
  auth text not null check (char_length(auth) between 8 and 100),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;
-- People only touch their devices through the functions below; the Edge Function uses the
-- service role.
grant select, delete on public.push_subscriptions to service_role;

-- ============================================================ outbox
create table if not exists private.push_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 300),
  url text not null default '/notifications' check (url like '/%'),
  tag text check (tag is null or char_length(tag) <= 120),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  attempts smallint not null default 0
);
create index if not exists push_outbox_pending_idx on private.push_outbox (id) where sent_at is null;
create index if not exists push_outbox_user_idx on private.push_outbox (user_id);
revoke all on private.push_outbox from public, anon, authenticated;

-- Payment reminders already sent (one per member, share and level), so a reminder goes once.
create table if not exists private.push_reminder_log (
  key text primary key,
  created_at timestamptz not null default now()
);
revoke all on private.push_reminder_log from public, anon, authenticated;

-- ============================================================ sending
-- Wake the push-send function now. Never raises: a missing secret or a network error just
-- leaves the rows for the every-minute retry.
create or replace function private.kick_push()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  begin
    select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_function_url' limit 1;
    select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_cron_secret' limit 1;
    if v_url is null or v_secret is null then
      return;
    end if;
    perform net.http_post(
      url := v_url,
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
      body := '{}'::jsonb,
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'kick_push skipped: %', sqlerrm;
  end;
end;
$$;

-- Queue one notification for each person who has a device saved, then wake the sender.
create or replace function private.queue_push(
  p_users uuid[],
  p_title text,
  p_body text,
  p_url text default '/notifications',
  p_tag text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if p_users is null or cardinality(p_users) = 0 then
    return 0;
  end if;
  begin
    insert into private.push_outbox (user_id, title, body, url, tag)
    select distinct s.user_id,
      left(coalesce(nullif(btrim(p_title), ''), 'HarnKhong'), 120),
      left(coalesce(p_body, ''), 300),
      case when p_url like '/%' then p_url else '/notifications' end,
      left(p_tag, 120)
    from public.push_subscriptions s
    where s.user_id = any (p_users);
    get diagnostics v_count = row_count;
  exception when others then
    raise warning 'queue_push skipped: %', sqlerrm;
    return 0;
  end;
  if v_count > 0 then
    perform private.kick_push();
  end if;
  return v_count;
end;
$$;

-- ============================================================ device functions
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  -- A device belongs to whoever signed in on it last.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_user, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update
    set user_id = excluded.user_id,
        p256dh = excluded.p256dh,
        auth = excluded.auth,
        user_agent = excluded.user_agent,
        last_seen_at = now();
  -- At most 10 devices per account: drop the ones not seen for longest.
  delete from public.push_subscriptions
  where id in (
    select id from public.push_subscriptions
    where user_id = v_user
    order by last_seen_at desc
    offset 10
  );
end;
$$;

create or replace function public.delete_push_subscription(p_endpoint text)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

-- A test notification to every device on my account (at most one every 20 seconds).
create or replace function public.send_test_push()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'AUTH_REQUIRED' using errcode = '28000';
  end if;
  if exists (
    select 1 from private.push_outbox
    where user_id = v_user and tag = 'test' and created_at > now() - interval '20 seconds'
  ) then
    raise exception 'PUSH_TEST_TOO_SOON' using errcode = 'P0001';
  end if;
  return private.queue_push(array[v_user], 'ทดสอบแจ้งเตือน 🔔', 'แจ้งเตือนจากหารของเด้งขึ้นที่เครื่องนี้แล้ว', '/notifications', 'test');
end;
$$;

revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
revoke all on function public.delete_push_subscription(text) from public, anon;
revoke all on function public.send_test_push() from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;
grant execute on function public.delete_push_subscription(text) to authenticated;
grant execute on function public.send_test_push() to authenticated;
revoke all on function private.queue_push(uuid[], text, text, text, text) from public, anon, authenticated;
revoke all on function private.kick_push() from public, anon, authenticated;

-- The Edge Function claims and finishes outbox rows through these (service role only).
create or replace function public.push_claim_outbox(p_limit integer default 200)
returns table (id bigint, user_id uuid, title text, body text, url text, tag text)
language sql
security definer
set search_path = ''
as $$
  update private.push_outbox o
  set attempts = o.attempts + 1
  where o.id in (
    select x.id from private.push_outbox x
    where x.sent_at is null and x.attempts < 5
    order by x.id
    limit greatest(1, least(coalesce(p_limit, 200), 500))
    for update skip locked
  )
  returning o.id, o.user_id, o.title, o.body, o.url, o.tag;
$$;

create or replace function public.push_finish_outbox(p_ids bigint[])
returns void
language sql
security definer
set search_path = ''
as $$
  update private.push_outbox set sent_at = now() where id = any (p_ids);
  -- Keep a week of history.
  delete from private.push_outbox where created_at < now() - interval '7 days';
  delete from private.push_reminder_log where created_at < now() - interval '40 days';
$$;

-- Unread count for the red badge on the Home Screen icon (pushes not older than 3 days).
create or replace function public.push_badge_counts(p_users uuid[])
returns table (user_id uuid, unread integer)
language sql
stable
security definer
set search_path = ''
as $$
  select o.user_id, count(*)::integer
  from private.push_outbox o
  where o.user_id = any (p_users) and o.created_at > now() - interval '3 days' and coalesce(o.tag, '') <> 'test'
  group by o.user_id;
$$;

revoke all on function public.push_claim_outbox(integer) from public, anon, authenticated;
revoke all on function public.push_finish_outbox(bigint[]) from public, anon, authenticated;
revoke all on function public.push_badge_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.push_claim_outbox(integer) to service_role;
grant execute on function public.push_finish_outbox(bigint[]) to service_role;
grant execute on function public.push_badge_counts(uuid[]) to service_role;

-- push-send reads its VAPID keys and shared secret from Vault (service role only).
create or replace function public.push_config()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_object_agg(name, decrypted_secret)
  from vault.decrypted_secrets
  where name in ('vapid_public_key', 'vapid_private_key', 'vapid_subject', 'push_cron_secret');
$$;
revoke all on function public.push_config() from public, anon, authenticated;
grant execute on function public.push_config() to service_role;

-- ============================================================ what sends a notification
create or replace function private.group_member_ids(p_group uuid, p_except uuid default null)
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(m.user_id), '{}')
  from public.group_members m
  where m.group_id = p_group and m.user_id is distinct from p_except;
$$;

-- Monthly cycle started / confirmed / paid / closed -> everyone in the group.
create or replace function private.push_on_cycle_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  select name into v_name from public.groups where id = new.group_id;
  perform private.queue_push(
    private.group_member_ids(new.group_id),
    coalesce(v_name, 'กลุ่มของคุณ'),
    case new.event
      when 'started' then format('เริ่มรอบที่ %s แล้ว ยืนยันยอดและชำระเงินได้เลย', new.cycle_number)
      when 'confirmed' then format('รอบที่ %s: ทุกคนยืนยันยอดแล้ว', new.cycle_number)
      when 'paid' then format('รอบที่ %s: ชำระครบทุกคนแล้ว', new.cycle_number)
      else format('รอบที่ %s ปิดแล้ว', new.cycle_number)
    end,
    '/groups/' || new.group_id,
    'cycle:' || new.group_id
  );
  return null;
end;
$$;
drop trigger if exists push_on_cycle_history on public.group_cycle_history;
create trigger push_on_cycle_history after insert on public.group_cycle_history
  for each row execute function private.push_on_cycle_history();

-- Group chat message -> everyone in the group except the sender (one bubble per group).
create or replace function private.push_on_group_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  select name into v_name from public.groups where id = new.group_id;
  perform private.queue_push(
    private.group_member_ids(new.group_id, new.sender_id),
    coalesce(v_name, 'แชตกลุ่ม'),
    left(new.sender_name || ': ' || new.body, 160),
    '/chat/' || new.group_id,
    'chat:' || new.group_id
  );
  return null;
end;
$$;
drop trigger if exists push_on_group_message on public.group_messages;
create trigger push_on_group_message after insert on public.group_messages
  for each row execute function private.push_on_group_message();

-- Someone joined or left my group -> the other members.
create or replace function private.push_on_group_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_who text;
begin
  if new.event_type not in ('member_joined', 'member_left') then
    return null;
  end if;
  select name into v_name from public.groups where id = new.group_id;
  select display_name into v_who from public.profiles where id = new.actor_id;
  perform private.queue_push(
    private.group_member_ids(new.group_id, new.actor_id),
    coalesce(v_name, 'กลุ่มของคุณ'),
    case new.event_type
      when 'member_joined' then coalesce(v_who, 'สมาชิกใหม่') || ' เข้าร่วมกลุ่มแล้ว ตรวจยอดใหม่และยืนยันได้เลย'
      else coalesce(v_who, 'สมาชิก') || ' ออกจากกลุ่มแล้ว ยอดของแต่ละคนอาจเปลี่ยน'
    end,
    '/groups/' || new.group_id,
    null
  );
  return null;
end;
$$;
drop trigger if exists push_on_group_event on public.group_events;
create trigger push_on_group_event after insert on public.group_events
  for each row execute function private.push_on_group_event();

-- Monthly slip verified or rejected -> that member.
create or replace function private.push_on_cycle_payment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
  v_name text;
  v_cycle integer;
begin
  if new.payment_status is not distinct from old.payment_status
     or new.payment_status not in ('verified', 'rejected') then
    return null;
  end if;
  select c.group_id, c.cycle_number, g.name into v_group, v_cycle, v_name
  from public.group_cycles c join public.groups g on g.id = c.group_id
  where c.id = new.cycle_id;
  perform private.queue_push(
    array[new.user_id],
    case new.payment_status when 'verified' then 'แอดมินยืนยันสลิปแล้ว ✅' else 'สลิปไม่ผ่าน กรุณาโอนใหม่' end,
    format('%s · รอบที่ %s', coalesce(v_name, 'กลุ่มของคุณ'), v_cycle),
    '/groups/' || v_group,
    'slip:' || v_group
  );
  return null;
end;
$$;
drop trigger if exists push_on_cycle_payment on public.group_cycle_members;
create trigger push_on_cycle_payment after update of payment_status on public.group_cycle_members
  for each row execute function private.push_on_cycle_payment();

-- One-time group slip verified or rejected -> that member.
create or replace function private.push_on_payment_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if new.status is not distinct from old.status or new.status not in ('verified', 'rejected') then
    return null;
  end if;
  select name into v_name from public.groups where id = new.group_id;
  perform private.queue_push(
    array[new.user_id],
    case new.status when 'verified' then 'แอดมินยืนยันสลิปแล้ว ✅' else 'สลิปไม่ผ่าน กรุณาโอนใหม่' end,
    coalesce(v_name, 'กลุ่มของคุณ'),
    '/groups/' || new.group_id,
    'slip:' || new.group_id
  );
  return null;
end;
$$;
drop trigger if exists push_on_payment_report on public.group_payment_reports;
create trigger push_on_payment_report after update of status on public.group_payment_reports
  for each row execute function private.push_on_payment_report();

-- Admin paid the group owner -> the owner.
create or replace function private.push_on_payout()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  select name into v_name from public.groups where id = new.group_id;
  perform private.queue_push(
    array[new.owner_id],
    'ได้รับเงินจากกลุ่มแล้ว 💸',
    format('%s · ฿%s', coalesce(v_name, 'กลุ่มของคุณ'), to_char(new.net_satang / 100.0, 'FM999,999,990.00')),
    '/groups/' || new.group_id,
    null
  );
  return null;
end;
$$;
drop trigger if exists push_on_payout on public.group_payouts;
create trigger push_on_payout after insert on public.group_payouts
  for each row execute function private.push_on_payout();

-- Request marketplace notices -> the person they are for (same wording as the site).
create or replace function private.push_on_request_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_title text;
  v_host text;
  v_group text;
  v_head text;
  v_body text;
begin
  select r.title into v_title from public.hk_requests r where r.id = new.request_id;
  select o.host_name, o.group_snapshot ->> 'group_name' into v_host, v_group
  from public.hk_request_offers o where o.id = new.offer_id;
  v_title := coalesce(v_title, 'ประกาศของคุณ');
  case new.type
    when 'offer_received' then
      v_head := 'มีข้อเสนอใหม่!';
      v_body := format('%s เสนอกลุ่ม “%s” สำหรับ “%s”', coalesce(v_host, 'Host'), coalesce(v_group, '-'), v_title);
    when 'offer_accepted' then
      v_head := 'ข้อเสนอได้รับการยอมรับ';
      v_body := format('ผู้หากลุ่มยอมรับข้อเสนอสำหรับ “%s” ที่นั่งถูกจองไว้ 24 ชั่วโมง', v_title);
    when 'offer_rejected' then
      v_head := 'ข้อเสนอไม่ได้รับเลือก';
      v_body := format('ผู้หากลุ่มไม่ได้เลือกข้อเสนอของคุณสำหรับ “%s”', v_title);
    when 'offer_withdrawn' then
      v_head := 'Host ถอนข้อเสนอ';
      v_body := format('%s ถอนข้อเสนอสำหรับ “%s”', coalesce(v_host, 'Host'), v_title);
    when 'offer_cancelled' then
      v_head := 'ข้อเสนอถูกยกเลิก';
      v_body := format('กลุ่ม “%s” ไม่ได้เปิดรับแล้ว ข้อเสนอสำหรับ “%s” จึงถูกยกเลิก', coalesce(v_group, '-'), v_title);
    when 'request_cancelled' then
      v_head := 'ประกาศถูกยกเลิก';
      v_body := format('ผู้หากลุ่มยกเลิกประกาศ “%s” แล้ว', v_title);
    when 'request_expired' then
      v_head := 'ประกาศหมดอายุ';
      v_body := format('ประกาศ “%s” หมดอายุแล้ว', v_title);
    when 'reservation_expired' then
      v_head := 'การจองที่นั่งหมดเวลา';
      v_body := format('ที่นั่งที่จองไว้สำหรับ “%s” ถูกปล่อยแล้ว', v_title);
    else
      v_head := 'ผู้หากลุ่มเข้าร่วมแล้ว';
      v_body := format('ผู้หากลุ่มเข้าร่วมกลุ่ม “%s” จากประกาศ “%s” แล้ว', coalesce(v_group, '-'), v_title);
  end case;
  perform private.queue_push(
    array[new.user_id],
    v_head,
    v_body,
    case when new.request_id is null then '/my-requests' else '/requests/' || new.request_id end,
    null
  );
  return null;
end;
$$;
drop trigger if exists push_on_request_notification on public.hk_request_notifications;
create trigger push_on_request_notification after insert on public.hk_request_notifications
  for each row execute function private.push_on_request_notification();

-- Admin announcement -> every device.
create or replace function private.push_on_announcement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.expires_at is not null and new.expires_at <= now() then
    return null;
  end if;
  perform private.queue_push(
    (select coalesce(array_agg(distinct s.user_id), '{}') from public.push_subscriptions s),
    new.title,
    left(new.body, 200),
    '/notifications?tab=system',
    'ann:' || new.id
  );
  return null;
end;
$$;
drop trigger if exists push_on_announcement on public.system_announcements;
create trigger push_on_announcement after insert on public.system_announcements
  for each row execute function private.push_on_announcement();

-- ============================================================ daily payment reminders
-- Same rules as src/reminders.js: members (not the owner) who still owe, due on the pay day
-- (or 3 days after the cycle starts / the group became ready). One push the day before, one
-- on the day, one when overdue. Dates are Bangkok dates.
create or replace function private.queue_due_payment_pushes()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_sent integer := 0;
  r record;
  v_level text;
  v_days integer;
begin
  for r in
    -- Monthly groups: the member's share in the current open cycle.
    select g.id as group_id, g.name, m.user_id, c.cycle_number, m.amount_satang,
      m.payment_status = 'rejected' as rejected,
      ((case when g.pay_day is not null then c.starts_at else c.starts_at + interval '3 days' end)
        at time zone 'Asia/Bangkok')::date as due_date,
      'c' || c.cycle_number as share_key
    from public.group_cycles c
    join public.groups g on g.id = c.group_id
    join public.group_cycle_members m on m.cycle_id = c.id
    where g.status <> 'cancelled'
      and g.billing_mode = 'monthly'
      and c.status in ('awaiting_confirmation', 'confirmed')
      and c.ends_at > now()
      and m.user_id <> g.owner_id
      and (m.payment_status is null or m.payment_status = 'rejected')
    union all
    -- One-time groups: ready (everyone approved) and no slip sent for this revision.
    select g.id, g.name, gm.user_id, null::integer, null::bigint,
      coalesce(pr.status = 'rejected', false),
      ((ready.at + interval '3 days') at time zone 'Asia/Bangkok')::date,
      'r' || g.revision
    from public.groups g
    join public.group_members gm on gm.group_id = g.id
    cross join lateral (
      select max(e.created_at) as at from public.group_events e
      where e.group_id = g.id and e.revision = g.revision
    ) ready
    left join public.group_payment_reports pr
      on pr.group_id = g.id and pr.user_id = gm.user_id and pr.revision = g.revision
    where g.status = 'ready'
      and coalesce(g.billing_mode, 'one_time') <> 'monthly'
      and gm.user_id <> g.owner_id
      and ready.at is not null
      and (pr.status is null or pr.status = 'rejected')
      and (select count(*) from public.group_approvals a where a.group_id = g.id and a.revision = g.revision)
          >= (select count(*) from public.group_members x where x.group_id = g.id)
  loop
    v_days := r.due_date - v_today;
    if v_days > 1 or v_days < -7 then
      continue;
    end if;
    v_level := case when v_days = 1 then 'tomorrow' when v_days = 0 then 'today' else 'overdue' end;
    insert into private.push_reminder_log (key)
    values (format('pay:%s:%s:%s:%s', r.group_id, r.share_key, r.user_id, v_level))
    on conflict do nothing;
    if not found then
      continue;
    end if;
    v_sent := v_sent + private.queue_push(
      array[r.user_id],
      case
        when r.rejected then 'สลิปไม่ผ่าน กรุณาโอนใหม่'
        when v_level = 'tomorrow' then 'ครบกำหนดชำระพรุ่งนี้ ⏰'
        when v_level = 'today' then 'คุณต้องชำระเงินภายในวันนี้ ⚠️'
        else 'เลยกำหนดชำระแล้ว กรุณาชำระโดยเร็ว'
      end,
      r.name
        || case when r.cycle_number is not null then ' · รอบที่ ' || r.cycle_number else '' end
        || case when r.amount_satang is not null then ' · ฿' || to_char(r.amount_satang / 100.0, 'FM999,999,990.00') else '' end,
      '/groups/' || r.group_id,
      'pay:' || r.group_id
    );
  end loop;
  return v_sent;
end;
$$;
revoke all on function private.queue_due_payment_pushes() from public, anon, authenticated;
revoke all on function private.push_on_cycle_history() from public, anon, authenticated;
revoke all on function private.push_on_group_message() from public, anon, authenticated;
revoke all on function private.push_on_group_event() from public, anon, authenticated;
revoke all on function private.push_on_cycle_payment() from public, anon, authenticated;
revoke all on function private.push_on_payment_report() from public, anon, authenticated;
revoke all on function private.push_on_payout() from public, anon, authenticated;
revoke all on function private.push_on_request_notification() from public, anon, authenticated;
revoke all on function private.push_on_announcement() from public, anon, authenticated;
revoke all on function private.group_member_ids(uuid, uuid) from public, anon, authenticated;

-- ============================================================ schedules (pg_cron)
-- Reminders at 09:05 Bangkok (02:05 UTC) and a retry for anything still waiting every minute.
-- Skipped with a notice where pg_cron is not available (e.g. a bare local database).
do $$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname in ('harnkhong-push-reminders', 'harnkhong-push-retry');
  perform cron.schedule('harnkhong-push-reminders', '5 2 * * *', 'select private.queue_due_payment_pushes()');
  perform cron.schedule(
    'harnkhong-push-retry',
    '* * * * *',
    $job$select private.kick_push() where exists (select 1 from private.push_outbox where sent_at is null and attempts < 5)$job$
  );
exception when others then
  raise notice 'pg_cron not set up (%); enable it in Database -> Extensions and run this block again', sqlerrm;
end;
$$;
