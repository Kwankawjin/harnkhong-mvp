create or replace function private.confirm_group_revision(p_group uuid,p_revision integer)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_group public.groups%rowtype; v_members integer; v_approved integer;
begin
  if v_user is null or coalesce(auth.jwt()->'app_metadata'->>'role','')<>'admin' then
    raise exception 'admin_only' using errcode='42501';
  end if;
  select * into v_group from public.groups where id=p_group for update;
  if not found or v_group.status='cancelled' then raise exception 'group_unavailable' using errcode='P0002'; end if;
  if v_group.revision<>p_revision then raise exception 'stale_revision' using errcode='40001'; end if;
  select count(*) into v_members from public.group_members where group_id=p_group;
  select count(*) into v_approved from public.group_approvals where group_id=p_group and revision=p_revision;
  if v_members<>v_group.capacity or v_approved<>v_members then
    raise exception 'members_not_approved' using errcode='23514';
  end if;
  update public.groups
  set admin_approved_revision=p_revision,admin_approved_at=now(),admin_approved_by=v_user,
      status='ready',updated_at=now()
  where id=p_group and revision=p_revision;
  return jsonb_build_object('group_id',p_group,'revision',p_revision,'status','ready');
end; $$;

revoke all on function private.confirm_group_revision(uuid,integer) from public,anon,authenticated;
grant execute on function private.confirm_group_revision(uuid,integer) to authenticated;

create or replace function public.confirm_group_revision(p_group uuid,p_revision integer)
returns jsonb language sql security invoker set search_path=''
as $$
  select private.confirm_group_revision(p_group,p_revision)
$$;

revoke all on function public.confirm_group_revision(uuid,integer) from public,anon,authenticated;
grant execute on function public.confirm_group_revision(uuid,integer) to authenticated;

notify pgrst, 'reload schema';
