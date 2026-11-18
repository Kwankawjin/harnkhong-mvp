-- Admin deletion removes a group's dependent payment reports together with its
-- existing cascading members, chat, approvals, events, and invites.
alter table public.group_payment_reports
  drop constraint group_payment_reports_group_id_fkey;

alter table public.group_payment_reports
  add constraint group_payment_reports_group_id_fkey
  foreign key (group_id) references public.groups(id) on delete cascade;

-- Group deletion is an Admin-only operation. The browser must not be able to
-- invoke the former owner-only RPC; the authorized Edge Function uses the
-- server-side service client instead.
revoke all on function private.delete_group(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.delete_group(uuid, uuid)
  from public, anon, authenticated;

create or replace function public.reject_group_payment_report(
  p_payment_id uuid,
  p_rejected_by uuid,
  p_rejection_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group_id uuid;
  v_group public.groups%rowtype;
  v_report public.group_payment_reports%rowtype;
  v_note text := btrim(coalesce(p_rejection_note, ''));
begin
  if p_rejected_by is null then
    raise exception 'reviewer_required' using errcode = '23502';
  end if;
  if char_length(v_note) < 3 or char_length(v_note) > 500 then
    raise exception 'invalid_rejection_note' using errcode = '23514';
  end if;

  select group_id into v_group_id
  from public.group_payment_reports
  where id = p_payment_id;
  if not found then
    raise exception 'payment_report_unavailable' using errcode = 'P0002';
  end if;

  -- Lock the group first, matching the verification RPC to serialize reviews
  -- against amount changes and concurrent accept/reject actions.
  select * into v_group
  from public.groups
  where id = v_group_id
  for update;
  if not found or v_group.status = 'cancelled' then
    raise exception 'group_unavailable' using errcode = 'P0002';
  end if;

  select * into v_report
  from public.group_payment_reports
  where id = p_payment_id
  for update;
  if not found then
    raise exception 'payment_report_unavailable' using errcode = 'P0002';
  end if;
  if v_report.status <> 'reported' then
    raise exception 'payment_report_not_pending' using errcode = '23514';
  end if;
  if v_report.revision <> v_group.revision then
    raise exception 'stale_revision' using errcode = '40001';
  end if;

  update public.group_payment_reports
  set status = 'rejected',
      rejection_note = v_note,
      verified_at = null,
      verified_by = null
  where id = p_payment_id
  returning * into v_report;

  return jsonb_build_object(
    'id', v_report.id,
    'group_id', v_report.group_id,
    'user_id', v_report.user_id,
    'revision', v_report.revision,
    'amount_satang', v_report.amount_satang,
    'status', v_report.status,
    'reported_at', v_report.reported_at,
    'rejection_note', v_report.rejection_note
  );
end;
$$;

revoke all on function public.reject_group_payment_report(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reject_group_payment_report(uuid, uuid, text)
  to service_role;

notify pgrst, 'reload schema';
