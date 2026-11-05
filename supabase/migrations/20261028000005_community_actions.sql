begin;
alter table community_private.cases add column reveal_eligible boolean not null default false;
create function community_private.action_api(proof text,op text,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=community_private.actor(proof); p uuid; c uuid; owner uuid; k uuid; t uuid; item uuid; key_id uuid:=(args->>'requestKey')::uuid; saved record; z record; result jsonb; begin
 if not community_private.ready() then raise exception 'Not configured' using errcode='55000'; end if;
 if key_id is null then raise exception 'Key required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(a::text||key_id::text,0));
 select * into saved from community_private.idempotency where member_id=a and key=key_id;
 if found then if saved.operation<>op then raise exception 'Key reused' using errcode='22023'; end if; return saved.response; end if;
 if op in ('report','help') then
  if args->>'targetType'='post' then p:=(args->>'id')::uuid; select author_id into owner from community.posts where id=p and (state='published' or author_id=a);
  elsif args->>'targetType'='comment' then c:=(args->>'id')::uuid; select author_id into owner from community.comments where id=c and (state='published' or author_id=a); end if;
  if owner is null then raise exception 'Not found' using errcode='P0002'; end if;
  if op='help' then
   if owner<>a then raise exception 'Forbidden' using errcode='42501'; end if; k:=community_private.open_case(p,c,'urgent','author_help',a);
  else
   if not exists(select 1 from community.members where community_id=a and joined_at<=now()-make_interval(secs=>((select value #>> '{}' from community_private.settings where key='minimum_account_age_hours')::double precision)*3600)) then raise exception 'Not eligible' using errcode='42501'; end if;
   insert into community_private.reports(reporter_id,post_id,comment_id,category) values(a,p,c,args->>'category') on conflict do nothing;
   if args->>'category'='worried' then k:=community_private.open_case(p,c,'soon','member_concern',a);
   elsif (select count(distinct reporter_id) from community_private.reports where (post_id=p or comment_id=c) and category='abuse')>=(select (value #>> '{}')::integer from community_private.settings where key='reporter_threshold') then k:=community_private.open_case(p,c,'normal','content_report',a); end if;
  end if; result:='{"received":true}';
 elsif op in ('remove_post','remove_comment') then
  if op='remove_post' then update community.posts set state='removed' where id=(args->>'id')::uuid and author_id=a returning id into item;
  else update community.comments set state='removed' where id=(args->>'id')::uuid and author_id=a returning id into item; end if;
  if item is null then raise exception 'Not found' using errcode='P0002'; end if; result:='{"removed":true}';
 elsif op='claim_case' then
  if not community_private.is_professional(a) or not exists(select 1 from community_private.settings where key='on_call' and value @> to_jsonb(array[a::text])) then raise exception 'Forbidden' using errcode='42501'; end if;
  k:=(args->>'id')::uuid;
  select * into z from community_private.cases where id=k and status<>'closed' for update;
  if not found or (z.assigned_id is not null and z.assigned_id<>a) then raise exception 'Unavailable' using errcode='42501'; end if;
  update community_private.cases set assigned_id=a where id=k;
  select id into t from community_private.care_threads where case_id=k;
  insert into community_private.care_participants values(t,a,null) on conflict(thread_id,professional_id) do update set revoked_at=null;
  insert into community_private.case_events(case_id,actor_id,event) values(k,a,'assigned'); result:=jsonb_build_object('threadId',t);
 elsif op='respond' then
  t:=(args->>'id')::uuid;
  select z0.* into z from community_private.cases z0 join community_private.care_threads x on x.case_id=z0.id where x.id=t and x.subject_id=a for update of z0;
  if not found or z.status='closed' then raise exception 'Unavailable' using errcode='42501'; end if;
  if coalesce(args->>'kind','') not in ('opened','okay','help') then raise exception 'Invalid response' using errcode='22023'; end if;
  insert into community_private.responses(case_id,kind) values(z.id,args->>'kind');
  if args->>'kind'='opened' then insert into community_private.receipts(message_id,recipient_id) select id,a from community_private.messages where thread_id=t and sender_type<>'mother' on conflict do nothing; end if;
  update community_private.cases set status='responded',responded_at=now(),tier=case when args->>'kind'='help' then 'urgent' else tier end where id=z.id;
  insert into community_private.case_events(case_id,actor_id,event) values(z.id,a,'response_'||(args->>'kind')); result:='{"received":true}';
 elsif op in ('register_device','unregister_device') then
  if coalesce(length(args->>'token'),0) not between 1 and 4096 then raise exception 'Invalid token' using errcode='22023'; end if;
  if op='register_device' then insert into community_private.devices values(a,args->>'token') on conflict(token) do update set member_id=excluded.member_id;
  else delete from community_private.devices where member_id=a and token=args->>'token'; end if; result:='{"received":true}';
 else raise exception 'Unknown operation' using errcode='22023'; end if;
 insert into community_private.idempotency values(a,key_id,op,result); return result;
end $$;
revoke all on function community_private.action_api(text,text,jsonb) from public,anon,authenticated,service_role,medbrief_community_worker;
grant execute on function community_private.action_api(text,text,jsonb) to medbrief_community_runtime;
commit;
