-- The owner of a monthly group can change its pay day until the first cycle starts. After that
-- the cycle dates are fixed, so members are never moved to a different due date mid-way.
create or replace function public.set_group_pay_day(p_group uuid, p_pay_day integer)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group public.groups%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into v_group from public.groups where id = p_group for update;
  if not found or v_group.status = 'cancelled' then raise exception 'group_unavailable' using errcode = 'P0002'; end if;
  if v_group.owner_id <> auth.uid() then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_group.billing_mode <> 'monthly' then raise exception 'not_monthly' using errcode = '23514'; end if;
  if v_group.cycle_anchor is not null then raise exception 'cycle_started' using errcode = '23514'; end if;
  if p_pay_day is null or p_pay_day not between 1 and 28 then raise exception 'invalid_pay_day' using errcode = '22023'; end if;
  update public.groups set pay_day = p_pay_day, updated_at = now() where id = p_group;
  return p_pay_day;
end;
$$;
revoke all on function public.set_group_pay_day(uuid, integer) from public, anon;
grant execute on function public.set_group_pay_day(uuid, integer) to authenticated;
