create index if not exists groups_listing_id_idx on public.groups(listing_id);
create index if not exists products_seller_id_idx on public.products(seller_id);
create index if not exists group_approvals_group_revision_idx on public.group_approvals(group_id,revision);
