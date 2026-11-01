create table if not exists public.secondhand_orders (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references public.secondhand_listings(id) on delete restrict,
  buyer_id uuid not null references auth.users(id) on delete cascade,
  seller_id uuid not null references auth.users(id) on delete cascade,
  listing_title text not null,
  unit_price_satang bigint not null check (unit_price_satang between 0 and 9007199254740991),
  quantity integer not null check (quantity between 1 and 9999),
  total_satang bigint not null check (total_satang between 0 and 9007199254740991),
  delivery_method text not null check (delivery_method in ('นัดรับ', 'จัดส่ง')),
  status text not null default 'pending_payment' check (status in ('pending_payment', 'payment_secured', 'preparing_order', 'shipped', 'delivered', 'completed', 'cancelled', 'disputed', 'refunded')),
  created_at timestamptz not null default now(),
  check (buyer_id <> seller_id)
);

create index if not exists secondhand_orders_buyer_created_idx
  on public.secondhand_orders (buyer_id, created_at desc);
create index if not exists secondhand_orders_seller_created_idx
  on public.secondhand_orders (seller_id, created_at desc);

alter table public.secondhand_orders enable row level security;
revoke all on public.secondhand_orders from anon, authenticated;
grant select, insert on public.secondhand_orders to authenticated;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'secondhand_orders' and policyname = 'Order participants read their secondhand orders') then
    create policy "Order participants read their secondhand orders" on public.secondhand_orders
      for select to authenticated using ((select auth.uid()) in (buyer_id, seller_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'secondhand_orders' and policyname = 'Buyers create orders for active secondhand listings') then
    create policy "Buyers create orders for active secondhand listings" on public.secondhand_orders
      for insert to authenticated with check (
        (select auth.uid()) = buyer_id and buyer_id <> seller_id and status = 'pending_payment' and exists (
          select 1 from public.secondhand_listings l
          where l.id = listing_id and l.owner_id = seller_id and l.active
            and l.title = listing_title and l.price_satang = unit_price_satang
            and l.quantity >= quantity
            and (
              (l.delivery = 'นัดรับ' and delivery_method = 'นัดรับ')
              or (l.delivery = 'จัดส่ง' and delivery_method = 'จัดส่ง')
              or (l.delivery = 'นัดรับและจัดส่ง' and delivery_method in ('นัดรับ', 'จัดส่ง'))
            )
        )
        and total_satang = unit_price_satang * quantity
      );
  end if;
end $$;
