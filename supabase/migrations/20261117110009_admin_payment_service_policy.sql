create policy "Service role manages admin payment verification records"
  on public.admin_payment_verifications
  for all
  to service_role
  using (true)
  with check (true);
