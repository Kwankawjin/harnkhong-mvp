create or replace function private.sync_group_member_display_name()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  update public.group_members set display_name=new.display_name where user_id=new.id;
  return new;
end;
$$;
revoke all on function private.sync_group_member_display_name() from public,anon,authenticated;
create trigger profiles_sync_group_member_display_name
  after update of display_name on public.profiles
  for each row execute function private.sync_group_member_display_name();
