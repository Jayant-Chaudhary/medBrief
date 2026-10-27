\set ON_ERROR_STOP on
begin;
insert into auth.users(id) values ('10000000-0000-0000-0000-000000000001');
set local role medbrief_reveal_service;
insert into community.members(community_id, username) values ('20000000-0000-0000-0000-000000000001', 'synthetic_mother');
insert into identity_private.community_links(auth_user_id, community_id) values ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001');
insert into community_private.consent_records(community_id, notice_version, purpose, decision) values ('20000000-0000-0000-0000-000000000001', 'test-v1', 'community_participation', 'granted');
do $$ begin
  if (select count(*) from identity_private.community_links) <> 1 or
     (select count(*) from community.members) <> 1 or
     (select count(*) from community_private.consent_records) <> 1 then
    raise exception 'Identity service read policy failed';
  end if;
  begin
    update community.members set username = 'unexpected';
    raise exception 'Unexpected username update permission';
  exception when insufficient_privilege then null; end;
  begin
    delete from community_private.consent_records;
    raise exception 'Consent must be append-only';
  exception when insufficient_privilege then null; end;
  begin
    insert into community_private.role_grants(community_id, role, verification_status, granted_by)
    values ('20000000-0000-0000-0000-000000000001', 'doctor', 'verified', '20000000-0000-0000-0000-000000000001');
    raise exception 'Unexpected role assignment permission';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
insert into community_private.role_grants(community_id, role, verification_status, granted_by)
values ('20000000-0000-0000-0000-000000000001', 'doctor', 'verified', '20000000-0000-0000-0000-000000000001');
set local role medbrief_community_reader;
do $$ begin
  if (select count(*) from community.members) <> 1 or
     (select count(*) from community_private.role_grants) <> 1 then
    raise exception 'Community backend read policies failed';
  end if;
end $$;
reset role;

-- All client personas use the authenticated database role, regardless of badge.
do $$ declare db_role text; persona text; relation text; begin
  foreach db_role in array array['anon', 'authenticated', 'service_role', 'medbrief_community_reader'] loop
    foreach persona in array array['patient', 'doctor', 'therapist', 'moderator'] loop
      perform set_config('request.jwt.claims', json_build_object('role', db_role, 'app_metadata', json_build_object('role', persona))::text, true);
      execute format('set local role %I', db_role);
      begin
        perform * from identity_private.community_links;
        raise exception 'Mapping accessible to % / %', db_role, persona;
      exception when insufficient_privilege then null; end;
      execute 'reset role';
    end loop;
  end loop;
  foreach db_role in array array['anon', 'authenticated', 'service_role'] loop
    execute format('set local role %I', db_role);
    foreach relation in array array['community.members', 'community_private.role_grants', 'community_private.username_history', 'community_private.consent_records'] loop
      begin
        execute 'select * from ' || relation;
        raise exception 'Unexpected direct table access: % / %', db_role, relation;
      exception when insufficient_privilege then null; end;
    end loop;
    execute 'reset role';
  end loop;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('community', 'community_private', 'identity_private')
      and c.relkind = 'r' and (not c.relrowsecurity or not c.relforcerowsecurity)) then
    raise exception 'Missing forced RLS';
  end if;
  if exists (select 1 from pg_roles where rolname in ('medbrief_reveal_service', 'medbrief_community_reader') and (rolsuper or rolbypassrls or rolcanlogin)) then
    raise exception 'Unsafe service capability role';
  end if;
end $$;
rollback;
\echo 'Community identity permissions passed.'
