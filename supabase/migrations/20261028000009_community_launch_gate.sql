begin;
create function community_private.notice_api() returns jsonb language sql security definer set search_path='' as $$ select jsonb_build_object('enabled',community_private.ready(),'version',(select value from community_private.settings where key='consent_version'),'text','Other members see your username. Anonymity is not absolute. If you may be in danger, an approved safety process may allow the care team to identify and contact you. Community activity is separate from your patient record.') $$;
revoke all on function community_private.notice_api() from public,anon,authenticated,service_role,medbrief_community_runtime,medbrief_community_worker;
grant execute on function community_private.notice_api() to medbrief_reveal_service;
-- Every new proof requires current consent; revocation invalidates new requests.
create or replace function identity_private.issue_capability(account uuid,accept_notice text default null) returns text language plpgsql security definer set search_path='' as $$
declare member uuid; proof text; notice text; decision_row record; begin
 if not community_private.ready() then raise exception 'Not configured' using errcode='55000'; end if;
 perform pg_advisory_xact_lock(hashtextextended(account::text,0));
 select value #>> '{}' into notice from community_private.settings where key='consent_version';
 if accept_notice is not null and accept_notice<>notice then raise exception 'Invalid notice' using errcode='22023'; end if;
 select community_id into member from identity_private.community_links where auth_user_id=account;
 if member is null then
  if accept_notice is null then raise exception 'Consent required' using errcode='42501'; end if;
  insert into community.members(username) values('mother_'||left(replace(gen_random_uuid()::text,'-',''),24)) returning community_id into member;
  insert into identity_private.community_links(auth_user_id,community_id) values(account,member);
 end if;
 if accept_notice is not null then insert into community_private.consent_records(community_id,notice_version,purpose,decision) values(member,accept_notice,'community_participation','granted'); end if;
 select decision,notice_version into decision_row from community_private.consent_records where community_id=member and purpose='community_participation' order by recorded_at desc,id desc limit 1;
 if decision_row.decision is distinct from 'granted' or decision_row.notice_version is distinct from notice then raise exception 'Consent required' using errcode='42501'; end if;
 if not exists(select 1 from community.members where community_id=member and status='active') then raise exception 'Unavailable' using errcode='42501'; end if;
 proof:=gen_random_uuid()::text||gen_random_uuid()::text;
 insert into identity_private.capabilities values(sha256(convert_to(proof,'UTF8')),member,now()+interval '60 seconds');
 delete from identity_private.capabilities where expires_at<now(); return proof;
end $$;
commit;
