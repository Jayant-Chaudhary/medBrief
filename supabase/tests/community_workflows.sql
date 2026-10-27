\set ON_ERROR_STOP on
begin;
insert into auth.users values ('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002'),('10000000-0000-0000-0000-000000000003');
insert into public.profiles values('10000000-0000-0000-0000-000000000001','Synthetic Mother','0000000000');
-- Test-only values, never clinical defaults.
insert into community_private.settings values
 ('enabled','true'),('consent_version','"test-v1"'),('outreach_text','"Synthetic support message"'),('tier_hours','{"urgent":1,"soon":2,"normal":3}'),
 ('reporter_threshold','2'),('minimum_account_age_hours','0'),('on_call','[]'),('retention_policy','"test only"'),('reveal_minutes','1'),('emergency_protocol','"test only"'),('publication_delay_seconds','{"min":0,"max":0}'),('timestamp_bucket_seconds','3600'),('single_approver_allowed','true');
-- Administrative bootstrap of the named on-call professional, all synthetic.
insert into community.members(community_id,username) values('40000000-0000-0000-0000-000000000003','synthetic_doctor');
insert into identity_private.community_links(auth_user_id,community_id) values('10000000-0000-0000-0000-000000000003','40000000-0000-0000-0000-000000000003');
insert into community_private.role_grants(community_id,role,verification_status,granted_by,display_name) values('40000000-0000-0000-0000-000000000003','doctor','verified','40000000-0000-0000-0000-000000000003','Synthetic Doctor');
update community_private.settings set value='["40000000-0000-0000-0000-000000000003"]' where key='on_call';
select identity_private.issue_capability('10000000-0000-0000-0000-000000000001','test-v1') as mother \gset
select identity_private.issue_capability('10000000-0000-0000-0000-000000000002','test-v1') as stranger \gset
select identity_private.issue_capability('10000000-0000-0000-0000-000000000003','test-v1') as doctor \gset

update community_private.settings set value=to_jsonb(array[community_private.actor(:'doctor')::text]) where key='on_call';
set local role medbrief_community_worker;
select community_private.submit_screened(:'mother','create_post','{"title":"Synthetic title","body":"Synthetic body","tags":[],"state":"normal","tier":"normal","requestKey":"30000000-0000-0000-0000-000000000001"}') ->> 'id' as post \gset
select community_private.worker_tick();
reset role;
set local role medbrief_community_runtime;
select jsonb_array_length(community_private.read_api(:'stranger','feed','{}'))=1 as feed_ok \gset
\if :feed_ok
\else
 \quit 1
\endif
select community_private.action_api(:'mother','help',jsonb_build_object('id',:'post','targetType','post','requestKey','30000000-0000-0000-0000-000000000002'));
select community_private.read_api(:'doctor','queue','{}')->0->>'id' as case_id \gset
select community_private.action_api(:'doctor','claim_case',jsonb_build_object('id',:'case_id','requestKey','30000000-0000-0000-0000-000000000003'))->>'threadId' as thread \gset
select community_private.read_api(:'mother','messages',jsonb_build_object('id',:'thread'));
reset role;
-- Assert denial of raw tables for every client/capability role, including BYPASSRLS.
do $$ declare role_name text; relation record; begin
 foreach role_name in array array['anon','authenticated','service_role','medbrief_community_runtime','medbrief_community_worker'] loop
  for relation in select schemaname,tablename from pg_tables where schemaname in ('identity_private','community','community_private') loop
   execute format('set local role %I',role_name);
   begin execute format('select * from %I.%I',relation.schemaname,relation.tablename); raise exception 'Unexpected table access'; exception when insufficient_privilege then null; end;
   execute 'reset role';
  end loop;
 end loop;
