begin;
create or replace function community_private.ready() returns boolean language plpgsql stable security definer set search_path='' as $$
declare config jsonb; roster jsonb; person text; tier_name text; begin
 select jsonb_object_agg(key,value) into config from community_private.settings;
 if config is null or config->'enabled' is distinct from 'true'::jsonb then return false; end if;
 foreach person in array array['consent_version','outreach_text','retention_policy','emergency_protocol'] loop
  if jsonb_typeof(config->person) is distinct from 'string' or length(trim(config->>person))=0 then return false; end if;
 end loop;
 foreach tier_name in array array['urgent','soon','normal'] loop
  if jsonb_typeof(config->'tier_hours'->tier_name) is distinct from 'number' or (config->'tier_hours'->>tier_name)::numeric<=0 then return false; end if;
 end loop;
 foreach person in array array['reporter_threshold','reveal_minutes','timestamp_bucket_seconds'] loop
  if jsonb_typeof(config->person) is distinct from 'number' or (config->>person)::numeric<1 or (config->>person)::numeric<>trunc((config->>person)::numeric) then return false; end if;
 end loop;
 if jsonb_typeof(config->'minimum_account_age_hours') is distinct from 'number' or (config->>'minimum_account_age_hours')::numeric<0 then return false; end if;
 if jsonb_typeof(config->'single_approver_allowed') is distinct from 'boolean' then return false; end if;
 if jsonb_typeof(config->'publication_delay_seconds'->'min') is distinct from 'number' or jsonb_typeof(config->'publication_delay_seconds'->'max') is distinct from 'number' or (config->'publication_delay_seconds'->>'min')::numeric<0 or (config->'publication_delay_seconds'->>'max')::numeric<(config->'publication_delay_seconds'->>'min')::numeric then return false; end if;
 roster:=config->'on_call';
 if jsonb_typeof(roster) is distinct from 'array' or jsonb_array_length(roster)=0 then return false; end if;
 for person in select jsonb_array_elements_text(roster) loop
  if not exists(select 1 from community.members m join community_private.role_grants g on g.community_id=m.community_id where m.community_id=person::uuid and m.status='active' and g.role in ('doctor','therapist') and g.verification_status='verified' and g.revoked_at is null and length(trim(g.display_name))>0) then return false; end if;
 end loop;
 return true;
exception when others then return false;
end $$;
-- A previously issued proof stops working after consent withdrawal or suspension.
create or replace function community_private.actor(proof text) returns uuid language plpgsql security definer set search_path='' as $$
declare member uuid; consent record; begin
 if not community_private.ready() then raise exception 'Not configured' using errcode='55000'; end if;
 select c.member_id into member from identity_private.capabilities c join community.members m on m.community_id=c.member_id where c.token_hash=sha256(convert_to(proof,'UTF8')) and c.expires_at>now() and m.status='active';
 if member is null then raise exception 'Unauthorized' using errcode='42501'; end if;
 select decision,notice_version into consent from community_private.consent_records where community_id=member and purpose='community_participation' order by recorded_at desc,id desc limit 1;
 if consent.decision is distinct from 'granted' or consent.notice_version is distinct from (select value #>> '{}' from community_private.settings where key='consent_version') then raise exception 'Consent required' using errcode='42501'; end if;
 return member;
end $$;
commit;
