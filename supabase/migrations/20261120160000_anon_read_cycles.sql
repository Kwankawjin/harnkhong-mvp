-- Logged-out visitors load the public group list, which embeds cycles. Without a table grant
-- PostgREST fails the whole request (42501). Grant the read; RLS still gives them no rows,
-- since the cycle policies only admit signed-in group members.
grant select on public.group_cycles to anon;
grant select on public.group_cycle_members to anon;
