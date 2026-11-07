alter table public.secondhand_listings
  add column if not exists boosted_until timestamptz;

create index if not exists secondhand_listings_boosted_until_idx
  on public.secondhand_listings (boosted_until desc)
  where active and boosted_until is not null;
