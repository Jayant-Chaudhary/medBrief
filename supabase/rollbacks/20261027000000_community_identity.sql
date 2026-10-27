-- DESTRUCTIVE: development rollback only. Export/resolve retained data before use.
-- RESTRICT deliberately fails if later features or login roles depend on this step.
begin;
drop table community_private.consent_records;
drop table community_private.role_grants;
drop table community_private.username_history;
drop table identity_private.community_links;
drop table community.members;
drop schema identity_private;
drop schema community_private;
drop schema community;
drop role medbrief_community_reader;
drop role medbrief_reveal_service;
commit;
