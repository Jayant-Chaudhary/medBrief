begin;
create function community_private.message_screened(proof text,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=community_private.actor(proof); t uuid:=(args->>'id')::uuid; z record; msg uuid; key_id uuid:=(args->>'requestKey')::uuid; saved record; result jsonb; begin
 if not community_private.ready() or key_id is null then raise exception 'Unavailable' using errcode='55000'; end if;
 perform pg_advisory_xact_lock(hashtextextended(a::text||key_id::text,0));
 select * into saved from community_private.idempotency where member_id=a and key=key_id;
 if found then if saved.operation<>'send_message' then raise exception 'Key reused' using errcode='22023'; end if; return saved.response; end if;
 if not community_private.can_thread(a,t) then raise exception 'Forbidden' using errcode='42501'; end if;
 if coalesce(length(args->>'body'),0) not between 1 and 10000 then raise exception 'Text required' using errcode='22023'; end if;
 select c.* into z from community_private.cases c join community_private.care_threads x on x.case_id=c.id where x.id=t for update of c;
 if z.status='closed' then raise exception 'Closed' using errcode='42501'; end if;
 insert into community_private.messages(thread_id,sender_id,sender_type,body,screening) values(t,a,case when a=z.subject_id then 'mother' else 'professional' end,args->>'body',args->'screening') returning id into msg;
 if a=z.subject_id then
  insert into community_private.responses(case_id,kind) values(z.id,'replied'); update community_private.cases set responded_at=now(),status='responded' where id=z.id;
  if z.assigned_id is not null then insert into community_private.notification_outbox(recipient_id,message_id) values(z.assigned_id,msg);
  else insert into community_private.notification_outbox(recipient_id,message_id) select v::uuid,msg from community_private.settings s,jsonb_array_elements_text(s.value) v where s.key='on_call' on conflict do nothing; end if;
  insert into community_private.jobs(kind,reference_id,dedup_key,due_at) select 'push',id,'push:'||id,now() from community_private.notification_outbox where message_id=msg on conflict do nothing;
 else
  insert into community_private.notification_outbox(recipient_id,message_id) values(z.subject_id,msg);
  insert into community_private.jobs(kind,reference_id,dedup_key,due_at) select 'push',id,'push:'||id,now() from community_private.notification_outbox where message_id=msg on conflict do nothing;
 end if;
 if args->>'tier' in ('soon','urgent') or args->>'state'='error' then
  update community_private.cases set tier=case when tier='urgent' then tier when args->>'tier'='urgent' then 'urgent' else 'soon' end where id=z.id;
  insert into community_private.case_events(case_id,actor_id,event) values(z.id,a,'message_flagged');
 end if;
 result:=jsonb_build_object('id',msg); insert into community_private.idempotency values(a,key_id,'send_message',result); return result;
end $$;
revoke all on function community_private.message_screened(text,jsonb) from public,anon,authenticated,service_role,medbrief_community_runtime;
grant execute on function community_private.message_screened(text,jsonb) to medbrief_community_worker;

-- Only the interactive API can request a human decision; the worker cannot execute it.
create function community_private.professional_action(proof text,op text,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=community_private.actor(proof); z record; p uuid; c uuid; k uuid; key_id uuid:=(args->>'requestKey')::uuid; saved record; result jsonb:='{"received":true}'; begin
 if not community_private.ready() or not community_private.is_professional(a) then raise exception 'Forbidden' using errcode='42501'; end if;
 if key_id is null or coalesce(length(trim(args->>'reason')),0) not between 1 and 2000 then raise exception 'Reason required' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended(a::text||key_id::text,0));
 select * into saved from community_private.idempotency where member_id=a and key=key_id;
 if found then if saved.operation<>op then raise exception 'Key reused' using errcode='22023'; end if; return saved.response; end if;
 if op='outreach' then
  if args->>'targetType'='post' then select id into p from community.posts where id=(args->>'id')::uuid and state='published';
  else select id into c from community.comments where id=(args->>'id')::uuid and state='published'; end if;
  if p is null and c is null then raise exception 'Not found' using errcode='P0002'; end if;
  k:=community_private.open_case(p,c,'soon',args->>'reason',a);
 else
  select * into z from community_private.cases where id=(args->>'id')::uuid and assigned_id=a and status<>'closed' for update;
  if not found then raise exception 'Forbidden' using errcode='42501'; end if;
  if op='assess_case' then
   update community_private.cases set reveal_eligible=coalesce((args->>'eligible')::boolean,false) where id=z.id;
   if (args->>'eligible')::boolean and z.responded_at is null and z.response_due<=now() then insert into community_private.reveal_requests(case_id) values(z.id) on conflict do nothing; end if;
  elsif op='close_case' then
   update community_private.cases set status='closed',closure_reason=args->>'reason',closed_at=now() where id=z.id;
   update community_private.care_threads set closed_at=now() where case_id=z.id;
   update community_private.reveal_requests set status='expired' where case_id=z.id and status='pending';
  elsif op='review_revision' then
   if not exists(select 1 from community_private.revisions where id=(args->>'revisionId')::uuid and (post_id=z.post_id or comment_id=z.comment_id) and state='held') then raise exception 'Unavailable' using errcode='42501'; end if;
   if (args->>'publish')::boolean then
    update community_private.revisions set state='normal',tier='normal',publish_after=now()+make_interval(secs=>((select value->>'max' from community_private.settings where key='publication_delay_seconds')::double precision)) where id=(args->>'revisionId')::uuid;
    insert into community_private.jobs(kind,reference_id,dedup_key,due_at) select 'publish',id,'review:'||id,publish_after from community_private.revisions where id=(args->>'revisionId')::uuid on conflict do nothing;
   else update community_private.revisions set state='superseded' where id=(args->>'revisionId')::uuid; end if;
  else raise exception 'Unknown operation' using errcode='22023'; end if;
  insert into community_private.case_events(case_id,actor_id,event) values(z.id,a,op||':'||(args->>'reason'));
 end if;
 insert into community_private.idempotency values(a,key_id,op,result); return result;
end $$;
revoke all on function community_private.professional_action(text,text,jsonb) from public,anon,authenticated,service_role,medbrief_community_worker;
grant execute on function community_private.professional_action(text,text,jsonb) to medbrief_community_runtime;
commit;
