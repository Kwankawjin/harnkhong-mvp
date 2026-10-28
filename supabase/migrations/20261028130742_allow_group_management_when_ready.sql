-- `ready` means all members approved the current revision; it is not an order lock.
-- Keep membership management available so kicking a member can start a fresh revision.
create or replace function private.remove_group_member(p_group uuid,p_member uuid,p_request uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_group public.groups%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select * into v_group from public.groups where id=p_group for update;
  if not found or v_group.status='cancelled' then raise exception 'group_unavailable' using errcode='P0002'; end if;
  if v_group.owner_id<>v_user then raise exception 'owner_only' using errcode='42501'; end if;
  if p_member=v_user then raise exception 'owner_must_transfer' using errcode='23514'; end if;
  delete from public.group_members where group_id=p_group and user_id=p_member;
  if not found then raise exception 'not_group_member' using errcode='42501'; end if;
  update public.groups set revision=revision+1,status='awaiting_approval',updated_at=now() where id=p_group returning * into v_group;
  delete from public.group_approvals where group_id=p_group;
  perform private.refresh_group_totals(p_group);
  perform private.record_group_event(p_group,v_group.revision,'member_left',v_user,p_request,jsonb_build_object('removed_user_id',p_member));
  return p_group;
end;
$$;

create or replace function private.delete_group(p_group uuid,p_request uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_group public.groups%rowtype; v_member_count integer;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select * into v_group from public.groups where id=p_group for update;
  if not found or v_group.status='cancelled' then raise exception 'group_unavailable' using errcode='P0002'; end if;
  if v_group.owner_id<>v_user then raise exception 'owner_only' using errcode='42501'; end if;
  select count(*) into v_member_count from public.group_members where group_id=p_group;
  if v_member_count>1 then raise exception 'group_has_members' using errcode='23514'; end if;
  delete from public.groups where id=p_group;
  return p_group;
end;
$$;

notify pgrst, 'reload schema';
