#!/usr/bin/env bash
# Isolated synthetic PostgreSQL test; never reads project credentials.
set -euo pipefail
repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
pg_bin="${PG_BIN:-/usr/lib/postgresql/16/bin}"
test_root="$(mktemp -d /tmp/medbrief-community-test.XXXXXX)"
cleanup() {
  "$pg_bin/pg_ctl" -D "$test_root/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$test_root"
}
trap cleanup EXIT
"$pg_bin/initdb" -D "$test_root/data" -A trust --no-locale >/dev/null
# Unique Unix socket directory, no TCP listener; no interaction with existing DBs.
"$pg_bin/pg_ctl" -D "$test_root/data" -l "$test_root/postgres.log" -o "-k $test_root -c listen_addresses=''" -w start >/dev/null
psql_args=(-X -h "$test_root" -d postgres -v ON_ERROR_STOP=1)
psql "${psql_args[@]}" >/dev/null <<'SQL'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.users (id uuid primary key);
create table public.profiles(id uuid primary key references auth.users,full_name text,phone text);
alter table public.profiles enable row level security;
SQL
migration="$repo_root/supabase/migrations/20261027000000_community_identity.sql"
psql "${psql_args[@]}" -f "$migration" >/dev/null
for migration in "$repo_root"/supabase/migrations/20261028*.sql; do
  psql "${psql_args[@]}" -f "$migration" >/dev/null
done
psql "${psql_args[@]}" -f "$repo_root/supabase/tests/community_workflows.sql"
# Exercise the actual Node adapter with a restricted synthetic login, including
# its fail-closed logging check. No hosted credentials or patient data are used.
psql "${psql_args[@]}" >/dev/null <<'SQL'
create role community_adapter_test login;
grant medbrief_reveal_service to community_adapter_test;
alter role community_adapter_test set log_min_error_statement='panic';
SQL
COMMUNITY_TEST_DB="postgresql://community_adapter_test@localhost/postgres?host=$test_root" COMMUNITY_TEST_ROOT="$repo_root" node <<'JS'
const assert = require('node:assert/strict');
const {createDatabase} = require(process.env.COMMUNITY_TEST_ROOT + '/server/src/community/database');
(async () => {
 const db = createDatabase(process.env.COMMUNITY_TEST_DB);
 const notice = await db('community_private.notice_api');
 assert.equal(notice.enabled, false);
 await assert.rejects(db('community_private.read_api', ['forged', 'me', {}]), error => error.status === 403);
 await assert.rejects(db('identity_private.issue_capability', ['invalid-uuid', null]), error => error.status === 400);
 console.log('Restricted Node database adapter smoke test passed.');
})().catch(error => { console.error('Database adapter smoke test failed.', error.code, error.status, error.actual, error.expected); process.exitCode = 1; });
JS
psql "${psql_args[@]}" >/dev/null <<'SQL'
alter role community_adapter_test reset log_min_error_statement;
SQL
COMMUNITY_TEST_DB="postgresql://community_adapter_test@localhost/postgres?host=$test_root" COMMUNITY_TEST_ROOT="$repo_root" node <<'JS'
const assert = require('node:assert/strict');
const {createDatabase} = require(process.env.COMMUNITY_TEST_ROOT + '/server/src/community/database');
assert.rejects(createDatabase(process.env.COMMUNITY_TEST_DB)('community_private.notice_api'), error => error.status === 503)
 .then(() => console.log('Unsafe database logging was refused.'))
 .catch(() => { console.error('Logging guard test failed.'); process.exitCode = 1; });
JS
psql "${psql_args[@]}" -c 'drop role community_adapter_test' >/dev/null
# Validate the manual synthetic demo seed, including a safe repeated application.
psql "${psql_args[@]}" -c "insert into auth.users values ('10000000-0000-4000-8000-000000000099')" >/dev/null
sed 's/REPLACE_WITH_TEST_DOCTOR_USER_UUID/10000000-0000-4000-8000-000000000099/g' \
  "$repo_root/supabase/seeds/community_demo.sql" > "$test_root/demo.sql"
psql "${psql_args[@]}" -f "$test_root/demo.sql" >/dev/null
psql "${psql_args[@]}" -f "$test_root/demo.sql" >/dev/null
psql "${psql_args[@]}" >/dev/null <<'SQL'
do $$ begin
 if not community_private.ready() then raise exception 'Demo seed not ready'; end if;
 if (select count(*) from community.members) <> 1 then raise exception 'Duplicate demo member'; end if;
 if (select count(*) from community_private.role_grants) <> 1 then raise exception 'Duplicate demo grant'; end if;
 if (select count(*) from community_private.settings) <> 13 then raise exception 'Incomplete demo settings'; end if;
 if (select count(*) from community.tags) <> 3 then raise exception 'Duplicate demo tags'; end if;
 if exists(select 1 from community_private.consent_records) then raise exception 'Demo seed fabricated consent'; end if;
end $$;
SQL
printf '%s\n' 'Synthetic demo seed and repeated application passed.'
psql "${psql_args[@]}" -f "$repo_root/supabase/rollbacks/20261028000000_community_workflows.sql" >/dev/null
for migration in "$repo_root"/supabase/migrations/20261028*.sql; do
  psql "${psql_args[@]}" -f "$migration" >/dev/null
done
psql "${psql_args[@]}" -f "$repo_root/supabase/tests/community_workflows.sql" >/dev/null
printf '%s\n' 'Community workflow migrations, tests, rollback and reapplication passed.'

