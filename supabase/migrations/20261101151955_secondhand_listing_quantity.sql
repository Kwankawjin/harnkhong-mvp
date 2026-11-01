alter table public.secondhand_listings
  add column if not exists quantity integer not null default 1
  check (quantity between 1 and 9999);
