-- Notification conditions v2 (docs: HarnKhong Notification Logic, no marketplace).
-- Adds: payment reported -> owner, costs/leader changes, member removed, group full,
-- group closed/cancelled. Then trims noisy pushes: overdue only day 1/3/7, chat throttled
-- to one push per group per 5 minutes, cycle pushes only 'started' (all) and 'paid' (owner),
-- group detail edits no longer push.

-- Group events (the person who did it is never notified; only current members are)
create or replace function private.push_on_group_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_who text;
  v_body text;
begin
  if new.event_type not in ('member_joined', 'member_left', 'costs_changed', 'leadership_transferred') then
    return null;
  end if;
  select name into v_name from public.groups where id = new.group_id;
  select display_name into v_who from public.profiles where id = new.actor_id;
  v_body := case new.event_type
    when 'member_joined' then coalesce(v_who, 'สมาชิกใหม่') || ' เข้าร่วมกลุ่มแล้ว ตรวจยอดใหม่และยืนยันได้เลย'
    when 'member_left' then coalesce(v_who, 'สมาชิก') || ' ออกจากกลุ่มแล้ว ยอดของแต่ละคนอาจเปลี่ยน'
    when 'costs_changed' then 'ยอดหารของกลุ่มมีการเปลี่ยนแปลง ตรวจยอดใหม่และยืนยันได้เลย'
    else 'มีการเปลี่ยนเจ้าของกลุ่ม'
  end;
  perform private.queue_push(
    private.group_member_ids(new.group_id, new.actor_id),
    coalesce(v_name, 'กลุ่มของคุณ'), v_body,
    '/groups/' || new.group_id, 'group:' || new.group_id
  );
  return null;
end;
$$;

-- Payment reported -> group owner
create or replace function private.push_on_payment_reported()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_group uuid;
  v_owner uuid;
  v_name text;
  v_who text;
  v_cycle text;
begin
  if new.payment_status is distinct from 'reported'
     or (tg_op = 'UPDATE' and old.payment_status is not distinct from new.payment_status) then
    return null;
  end if;
  select c.group_id, g.owner_id, g.name, c.cycle_number into v_group, v_owner, v_name, v_cycle
  from public.group_cycles c join public.groups g on g.id = c.group_id where c.id = new.cycle_id;
  if v_owner is null or v_owner = new.user_id then return null; end if;
  select display_name into v_who from public.profiles where id = new.user_id;
  perform private.queue_push(
    array[v_owner], 'มีคนชำระเงินแล้ว 💰',
    format('%s ชำระ ฿%s · %s รอบที่ %s', coalesce(v_who, 'สมาชิก'),
      to_char(new.amount_satang / 100.0, 'FM999,999,990.00'), coalesce(v_name, 'กลุ่มของคุณ'), v_cycle),
    '/groups/' || v_group, 'paid:' || v_group
  );
  return null;
end;
$$;
drop trigger if exists push_on_payment_reported on public.group_cycle_members;
create trigger push_on_payment_reported after insert or update of payment_status on public.group_cycle_members
  for each row execute function private.push_on_payment_reported();

create or replace function private.push_on_report_submitted()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid;
  v_name text;
  v_who text;
begin
  if new.status is distinct from 'reported'
     or (tg_op = 'UPDATE' and old.status is not distinct from new.status) then
    return null;
  end if;
  select owner_id, name into v_owner, v_name from public.groups where id = new.group_id;
  if v_owner is null or v_owner = new.user_id then return null; end if;
  select display_name into v_who from public.profiles where id = new.user_id;
  perform private.queue_push(
    array[v_owner], 'มีคนชำระเงินแล้ว 💰',
    format('%s ชำระ ฿%s · %s', coalesce(v_who, 'สมาชิก'),
      to_char(new.amount_satang / 100.0, 'FM999,999,990.00'), coalesce(v_name, 'กลุ่มของคุณ')),
    '/groups/' || new.group_id, 'paid:' || new.group_id
  );
  return null;
end;
$$;
drop trigger if exists push_on_report_submitted on public.group_payment_reports;
create trigger push_on_report_submitted after insert or update of status on public.group_payment_reports
  for each row execute function private.push_on_report_submitted();

-- Member removed by someone else -> removed member (skipped when the group is gone/cancelled)
create or replace function private.push_on_member_removed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_actor uuid := auth.uid();
begin
  if v_actor is null or v_actor = old.user_id then return null; end if;
  select name into v_name from public.groups where id = old.group_id and status <> 'cancelled';
  if not found then return null; end if;
  perform private.queue_push(
    array[old.user_id], 'คุณถูกนำออกจากกลุ่ม', coalesce(v_name, 'กลุ่ม'), '/notifications', null
  );
  return null;
