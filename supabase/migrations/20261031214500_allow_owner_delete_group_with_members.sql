-- Allow group owner to delete group even when members exist
create or replace function private.delete_group(p_group uuid,p_request uuid)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_user uuid:=auth.uid(); v_group public.groups%rowtype;
begin
  if v_user is null then raise exception 'authentication_required' using errcode='42501'; end if;
  select * into v_group from public.groups where id=p_group for update;
  if not found or v_group.status='cancelled' then raise exception 'group_unavailable' using errcode='P0002'; end if;
  if v_group.owner_id<>v_user then raise exception 'owner_only' using errcode='42501'; end if;
  delete from public.groups where id=p_group;
  return p_group;
end;
$$;

notify pgrst, 'reload schema';
