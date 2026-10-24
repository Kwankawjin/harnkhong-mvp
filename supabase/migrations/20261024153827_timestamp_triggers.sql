create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = pg_catalog.now();
  return new;
end;
$$;
revoke all on function private.set_updated_at() from public, anon, authenticated;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function private.set_updated_at();

create trigger addresses_set_updated_at
  before update on public.addresses
  for each row execute function private.set_updated_at();

revoke insert on public.profiles from authenticated;
grant insert (id, display_name) on public.profiles to authenticated;

revoke insert, update on public.addresses from authenticated;
grant insert (user_id, house_no, village_no, province, district, subdistrict, alley, road, postal_code, phone)
  on public.addresses to authenticated;
grant update (house_no, village_no, province, district, subdistrict, alley, road, postal_code, phone)
  on public.addresses to authenticated;
