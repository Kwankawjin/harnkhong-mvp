create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 70),
  bio text not null default '' check (char_length(bio) <= 160),
  avatar_url text,
  role text not null default 'member' check (role = 'member'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select, insert on public.profiles to authenticated;
grant update (display_name, bio) on public.profiles to authenticated;

create policy "Users read their own profile"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "Users create their own member profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id and role = 'member');

create policy "Users edit their own public profile fields"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id and role = 'member');

create table public.addresses (
  user_id uuid primary key references auth.users (id) on delete cascade,
  house_no text not null check (char_length(house_no) between 1 and 100),
  village_no text check (village_no is null or char_length(village_no) <= 100),
  province text not null check (char_length(province) between 1 and 100),
  district text not null check (char_length(district) between 1 and 100),
  subdistrict text not null check (char_length(subdistrict) between 1 and 100),
  alley text check (alley is null or char_length(alley) <= 100),
  road text check (road is null or char_length(road) <= 100),
  postal_code text not null check (postal_code ~ '^[0-9]{5}$'),
  phone text not null check (phone ~ '^[0-9 -]{9,12}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.addresses enable row level security;
revoke all on public.addresses from anon, authenticated;
grant select, insert, update on public.addresses to authenticated;

create policy "Users manage their own address"
  on public.addresses for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
