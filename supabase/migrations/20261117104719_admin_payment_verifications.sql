create table if not exists public.admin_payment_verifications (
  id bigint generated always as identity primary key,
  order_id uuid not null unique references public.secondhand_orders(id) on delete restrict,
  amount_satang bigint not null check (amount_satang >= 0),
  verified_by uuid not null references auth.users(id) on delete restrict,
  verified_at timestamptz not null default now()
);

alter table public.admin_payment_verifications enable row level security;
revoke all on public.admin_payment_verifications from public, anon, authenticated;
grant select, insert on public.admin_payment_verifications to service_role;
grant usage, select on sequence public.admin_payment_verifications_id_seq to service_role;

create or replace function public.confirm_admin_secondhand_payment(
  p_order_id uuid,
  p_amount_satang bigint,
  p_verified_by uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  locked_order public.secondhand_orders%rowtype;
  verification_id bigint;
begin
  if p_verified_by is null or p_amount_satang is null or p_amount_satang < 0 then
    raise exception 'Invalid payment verification';
  end if;

  select * into locked_order
  from public.secondhand_orders
  where id = p_order_id
  for update;

  if not found then raise exception 'Order not found'; end if;
  if locked_order.total_satang <> p_amount_satang then
    raise exception 'Amount does not match the locked order total';
  end if;
  if locked_order.status <> 'pending_payment' then
    raise exception 'Order is not awaiting payment';
  end if;

  insert into public.admin_payment_verifications(order_id, amount_satang, verified_by)
  values (p_order_id, p_amount_satang, p_verified_by)
  returning id into verification_id;

  update public.secondhand_orders
  set status = 'payment_secured'
  where id = p_order_id;

  return jsonb_build_object(
    'verification_id', verification_id,
    'order_id', p_order_id,
    'amount_satang', p_amount_satang,
    'verified_at', now()
  );
end;
$$;

revoke all on function public.confirm_admin_secondhand_payment(uuid, bigint, uuid) from public, anon, authenticated;
grant execute on function public.confirm_admin_secondhand_payment(uuid, bigint, uuid) to service_role;
