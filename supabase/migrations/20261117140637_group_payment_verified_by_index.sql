create index group_payment_reports_verified_by_idx
  on public.group_payment_reports (verified_by)
  where verified_by is not null;
