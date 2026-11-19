-- The admin page lists and deletes groups through these admin-only functions, so it always
-- works on the same database the website reads (no dependency on the admin-api Edge Function).

create or replace function public.admin_list_groups(p_limit integer default 500)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc)
    from (
      select g.id, g.name, g.owner_id, g.listing_id, g.category, g.categories, g.capacity,
             g.product_satang, g.delivery_per_member_satang, g.service_satang, g.total_satang,
             g.revision, g.status, g.admin_approved_revision, g.admin_approved_at, g.created_at,
             g.billing_mode, g.visibility,
             coalesce(p.title, '') as product_title,
             case when cardinality(g.categories) > 0 then g.categories
                  when g.category is not null then array[g.category]
                  else array['ไม่ระบุหมวดหมู่'] end as category_labels,
             coalesce(u.email, '') as owner_email,
             (select count(*) from public.group_members m where m.group_id = g.id)::integer as member_count,
             (select count(*) from public.group_approvals a where a.group_id = g.id and a.revision = g.revision)::integer as approval_count,
             (select max(a.approved_at) from public.group_approvals a where a.group_id = g.id and a.revision = g.revision) as last_approval_at
      from public.groups g
      left join public.products p on p.id = g.listing_id
      left join auth.users u on u.id = g.owner_id
      order by g.created_at desc
      limit greatest(1, least(coalesce(p_limit, 500), 2000))
    ) x), '[]'::jsonb);
end;
$$;

-- Deletes the group and everything that hangs off it (members, approvals, chat, payment
-- reports, monthly cycles cascade from groups).
create or replace function public.admin_delete_group(p_group uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_admin() then raise exception 'admin_only' using errcode = '42501'; end if;
  delete from public.groups where id = p_group returning id into v_id;
  if v_id is null then raise exception 'group_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('groupId', v_id);
end;
$$;

revoke all on function public.admin_list_groups(integer) from public, anon;
revoke all on function public.admin_delete_group(uuid) from public, anon;
grant execute on function public.admin_list_groups(integer) to authenticated;
grant execute on function public.admin_delete_group(uuid) to authenticated;
