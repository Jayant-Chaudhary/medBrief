begin;
create role medbrief_community_runtime nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role medbrief_community_worker nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
grant usage on schema community_private to medbrief_community_runtime,medbrief_community_worker;

-- Called only by the isolated service AFTER validating the Supabase session.
create function identity_private.issue_capability(account uuid,accept_notice text default null) returns text
language plpgsql security definer set search_path='' as $$
declare member uuid; proof text; notice text; begin
 perform pg_advisory_xact_lock(hashtextextended(account::text,0));
 select community_id into member from identity_private.community_links where auth_user_id=account;
 if member is null then
  if accept_notice is null then raise exception 'Consent required' using errcode='42501'; end if;
  select value #>> '{}' into notice from community_private.settings where key='consent_version';
  if notice is null or notice<>accept_notice then raise exception 'Invalid notice' using errcode='22023'; end if;
  insert into community.members(username) values('mother_'||left(replace(gen_random_uuid()::text,'-',''),24)) returning community_id into member;
  insert into identity_private.community_links(auth_user_id,community_id) values(account,member);
 end if;
 if accept_notice is not null then
  select value #>> '{}' into notice from community_private.settings where key='consent_version';
  if notice is null or notice<>accept_notice then raise exception 'Invalid notice' using errcode='22023'; end if;
  insert into community_private.consent_records(community_id,notice_version,purpose,decision) values(member,accept_notice,'community_participation','granted');
 end if;
 if not exists(select 1 from community.members where community_id=member and status='active') then raise exception 'Unavailable' using errcode='42501'; end if;
 proof:=gen_random_uuid()::text||gen_random_uuid()::text;
 insert into identity_private.capabilities values(sha256(convert_to(proof,'UTF8')),member,now()+interval '60 seconds');
 delete from identity_private.capabilities where expires_at<now();
 return proof;
end $$;
-- Username limit in initial schema is 32 characters.
-- Generated aliases use only a random prefix; insertion collisions fail and are retried.
create function community_private.actor(proof text) returns uuid language plpgsql security definer set search_path='' as $$
declare member uuid; begin
 select c.member_id into member from identity_private.capabilities c join community.members m on m.community_id=c.member_id where c.token_hash=sha256(convert_to(proof,'UTF8')) and c.expires_at>now() and m.status='active';
 if member is null then raise exception 'Unauthorized' using errcode='42501'; end if;
 return member;
end $$;
create function community_private.is_professional(member uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from community_private.role_grants where community_id=member and role in ('doctor','therapist') and verification_status='verified' and revoked_at is null) $$;
create function community_private.is_moderator(member uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from community_private.role_grants where community_id=member and role='moderator' and verification_status='verified' and revoked_at is null) $$;
create function community_private.can_thread(member uuid,t uuid) returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from community_private.care_threads where id=t and (subject_id=member or (community_private.is_professional(member) and exists(select 1 from community_private.care_participants where thread_id=t and professional_id=member and revoked_at is null)))) $$;
create function community_private.ready() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select value='true'::jsonb from community_private.settings where key='enabled'),false)
 and not exists(select 1 from unnest(array['consent_version','outreach_text','tier_hours','reporter_threshold','minimum_account_age_hours','on_call','retention_policy','reveal_minutes','emergency_protocol','publication_delay_seconds','timestamp_bucket_seconds','single_approver_allowed']) k where not exists(select 1 from community_private.settings where key=k and value not in ('null'::jsonb,'""'::jsonb)))
$$;
-- Internal helper; never granted to callers. Caller has already established the reason.
create function community_private.open_case(p uuid,c uuid,tier_value text,reason_value text,actor_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare subject uuid; k uuid; thread uuid; message uuid; deadline timestamptz; existing_tier text; begin
 if p is not null then select author_id into subject from community.posts where id=p for update;
 else select author_id into subject from community.comments where id=c for update; end if;
 if subject is null then raise exception 'Not found' using errcode='P0002'; end if;
 select id,tier into k,existing_tier from community_private.cases where status<>'closed' and (post_id=p or comment_id=c) for update;
 if k is not null then
  if tier_value='urgent' or (tier_value='soon' and existing_tier='normal') then
   update community_private.cases set tier=tier_value,response_due=case when responded_at is null then least(response_due,now()+make_interval(secs=>((select value->>tier_value from community_private.settings where key='tier_hours')::double precision)*3600)) else response_due end where id=k;
   update community_private.jobs set due_at=(select response_due from community_private.cases where id=k) where kind='deadline' and reference_id=k and state='pending';
  end if;
  insert into community_private.case_events(case_id,actor_id,event) values(k,actor_id,reason_value);
  return k;
 end if;
 deadline:=now()+make_interval(secs => ((select value->>tier_value from community_private.settings where key='tier_hours')::double precision)*3600);
 if deadline is null then raise exception 'Safety configuration missing' using errcode='55000'; end if;
 insert into community_private.cases(subject_id,post_id,comment_id,tier,reason,status,response_due) values(subject,p,c,tier_value,reason_value,'outreach',deadline) returning id into k;
 insert into community_private.case_events(case_id,actor_id,event) values(k,actor_id,reason_value);
 insert into community_private.care_threads(case_id,subject_id) values(k,subject) returning id into thread;
 insert into community_private.messages(thread_id,sender_type,body) values(thread,'system',(select value #>> '{}' from community_private.settings where key='outreach_text')) returning id into message;
 insert into community_private.notification_outbox(recipient_id,message_id) values(subject,message);
 insert into community_private.notification_outbox(recipient_id,message_id) select v::uuid,message from community_private.settings s,jsonb_array_elements_text(s.value) v where s.key='on_call' on conflict do nothing;
 insert into community_private.jobs(kind,reference_id,dedup_key,due_at) values('deadline',k,'deadline:'||k,deadline);
 insert into community_private.jobs(kind,reference_id,dedup_key,due_at) select 'push',id,'push:'||id,now() from community_private.notification_outbox where message_id=message;
 return k;
end $$;
revoke execute on all functions in schema identity_private,community_private from public,anon,authenticated,service_role;
grant execute on function identity_private.issue_capability(uuid,text) to medbrief_reveal_service;
commit;
