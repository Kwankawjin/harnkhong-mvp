create table if not exists public.secondhand_conversations (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.secondhand_listings(id) on delete cascade,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (listing_id, buyer_id),
  check (buyer_id <> seller_id)
);

create index if not exists secondhand_conversations_buyer_idx
  on public.secondhand_conversations (buyer_id, created_at desc);
create index if not exists secondhand_conversations_seller_idx
  on public.secondhand_conversations (seller_id, created_at desc);

create table if not exists public.secondhand_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.secondhand_conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);

create index if not exists secondhand_messages_conversation_created_idx
  on public.secondhand_messages (conversation_id, created_at);

alter table public.secondhand_conversations enable row level security;
alter table public.secondhand_messages enable row level security;
revoke all on public.secondhand_conversations, public.secondhand_messages from anon, authenticated;
grant select, insert on public.secondhand_conversations to authenticated;
grant select, insert on public.secondhand_messages to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'secondhand_conversations' and policyname = 'Participants read secondhand conversations') then
    create policy "Participants read secondhand conversations" on public.secondhand_conversations
      for select to authenticated using ((select auth.uid()) in (buyer_id, seller_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'secondhand_conversations' and policyname = 'Buyers start conversations for active listings') then
    create policy "Buyers start conversations for active listings" on public.secondhand_conversations
      for insert to authenticated with check (
        (select auth.uid()) = buyer_id and buyer_id <> seller_id and exists (
          select 1 from public.secondhand_listings l
          where l.id = listing_id and l.owner_id = seller_id and l.active
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'secondhand_messages' and policyname = 'Participants read secondhand messages') then
    create policy "Participants read secondhand messages" on public.secondhand_messages
      for select to authenticated using (exists (
        select 1 from public.secondhand_conversations c
        where c.id = conversation_id and (select auth.uid()) in (c.buyer_id, c.seller_id)
      ));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'secondhand_messages' and policyname = 'Participants send secondhand messages') then
    create policy "Participants send secondhand messages" on public.secondhand_messages
      for insert to authenticated with check ((select auth.uid()) = sender_id and exists (
        select 1 from public.secondhand_conversations c
        where c.id = conversation_id and (select auth.uid()) in (c.buyer_id, c.seller_id)
      ));
  end if;
end $$;