end;
$$;
drop trigger if exists push_on_member_removed on public.group_members;
create trigger push_on_member_removed after delete on public.group_members
  for each row execute function private.push_on_member_removed();

-- Group full -> everyone in the group, once per revision
create or replace function private.push_on_group_full()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  g record;
  v_count integer;
begin
  select id, name, capacity, revision into g from public.groups where id = new.group_id;
  if not found then return null; end if;
  select count(*) into v_count from public.group_members where group_id = new.group_id;
  if v_count < g.capacity then return null; end if;
  insert into private.push_reminder_log (key) values (format('full:%s:%s', g.id, g.revision))
  on conflict do nothing;
  if not found then return null; end if;
  perform private.queue_push(
    private.group_member_ids(g.id), coalesce(g.name, 'กลุ่มของคุณ'),
    'กลุ่มมีสมาชิกครบแล้ว! 🎉', '/groups/' || g.id, 'group:' || g.id
  );
  return null;
end;
$$;
drop trigger if exists push_on_group_full on public.group_members;
create trigger push_on_group_full after insert on public.group_members
  for each row execute function private.push_on_group_full();

-- Group closed / cancelled -> all members except whoever did it
create or replace function private.push_on_group_status()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_body text;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    v_body := 'กลุ่มถูกยกเลิกแล้ว';
  elsif new.closed_at is not null and old.closed_at is null then
    v_body := 'กลุ่มถูกปิดแล้ว';
  else
    return null;
  end if;
  perform private.queue_push(
    private.group_member_ids(new.id, coalesce(auth.uid(), new.closed_by)),
    coalesce(new.name, 'กลุ่มของคุณ'), v_body, '/groups/' || new.id, 'group:' || new.id
  );
  return null;
end;
$$;
drop trigger if exists push_on_group_status on public.groups;
create trigger push_on_group_status after update of status, closed_at on public.groups
  for each row execute function private.push_on_group_status();

-- Chat: at most one push per group per recipient every 5 minutes
create or replace function private.push_on_group_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_users uuid[];
begin
  select coalesce(array_agg(m.user_id), '{}') into v_users
  from public.group_members m
  where m.group_id = new.group_id
    and m.user_id is distinct from new.sender_id
    and not exists (
      select 1 from private.push_outbox o
      where o.user_id = m.user_id and o.tag = 'chat:' || new.group_id
        and o.created_at > now() - interval '5 minutes'
    );
  if cardinality(v_users) = 0 then return null; end if;
  select name into v_name from public.groups where id = new.group_id;
  perform private.queue_push(
    v_users, coalesce(v_name, 'แชตกลุ่ม'),
    left(new.sender_name || ': ' || new.body, 160),
    '/chat/' || new.group_id, 'chat:' || new.group_id
  );
  return null;
end;
$$;

-- Cycle: only 'started' (all members) and 'paid' (owner only)
create or replace function private.push_on_cycle_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_name text;
  v_owner uuid;
begin
  if new.event not in ('started', 'paid') then
    return null;
  end if;
  select name, owner_id into v_name, v_owner from public.groups where id = new.group_id;
  perform private.queue_push(
    case when new.event = 'paid' then array[v_owner] else private.group_member_ids(new.group_id) end,
    coalesce(v_name, 'กลุ่มของคุณ'),
    case new.event
      when 'started' then format('เริ่มรอบที่ %s แล้ว ยืนยันยอดและชำระเงินได้เลย', new.cycle_number)
      else format('รอบที่ %s: สมาชิกชำระครบทุกคนแล้ว', new.cycle_number)
    end,
    '/groups/' || new.group_id,
    'cycle:' || new.group_id
  );
  return null;
end;
$$;

-- Overdue reminders only on day 1, 3, 7 (already-sent 'overdue' counts as day 1)
update private.push_reminder_log set key = left(key, length(key) - length('overdue')) || 'overdue1'
where key like 'pay:%:overdue';

create or replace function private.queue_due_payment_pushes()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone 'Asia/Bangkok')::date;
  v_sent integer := 0;
  r record;
  v_level text;
  v_days integer;
begin
  for r in
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
    if v_days not in (1, 0, -1, -3, -7) then
      continue;
    end if;
    v_level := case when v_days = 1 then 'tomorrow' when v_days = 0 then 'today' else 'overdue' || (-v_days) end;
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
        else format('เลยกำหนดชำระมา %s วันแล้ว กรุณาชำระโดยเร็ว', -v_days)
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

revoke all on function private.push_on_payment_reported() from public, anon, authenticated;
revoke all on function private.push_on_report_submitted() from public, anon, authenticated;
revoke all on function private.push_on_member_removed() from public, anon, authenticated;
revoke all on function private.push_on_group_full() from public, anon, authenticated;
revoke all on function private.push_on_group_status() from public, anon, authenticated;
