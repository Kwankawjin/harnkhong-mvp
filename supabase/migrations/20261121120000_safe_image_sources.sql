-- Image values are written by members and rendered into other members' pages, so a value
-- like `data:image/png;base64,x" onerror="...` must never be stored. The old group check only
-- anchored the prefix; these checks match the whole value.

-- Group images: complete base64 image data URLs only.
create or replace function private.safe_group_images(p_images jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(p_images) = 'array'
    and jsonb_array_length(p_images) <= 4
    and not exists (
      select 1 from jsonb_array_elements(p_images) as item(value)
      where jsonb_typeof(value) <> 'string'
        or char_length(value #>> '{}') > 350000
        or value #>> '{}' !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'
    )
$$;

-- Secondhand listing images: public URLs of the listing-photo bucket only.
create or replace function private.safe_listing_images(p_images text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select not exists (
    select 1 from unnest(p_images) as image(value)
    where value is null
      or char_length(value) > 1000
      or value !~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?/storage/v1/object/public/secondhand-listings/[A-Za-z0-9._~/-]+$'
  )
$$;

revoke all on function private.safe_group_images(jsonb) from public;
revoke all on function private.safe_listing_images(text[]) from public;
grant execute on function private.safe_group_images(jsonb) to anon, authenticated, service_role;
grant execute on function private.safe_listing_images(text[]) to anon, authenticated, service_role;

-- Hide listings that already hold an unsafe image; their owners can re-upload photos.
update public.secondhand_listings
set active = false
where active and not private.safe_listing_images(images);

-- NOT VALID: existing rows are not rechecked (the app escapes them when rendering),
-- but every new or edited row must pass.
alter table public.groups
  drop constraint if exists groups_images_safe,
  add constraint groups_images_safe check (private.safe_group_images(images)) not valid;

alter table public.secondhand_listings
  drop constraint if exists secondhand_listings_images_safe,
  add constraint secondhand_listings_images_safe check (private.safe_listing_images(images)) not valid;
