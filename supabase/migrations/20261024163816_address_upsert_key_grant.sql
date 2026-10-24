-- PostgREST merge-duplicate upserts may include the conflict key in UPDATE.
-- RLS still requires auth.uid() = user_id for the old and new row.
grant update (user_id) on public.addresses to authenticated;
