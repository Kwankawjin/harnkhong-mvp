alter table public.group_events
  drop constraint if exists group_events_event_type_check;

alter table public.group_events
  add constraint group_events_event_type_check
  check (event_type in (
    'group_created', 'member_joined', 'member_left', 'costs_changed',
    'leadership_transferred', 'share_approved', 'group_details_changed'
  ));

create or replace function private.update_group_details(
  p_group uuid,
  p_request uuid,
  p_name text,
  p_details jsonb,
  p_visibility text,
  p_delivery bigint
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_group public.groups%rowtype;
  v_minimum integer;
  v_close_date date;
begin
  if v_user is null then
    raise exception 'authentication_required' using errcode = '42501';
  end if;
  if p_request is null
    or p_name is null or char_length(btrim(p_name)) not between 1 and 70
    or jsonb_typeof(p_details) <> 'object'
    or p_visibility not in ('public', 'link')
    or p_delivery not between 0 and 9007199254740991 then
    raise exception 'invalid_group_details' using errcode = '22023';
  end if;

  select * into v_group from public.groups where id = p_group for update;
  if not found or v_group.status = 'cancelled' then
    raise exception 'group_unavailable' using errcode = 'P0002';
  end if;
  if v_group.owner_id <> v_user then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  v_minimum := nullif(p_details->>'minimumMembers', '')::integer;
  v_close_date := nullif(p_details->>'closesAt', '')::date;
  if v_minimum is null or v_minimum not between 2 and v_group.capacity
    or v_close_date is null or v_close_date < current_date
    or p_details->>'visibilityMode' not in ('public', 'link', 'private') then
    raise exception 'invalid_group_details' using errcode = '22023';
  end if;
  if p_name = v_group.name and p_details = v_group.details
    and p_visibility = v_group.visibility
    and p_delivery = v_group.delivery_per_member_satang then
    return p_group;
  end if;

  update public.groups
  set name = btrim(p_name), details = p_details, visibility = p_visibility,
      delivery_per_member_satang = p_delivery,
      revision = revision + 1, status = 'awaiting_approval', updated_at = now()
  where id = p_group returning * into v_group;
  if p_visibility = 'link' then
    insert into private.group_invites(group_id)
    values (p_group)
    on conflict (group_id) do nothing;
  end if;
  delete from public.group_approvals where group_id = p_group;
  perform private.refresh_group_totals(p_group);
  perform private.record_group_event(
    p_group, v_group.revision, 'group_details_changed', v_user, p_request,
    jsonb_build_object('visibility', p_visibility)
  );
  return p_group;
end;
$$;

revoke all on function private.update_group_details(uuid, uuid, text, jsonb, text, bigint)
  from public, anon, authenticated;
grant execute on function private.update_group_details(uuid, uuid, text, jsonb, text, bigint)
  to authenticated;

create or replace function public.update_group_details(
  p_group uuid,
  p_request uuid,
  p_name text,
  p_details jsonb,
  p_visibility text,
  p_delivery bigint
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.update_group_details(p_group, p_request, p_name, p_details, p_visibility, p_delivery)
$$;

revoke all on function public.update_group_details(uuid, uuid, text, jsonb, text, bigint)
  from public, anon, authenticated;
grant execute on function public.update_group_details(uuid, uuid, text, jsonb, text, bigint)
  to authenticated;

notify pgrst, 'reload schema';
