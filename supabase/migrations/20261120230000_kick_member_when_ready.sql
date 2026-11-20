-- Owners can remove a member while the group is `ready` (everyone confirmed the totals): `ready`
-- is not an order lock, and removing someone simply starts a new revision for the others.
-- Replaces 20261028130742 (never applied), with one rule added for escrow: a member who has
-- already reported or had a payment verified cannot be removed, because their money is held by the
-- platform. Settle it first (admin rejects the slip or refunds the member).

create or replace function private.remove_group_member(p_group uuid, p_member uuid, p_request uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_group public.groups%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode = '42501'; end if;
  select * into v_group from public.groups where id = p_group for update;
  if not found or v_group.status = 'cancelled' then raise exception 'group_unavailable' using errcode = 'P0002'; end if;
  if v_group.owner_id <> v_user then raise exception 'owner_only' using errcode = '42501'; end if;
  if v_group.closed_at is not null then raise exception 'group_closed' using errcode = '23514'; end if;
  if p_member = v_user then raise exception 'owner_must_transfer' using errcode = '23514'; end if;
  if exists (
    select 1 from public.group_payment_reports r
    where r.group_id = p_group and r.user_id = p_member and r.status in ('reported', 'verified')
      and not private.member_refunded(p_group, null, p_member)
  ) or exists (
    select 1 from public.group_cycle_members m join public.group_cycles c on c.id = m.cycle_id
    where c.group_id = p_group and m.user_id = p_member and m.payment_status in ('reported', 'verified')
      and c.status <> 'closed' and not private.member_refunded(p_group, c.cycle_number, p_member)
  ) then
    raise exception 'member_has_paid' using errcode = '23514';
  end if;
  delete from public.group_members where group_id = p_group and user_id = p_member;
  if not found then raise exception 'not_group_member' using errcode = '42501'; end if;
  update public.groups set revision = revision + 1, status = 'awaiting_approval', updated_at = now()
  where id = p_group returning * into v_group;
  delete from public.group_approvals where group_id = p_group;
  perform private.refresh_group_totals(p_group);
  perform private.record_group_event(p_group, v_group.revision, 'member_left', v_user, p_request,
    jsonb_build_object('removed_user_id', p_member));
  return p_group;
end;
$$;

notify pgrst, 'reload schema';
