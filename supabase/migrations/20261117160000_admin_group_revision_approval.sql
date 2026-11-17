alter table public.groups
  add column admin_approved_revision integer,
  add column admin_approved_at timestamptz,
  add column admin_approved_by uuid references auth.users(id),
  add constraint groups_admin_approved_revision_check
    check (admin_approved_revision is null or admin_approved_revision > 0);

update public.groups
set admin_approved_revision = revision,
    admin_approved_at = updated_at
where status = 'ready';

create or replace function private.approve_group(p_group uuid,p_revision integer,p_request uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_group public.groups%rowtype; v_count integer; v_approved integer;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select * into v_group from public.groups where id=p_group for update;
  if not found or not exists(select 1 from public.group_members where group_id=p_group and user_id=v_user) then raise exception 'not_group_member' using errcode='42501'; end if;
  if p_revision<>v_group.revision then raise exception 'stale_revision' using errcode='40001'; end if;
  if exists(select 1 from public.group_approvals where group_id=p_group and user_id=v_user and revision=p_revision) then return p_group; end if;
  insert into public.group_approvals(group_id,user_id,revision) values(p_group,v_user,p_revision)
    on conflict(group_id,user_id) do update set revision=excluded.revision,approved_at=now();
  perform private.record_group_event(p_group,p_revision,'share_approved',v_user,p_request,'{}'::jsonb);
  select count(*) into v_count from public.group_members where group_id=p_group;
  select count(*) into v_approved from public.group_approvals where group_id=p_group and revision=p_revision;
  update public.groups set status=case when v_count=capacity and v_count=v_approved and admin_approved_revision=p_revision then 'ready' else 'awaiting_approval' end where id=p_group;
  return p_group;
end; $$;

create or replace function public.confirm_group_revision(p_group uuid,p_revision integer)
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

revoke all on function public.confirm_group_revision(uuid,integer) from public,anon,authenticated;
grant execute on function public.confirm_group_revision(uuid,integer) to authenticated;

notify pgrst, 'reload schema';
