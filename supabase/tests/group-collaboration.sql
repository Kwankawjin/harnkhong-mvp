-- Run as postgres in the SQL editor. Fixtures and all changes are rolled back.
begin;
do $$
declare
  a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
  g uuid; hidden uuid; token uuid; request uuid:=gen_random_uuid(); events_before bigint;
begin
  insert into auth.users(id,aud,role,email,raw_user_meta_data)
    select id,'authenticated','authenticated',id::text||'@example.invalid','{}'::jsonb from unnest(array[a,b,c]) id;
  insert into public.profiles(id,display_name) values(a,'Test A'),(b,'Test B'),(c,'Test C');
  insert into public.addresses(user_id,house_no,province,district,subdistrict,postal_code,phone)
    values(a,'test','test','test','test','10330','0890000000'),(b,'test','test','test','test','10330','0890000000');

  perform set_config('request.jwt.claim.sub',a::text,true);
  set local role authenticated;
  assert (select count(*)=1 from public.profiles where id in(a,b,c)), 'profile isolation';
  assert (select count(*)=1 from public.addresses where user_id in(a,b)), 'address isolation';
  update public.profiles set display_name='forbidden' where id=b;
  assert not found, 'cross-account profile edit';
  begin
    insert into public.addresses(user_id,house_no,province,district,subdistrict,postal_code,phone)
      values(c,'test','test','test','test','10330','0890000000');
    raise exception 'cross-account address insert allowed';
  exception when insufficient_privilege then null; end;

  g:=public.create_group('p1',request,'Temporary public group','public',2,100);
  assert public.create_group('p1',request,'Temporary public group','public',2,100)=g, 'create retry not idempotent';
  hidden:=public.create_group('p1',gen_random_uuid(),'Temporary link group','link',3,0);
  token:=public.get_group_invite(hidden);
  perform public.approve_group(g,1,gen_random_uuid());
  assert (select status='awaiting_approval' from public.groups where id=g), 'incomplete group marked ready';

  perform set_config('request.jwt.claim.sub',b::text,true);
  assert (select count(*)=0 from public.groups where id=hidden), 'private group leaked';
  assert (select count(*)=0 from public.group_members where group_id=hidden), 'private members leaked';
  assert (select count(*)=0 from public.group_events where group_id=hidden), 'private events leaked';
  begin
    perform public.resolve_group_invite(hidden,gen_random_uuid());
    raise exception 'invalid invite resolved';
  exception when insufficient_privilege then null; end;
  begin
    perform public.join_group(hidden,gen_random_uuid(),null);
    raise exception 'private group joined without token';
  exception when insufficient_privilege then null; end;
  begin
    perform public.get_group_invite(hidden);
    raise exception 'non-owner read invite token';
  exception when insufficient_privilege then null; end;
  begin
    perform public.change_group_delivery(g,200,gen_random_uuid());
    raise exception 'non-owner edited costs';
  exception when insufficient_privilege then null; end;
  begin
    perform public.transfer_group_owner(g,b,gen_random_uuid());
    raise exception 'non-owner transferred group';
  exception when insufficient_privilege then null; end;
  begin
    update public.groups set owner_id=b where id=g;
    raise exception 'direct group mutation allowed';
  exception when insufficient_privilege then null; end;

  perform public.join_group(g,gen_random_uuid(),null);
  assert (select count(*)=2 from public.group_members where group_id=g), 'join missing';
  assert (select revision=2 and total_satang=65994 from public.groups where id=g), 'join totals/revision';
  assert (select count(*)=0 from public.group_approvals where group_id=g), 'join kept old approvals';
  begin
    perform public.approve_group(g,1,gen_random_uuid());
    raise exception 'stale total approved';
  exception when serialization_failure then null; end;
  begin
    insert into public.group_approvals(group_id,user_id,revision) values(g,a,2);
    raise exception 'forged approval allowed';
  exception when insufficient_privilege then null; end;
  perform public.approve_group(g,2,gen_random_uuid());

  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.approve_group(g,2,gen_random_uuid());
  assert (select status='ready' from public.groups where id=g), 'full confirmed group not ready';
  select count(*) into events_before from public.group_events where group_id=g;
  perform set_config('request.jwt.claim.sub',c::text,true);
  begin
    perform public.join_group(g,gen_random_uuid(),null);
    raise exception 'over-capacity join allowed';
  exception when check_violation then null; end;
  assert (select count(*)=events_before from public.group_events where group_id=g), 'failed join created event';
  assert (public.resolve_group_invite(hidden,token)->>'id')=hidden::text, 'valid invite failed';
  assert (select count(*)=0 from public.groups where id=hidden), 'invite preview changed membership';
  perform public.join_group(hidden,gen_random_uuid(),token);
  assert (select count(*)=1 from public.groups where id=hidden), 'joined private group inaccessible';

  perform set_config('request.jwt.claim.sub',b::text,true);
  perform public.leave_group(g,gen_random_uuid());
  assert (select revision=3 and total_satang=65892 and status='awaiting_approval' from public.groups where id=g), 'leave totals/revision';
  assert (select count(*)=0 from public.group_approvals where group_id=g), 'leave kept approvals';
  perform public.join_group(g,gen_random_uuid(),null);
  perform set_config('request.jwt.claim.sub',a::text,true);
  perform public.change_group_delivery(g,200,gen_random_uuid());
  assert (select revision=5 and total_satang=66198 from public.groups where id=g), 'new shipping total';
  begin
    perform public.leave_group(g,gen_random_uuid());
    raise exception 'owner left without transfer';
  exception when check_violation then null; end;
  perform public.transfer_group_owner(g,b,gen_random_uuid());
  assert (select owner_id=b from public.groups where id=g), 'owner transfer failed';
  update public.profiles set display_name='Test A updated' where id=a;
  assert (select display_name='Test A updated' from public.group_members where group_id=g and user_id=a), 'member name sync';
  perform public.leave_group(g,gen_random_uuid());

  reset role;
end $$;
rollback;
select 'Group collaboration, permissions and totals checks passed; fixtures rolled back.' as result;
