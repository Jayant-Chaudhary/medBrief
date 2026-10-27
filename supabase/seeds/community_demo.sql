-- SYNTHETIC TEST ENVIRONMENT ONLY. These timings are test fixtures, not clinical defaults.
-- First create/sign up a TEST doctor account through Supabase Auth or the app.
-- Replace the UUID placeholder below with that account's Authentication > Users ID.
-- Run the WHOLE file as an administrator in Supabase SQL Editor.
-- Do not run against a database containing real community participants.
begin;
do $$
declare
  test_doctor_auth_id uuid := 'b0ca34a0-69f0-4085-9ffe-fd2751d2bd33';
  doctor_member uuid;
  existing_version text;
begin
  perform pg_advisory_xact_lock(hashtextextended('community-demo-bootstrap', 0));
  select value #>> '{}' into existing_version
    from community_private.settings where key = 'consent_version';
  if existing_version is not null and existing_version <> 'demo-only-v1' then
    raise exception 'Refusing to replace a different community configuration';
  end if;
  if not exists (select 1 from auth.users where id = test_doctor_auth_id) then
    raise exception 'Create the test doctor in Supabase Auth first';
  end if;
  -- Refuse to repurpose an existing community containing other accounts.
  if exists (
    select 1 from community.members m
    where not exists (
      select 1 from identity_private.community_links l
      where l.community_id = m.community_id and l.auth_user_id = test_doctor_auth_id
    )
  ) then
    raise exception 'Use an empty test community; other memberships already exist';
  end if;

  select community_id into doctor_member
    from identity_private.community_links where auth_user_id = test_doctor_auth_id;
  if doctor_member is null then
    insert into community.members(username)
      values ('test_doctor_' || left(replace(gen_random_uuid()::text, '-', ''), 16))
      returning community_id into doctor_member;
    insert into identity_private.community_links(auth_user_id, community_id)
      values (test_doctor_auth_id, doctor_member);
  end if;
  if not exists (select 1 from community.members
    where community_id = doctor_member and status = 'active') then
    raise exception 'Test doctor community membership is not active';
  end if;
  -- One administrator-bootstrapped test professional. Consent is still accepted in the UI.
  insert into community_private.role_grants
    (community_id, role, verification_status, granted_by, display_name)
    values (doctor_member, 'doctor', 'verified', doctor_member, 'TEST Doctor — Simulation')
    on conflict (community_id, role) where revoked_at is null
    do update set verification_status = excluded.verification_status,
      display_name = excluded.display_name;

  insert into community_private.settings(key, value)
    select key, value from jsonb_each(jsonb_build_object(
      'enabled', false,
      'consent_version', 'demo-only-v1',
      'outreach_text', 'TEST ONLY: This is a simulated private support message. Open this conversation and choose a response to test the workflow. No professional monitoring or emergency response is provided by this test environment.',
      'tier_hours', jsonb_build_object('urgent', 1.0/60, 'soon', 5.0/60, 'normal', 10.0/60),
      'reporter_threshold', 2,
      'minimum_account_age_hours', 0,
      'on_call', jsonb_build_array(doctor_member::text),
      'retention_policy', 'TEST ONLY: Synthetic data. Administrator removes test data after the test session. This text does not implement automatic deletion.',
      'reveal_minutes', 1,
      'emergency_protocol', 'TEST ONLY: Simulate professional review and contact with test accounts. Do not contact real patients, relatives, emergency services or external helplines.',
      'publication_delay_seconds', jsonb_build_object('min', 2, 'max', 5),
      'timestamp_bucket_seconds', 60,
      'single_approver_allowed', true
    ))
    on conflict (key) do update set value = excluded.value;

  insert into community.tags(slug, name, active) values
    ('test-first-pregnancy', 'TEST: First pregnancy', true),
    ('test-after-delivery', 'TEST: After delivery', true),
    ('test-general-support', 'TEST: General support', true)
    on conflict (slug) do nothing;

  update community_private.settings set value = 'true'::jsonb where key = 'enabled';
  if not community_private.ready() then
    raise exception 'Test configuration failed readiness checks; no changes committed';
  end if;
end $$;
commit;

-- Returns no account IDs, mapping rows or private credentials.
select community_private.ready() as community_ready;
