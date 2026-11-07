alter table public.secondhand_listings
  add column if not exists delivery_fee_satang bigint not null default 0
  check (delivery_fee_satang between 0 and 9007199254740991);

alter table public.secondhand_orders
  add column if not exists shipping_fee_satang bigint not null default 0
  check (shipping_fee_satang between 0 and 9007199254740991);

do $$
declare
  old_total_check record;
begin
  for old_total_check in
    select conname
    from pg_constraint
    where conrelid = 'public.secondhand_orders'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%total_satang%'
      and pg_get_constraintdef(oid) ilike '%unit_price_satang%'
      and pg_get_constraintdef(oid) ilike '%quantity%'
  loop
    execute format(
      'alter table public.secondhand_orders drop constraint %I',
      old_total_check.conname
    );
  end loop;
end
$$;

alter table public.secondhand_orders
  add constraint secondhand_orders_total_matches_shipping
  check (
    total_satang = unit_price_satang * quantity + shipping_fee_satang
  );

drop policy if exists "Buyers create orders for active secondhand listings"
  on public.secondhand_orders;

create policy "Buyers create orders for active secondhand listings"
  on public.secondhand_orders for insert to authenticated
  with check (
    (select auth.uid()) = buyer_id
    and buyer_id <> seller_id
    and status = 'pending_payment'
    and exists (
      select 1
      from public.secondhand_listings l
      where l.id = listing_id
        and l.owner_id = seller_id
        and l.active
        and l.title = listing_title
        and l.price_satang = unit_price_satang
        and l.quantity >= quantity
        and (
          delivery_method <> 'จัดส่ง'
          or l.delivery_fee_satang = shipping_fee_satang
        )
        and (delivery_method = 'จัดส่ง' or shipping_fee_satang = 0)
        and (
          (l.delivery = 'นัดรับ' and delivery_method = 'นัดรับ')
          or (l.delivery = 'จัดส่ง' and delivery_method = 'จัดส่ง')
          or (
            l.delivery = 'นัดรับและจัดส่ง'
            and delivery_method in ('นัดรับ', 'จัดส่ง')
          )
        )
    )
    and total_satang = unit_price_satang * quantity + shipping_fee_satang
  );