end $$;
select set_config('test.mother',:'mother',true),set_config('test.stranger',:'stranger',true),set_config('test.thread',:'thread',true),set_config('test.doctor',:'doctor',true),set_config('test.case',:'case_id',true),set_config('test.post',:'post',true) \gset
set local role medbrief_community_runtime;
do $$ begin
 begin perform community_private.read_api(current_setting('test.stranger'),'messages',jsonb_build_object('id',current_setting('test.thread'))); raise exception 'Inbox leak'; exception when insufficient_privilege then null; end;
 begin perform community_private.read_api('forged','feed','{}'); raise exception 'Forged proof accepted'; exception when insufficient_privilege then null; end;
 begin perform community_private.submit_screened(current_setting('test.mother'),'create_post','{}'); raise exception 'Screening bypass'; exception when insufficient_privilege then null; end;
end $$;
reset role;

-- Duplicate retries preserve one post. Unassigned members cannot message or decide.
set local role medbrief_community_worker;
select community_private.submit_screened(:'mother','create_post','{"title":"Synthetic title","body":"Synthetic body","tags":[],"state":"normal","tier":"normal","requestKey":"30000000-0000-0000-0000-000000000001"}') ->> 'id' = :'post' as retry_ok \gset
\if :retry_ok
\else
 \quit 1
\endif
do $$ begin
 begin perform community_private.professional_action(current_setting('test.doctor'),'close_case','{}'); raise exception 'Worker made human decision'; exception when insufficient_privilege then null; end;
 begin perform community_private.message_screened(current_setting('test.stranger'),jsonb_build_object('id',current_setting('test.thread'),'body','Uninvited','requestKey',gen_random_uuid())); raise exception 'Stranger sent private message'; exception when insufficient_privilege then null; end;
end $$;
reset role;
-- A report/help case without professional assessment cannot trigger a reveal request.
update community_private.cases set response_due=now()-interval '1 second' where id=:'case_id';
update community_private.jobs set due_at=now()-interval '1 second' where kind='deadline';
set local role medbrief_community_worker;
select community_private.worker_tick();
reset role;
do $$ begin if exists(select 1 from community_private.reveal_requests) then raise exception 'Unassessed reveal request'; end if; end $$;
set local role medbrief_community_runtime;
select community_private.professional_action(:'doctor','assess_case',jsonb_build_object('id',:'case_id','reason','Synthetic professional assessment','eligible',true,'requestKey',gen_random_uuid()));
select community_private.action_api(:'mother','respond',jsonb_build_object('id',:'thread','kind','okay','requestKey',gen_random_uuid()));
reset role;
select id as reveal_id from community_private.reveal_requests where case_id=:'case_id' \gset
select set_config('test.reveal',:'reveal_id',true) \gset
set local role medbrief_reveal_service;
do $$ begin
 begin perform identity_private.reveal_api(current_setting('test.doctor'),'decide',jsonb_build_object('id',current_setting('test.reveal'),'decision','approve','reason','Synthetic reason','reassessed',false)); raise exception 'Late response ignored'; exception when invalid_parameter_value then null; end;
end $$;
select identity_private.reveal_api(:'doctor','decide',jsonb_build_object('id',:'reveal_id','decision','approve','reason','Synthetic reviewed concern','singleApproverReason','Synthetic sole clinician policy','reassessed',true));
select identity_private.reveal_api(:'doctor','contact',jsonb_build_object('id',:'reveal_id'))->>'name'='Synthetic Mother' as contact_ok \gset
\if :contact_ok
\else
 \quit 1
\endif
reset role;
do $$ begin
 if (select status from community_private.cases where id=current_setting('test.case')::uuid)='closed' then raise exception 'Response closed flag'; end if;
 if (select count(*) from community_private.username_history)<>1 then raise exception 'Rotation missing'; end if;
 if (select count(*) from identity_private.reveal_audit)<>2 then raise exception 'Audit missing'; end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('community','community_private','identity_private') and c.relkind='r' and (not c.relrowsecurity or not c.relforcerowsecurity)) then raise exception 'RLS missing'; end if;
end $$;
update identity_private.reveal_grants set expires_at=now()-interval '1 second';
set local role medbrief_reveal_service;
do $$ begin
 begin perform identity_private.reveal_api(current_setting('test.doctor'),'contact',jsonb_build_object('id',current_setting('test.reveal'))); raise exception 'Expired contact access'; exception when insufficient_privilege then null; end;
end $$;
reset role;

rollback;
\echo 'Workflow boundaries passed.'
