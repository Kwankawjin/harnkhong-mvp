-- Opening a link-only group through its invite link failed with "groupTotalMismatch":
-- resolve_group_invite was last written before pricing/billing modes existed, so it never sent
-- pricing_mode. The app then treated seat-priced (seat_v3) groups as per_member_v2 and its total
-- no longer matched the database total. Return every column the app's group mapping reads.
create or replace function private.resolve_group_invite(p_group uuid,p_token uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_result jsonb;
begin
  if auth.uid() is null or not exists(select 1 from private.group_invites where group_id=p_group and token=p_token) then
    raise exception 'invite_invalid' using errcode='42501';
  end if;
  select jsonb_build_object(
    'id',g.id,'listing_id',g.listing_id,'owner_id',g.owner_id,'name',g.name,'category',g.category,
    'categories',g.categories,'images',g.images,'details',g.details,'visibility',g.visibility,'capacity',g.capacity,
    'product_satang',g.product_satang,'delivery_per_member_satang',g.delivery_per_member_satang,
    'service_satang',g.service_satang,'total_satang',g.total_satang,'revision',g.revision,'status',g.status,
    'admin_approved_revision',g.admin_approved_revision,
    'pricing_mode',g.pricing_mode,'billing_mode',g.billing_mode,'cycle_anchor',g.cycle_anchor,'pay_day',g.pay_day,
    'closed_at',g.closed_at,'last_cycle_number',g.last_cycle_number,
    'created_at',g.created_at,
    'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',m.display_name) order by m.joined_at) from public.group_members m where m.group_id=g.id),'[]'::jsonb),
    'approvals',coalesce((select jsonb_object_agg(a.user_id::text,a.revision) from public.group_approvals a where a.group_id=g.id),'{}'::jsonb),
    'history',coalesce((select jsonb_agg(jsonb_build_object('revision',e.revision,'event_type',e.event_type,'created_at',e.created_at) order by e.id) from public.group_events e where e.group_id=g.id),'[]'::jsonb)
  ) into v_result from public.groups g where g.id=p_group and g.status<>'cancelled';
  if v_result is null then raise exception 'group_unavailable' using errcode='P0002'; end if;
  return v_result;
end;
$$;
