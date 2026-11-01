create table public.secondhand_listings (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  seller_name text not null check (char_length(seller_name) between 1 and 70),
  title text not null check (char_length(title) between 1 and 100),
  category text not null,
  item_condition text not null check (item_condition in ('มือหนึ่ง', 'เหมือนใหม่', 'สภาพดี', 'มีตำหนิ')),
  delivery text not null check (delivery in ('นัดรับ', 'จัดส่ง', 'นัดรับและจัดส่ง')),
  area text not null default '',
  market_address text not null default '',
  market_latitude double precision check (market_latitude between -90 and 90),
  market_longitude double precision check (market_longitude between -180 and 180),
  contact text not null check (char_length(contact) between 1 and 120),
  images text[] not null check (cardinality(images) between 1 and 6),
  price_satang bigint not null check (price_satang between 0 and 9007199254740991),
  description text not null check (char_length(description) between 1 and 1200),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check ((market_latitude is null) = (market_longitude is null))
);

create index secondhand_listings_active_created_idx
  on public.secondhand_listings (created_at desc)
  where active;
create index secondhand_listings_owner_id_idx
  on public.secondhand_listings (owner_id);

alter table public.secondhand_listings enable row level security;
revoke all on public.secondhand_listings from anon, authenticated;
grant select on public.secondhand_listings to anon, authenticated;
grant insert, update, delete on public.secondhand_listings to authenticated;

create policy "Active secondhand listings are public"
  on public.secondhand_listings for select to anon, authenticated
  using (active);
create policy "Users create their own secondhand listings"
  on public.secondhand_listings for insert to authenticated
  with check ((select auth.uid()) = owner_id);
create policy "Users update their own secondhand listings"
  on public.secondhand_listings for update to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);
create policy "Users delete their own secondhand listings"
  on public.secondhand_listings for delete to authenticated
  using ((select auth.uid()) = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('secondhand-listings', 'secondhand-listings', true, 3670016, array['image/jpeg'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy "Public can read secondhand listing images"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'secondhand-listings');
create policy "Users upload their own secondhand listing images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'secondhand-listings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Users delete their own secondhand listing images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'secondhand-listings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
