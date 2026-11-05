begin;
-- No direct SELECT on profiles is granted. Only this isolated function can return
-- minimal contact fields after human approval and a valid expiring access grant.
create function identity_private.reveal_api(proof text,op text,args jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=community_private.actor(proof); req record; z record; g record; old_name text; alias text; ttl integer; single_allowed boolean; contact jsonb; begin
 if not community_private.ready() or not community_private.is_professional(a) then raise exception 'Forbidden' using errcode='42501'; end if;
 if op='queue' then
  if not exists(select 1 from community_private.settings where key='on_call' and value @> to_jsonb(array[a::text])) then raise exception 'Forbidden' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'tier',c.tier,'responded',c.responded_at is not null)) from community_private.reveal_requests r join community_private.cases c on c.id=r.case_id where r.status='pending' and c.status<>'closed'),'[]');
 end if;
 select * into req from community_private.reveal_requests where id=(args->>'id')::uuid for update;
 if not found then raise exception 'Not found' using errcode='P0002'; end if;
 select * into z from community_private.cases where id=req.case_id for update;
 if z.status='closed' or not z.reveal_eligible then raise exception 'Unavailable' using errcode='42501'; end if;
 if op='context' then
  if a<>z.assigned_id and not exists(select 1 from community_private.settings where key='on_call' and value @> to_jsonb(array[a::text])) then raise exception 'Forbidden' using errcode='42501'; end if;
  insert into identity_private.reveal_reviewers(request_id,reviewer_id) values(req.id,a) on conflict do nothing;
  return jsonb_build_object('id',req.id,'tier',z.tier,'status',req.status,'respondedAt',z.responded_at,'assessment',coalesce((select jsonb_agg(event) from community_private.case_events where case_id=z.id and event like 'assess_case:%'),'[]'),'content',(select body from community_private.revisions where post_id=z.post_id or comment_id=z.comment_id order by created_at desc,id desc limit 1));
 end if;
 if op='decide' then
  if a<>z.assigned_id and not exists(select 1 from identity_private.reveal_reviewers where request_id=req.id and reviewer_id=a) then raise exception 'Forbidden' using errcode='42501'; end if;
  if req.status<>'pending' then return jsonb_build_object('status',req.status); end if;
  if args->>'decision' not in ('approve','deny') or coalesce(length(trim(args->>'reason')),0) not between 1 and 2000 then raise exception 'Decision and reason required' using errcode='22023'; end if;
  if z.responded_at is not null and not coalesce((args->>'reassessed')::boolean,false) then raise exception 'Response requires reassessment' using errcode='22023'; end if;
  insert into community_private.reveal_decisions(request_id,approver_id,decision,reason,response_seen_at) values(req.id,a,args->>'decision',args->>'reason',z.responded_at) on conflict do nothing;
  if args->>'decision'='deny' then update community_private.reveal_requests set status='denied' where id=req.id; return '{"status":"denied"}'; end if;
  single_allowed:=coalesce((select (value #>> '{}')::boolean from community_private.settings where key='single_approver_allowed'),false);
  if not exists(select 1 from community_private.reveal_decisions where request_id=req.id and approver_id=z.assigned_id and decision='approve' and response_seen_at is not distinct from z.responded_at) then return '{"status":"awaiting_assigned_professional"}'; end if;
  if not single_allowed and (select count(distinct approver_id) from community_private.reveal_decisions where request_id=req.id and decision='approve' and response_seen_at is not distinct from z.responded_at and community_private.is_professional(approver_id))<2 then return '{"status":"awaiting_second_approver"}'; end if;
  if single_allowed and coalesce(length(trim(args->>'singleApproverReason')),0)=0 then raise exception 'Single approver reason required' using errcode='22023'; end if;
  ttl:=(select (value #>> '{}')::integer from community_private.settings where key='reveal_minutes');
  if ttl is null or ttl<=0 then raise exception 'Invalid configuration' using errcode='55000'; end if;
  select username into old_name from community.members where community_id=z.subject_id for update;
  loop
   alias:='mother_'||left(replace(gen_random_uuid()::text,'-',''),24);
   exit when not exists(select 1 from community.members where username=alias) and not exists(select 1 from community_private.username_history where previous_username=alias);
  end loop;
  insert into community_private.username_history(previous_username,community_id,reason_code) values(old_name,z.subject_id,'approved_reveal');
  update community.members set username=alias,username_changed_at=now() where community_id=z.subject_id;
  insert into identity_private.reveal_grants(request_id,professional_id,expires_at) values(req.id,z.assigned_id,now()+make_interval(mins=>ttl)) returning * into g;
  insert into identity_private.reveal_audit(grant_id,actor_id,action) values(g.id,a,'approved');
  insert into community_private.case_events(case_id,actor_id,event) values(z.id,a,case when single_allowed then 'single_approver:'||(args->>'singleApproverReason') else 'dual_approval' end);
  update community_private.reveal_requests set status='approved' where id=req.id;
  return '{"status":"approved"}';
 elsif op='contact' then
  select * into g from identity_private.reveal_grants where request_id=req.id and professional_id=a and expires_at>now() and revoked_at is null;
  if not found or req.status<>'approved' or z.assigned_id<>a then raise exception 'Forbidden' using errcode='42501'; end if;
  select jsonb_build_object('name',p.full_name,'phone',p.phone,'expiresAt',g.expires_at) into contact from identity_private.community_links l join public.profiles p on p.id=l.auth_user_id where l.community_id=z.subject_id;
  insert into identity_private.reveal_audit(grant_id,actor_id,action) values(g.id,a,'contact_viewed');
  return contact;
 end if;
 raise exception 'Unknown operation' using errcode='22023';
end $$;
revoke all on function identity_private.reveal_api(text,text,jsonb) from public,anon,authenticated,service_role,medbrief_community_runtime,medbrief_community_worker;
grant execute on function identity_private.reveal_api(text,text,jsonb) to medbrief_reveal_service;
commit;
