-- Community identity foundation only. No public endpoints or reveal operation.
begin;

-- Capability roles: provision separate service login credentials outside migrations.
-- Never grant these roles to authenticator, anon, authenticated or service_role.
create role medbrief_reveal_service nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
create role medbrief_community_reader nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;

create schema identity_private;
create schema community;
create schema community_private;
revoke all on schema identity_private, community, community_private from public, anon, authenticated, service_role;

create table community.members (
  community_id uuid primary key default gen_random_uuid(),
  username text not null unique check (username ~ '^[a-z][a-z0-9_]{2,31}$'),
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  joined_at timestamptz not null default now(),
  username_changed_at timestamptz not null default now()
);

create table identity_private.community_links (
  auth_user_id uuid primary key references auth.users(id) on delete restrict,
  community_id uuid not null unique references community.members(community_id) on delete restrict,
  created_at timestamptz not null default now()
);  

create table community_private.username_history (
  previous_username text primary key check (previous_username ~ '^[a-z][a-z0-9_]{2,31}$'),
  community_id uuid not null references community.members(community_id) on delete restrict,
  retired_at timestamptz not null default now(),
  reason_code text not null check (reason_code in ('member_request', 'approved_reveal', 'moderation'))
);

create table community_private.role_grants (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references community.members(community_id) on delete restrict,
  role text not null check (role in ('peer_volunteer', 'doctor', 'therapist', 'moderator')),
  verification_status text not null check (verification_status in ('pending', 'verified', 'rejected')),
  granted_by uuid not null references community.members(community_id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz check (revoked_at >= granted_at)
);
create unique index community_active_role on community_private.role_grants(community_id, role) where revoked_at is null;

create table community_private.consent_records (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references community.members(community_id) on delete restrict,
  notice_version text not null check (length(trim(notice_version)) > 0),
  purpose text not null check (purpose in ('community_participation', 'cloud_text_processing')),
  decision text not null check (decision in ('granted', 'withdrawn')),
  recorded_at timestamptz not null default now()
);
create index community_consent_history on community_private.consent_records(community_id, purpose, recorded_at desc);

-- Explicit grants matter: service_role bypasses RLS but must still lack privileges.
revoke all on all tables in schema identity_private, community, community_private from public, anon, authenticated, service_role;
alter default privileges in schema identity_private, community, community_private revoke all on tables from public, anon, authenticated, service_role;
alter default privileges in schema identity_private, community, community_private revoke execute on functions from public, anon, authenticated, service_role;

alter table community.members enable row level security;
alter table community.members force row level security;
alter table identity_private.community_links enable row level security;
alter table identity_private.community_links force row level security;
alter table community_private.username_history enable row level security;
alter table community_private.username_history force row level security;
alter table community_private.role_grants enable row level security;
alter table community_private.role_grants force row level security;
alter table community_private.consent_records enable row level security;
alter table community_private.consent_records force row level security;

-- The isolated identity/reveal service can enroll and resolve members internally.
-- It cannot rotate usernames or disclose identities through an API yet.
grant usage on schema identity_private, community, community_private to medbrief_reveal_service;
grant select, insert on identity_private.community_links, community.members, community_private.consent_records to medbrief_reveal_service;
create policy identity_service_read_links on identity_private.community_links for select to medbrief_reveal_service using (true);
create policy identity_service_insert_links on identity_private.community_links for insert to medbrief_reveal_service with check (true);
create policy identity_service_read_members on community.members for select to medbrief_reveal_service using (true);
create policy identity_service_insert_members on community.members for insert to medbrief_reveal_service with check (true);
create policy identity_service_read_consent on community_private.consent_records for select to medbrief_reveal_service using (true);
create policy identity_service_insert_consent on community_private.consent_records for insert to medbrief_reveal_service with check (true);

-- Backend-only reader, not a user/doctor role; never return its raw rows to clients.
grant usage on schema community, community_private to medbrief_community_reader;
grant select on community.members, community_private.role_grants to medbrief_community_reader;
create policy community_service_read_members on community.members for select to medbrief_community_reader using (true);
create policy community_service_read_roles on community_private.role_grants for select to medbrief_community_reader using (true);
-- History has no runtime policies yet. Role grants are provisioned administratively.
commit;
