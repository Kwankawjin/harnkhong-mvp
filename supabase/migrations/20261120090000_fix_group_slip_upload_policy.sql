-- Fix: members could never upload a group payment slip.
-- The insert policy from 20261118170000 called storage.foldername(name) inside a subquery that
-- joins public.groups, so "name" resolved to groups.name (the group's title) instead of the
-- uploaded object's path, and the check always failed with a row-level security error.
-- The policy now names objects.name explicitly.
drop policy if exists "Members upload payment slips for current group revision" on storage.objects;
create policy "Members upload payment slips for current group revision"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'group-payment-slips'
    and (storage.foldername(objects.name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.group_members m
      join public.groups g on g.id = m.group_id
      join public.group_approvals a on a.group_id = m.group_id and a.user_id = m.user_id
      where m.user_id = (select auth.uid())
        and g.id::text = (storage.foldername(objects.name))[2]
        and g.revision::text = (storage.foldername(objects.name))[3]
        and a.revision = g.revision
        and g.status <> 'cancelled'
    )
  );
