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
SQL
migration="$repo_root/supabase/migrations/20261027000000_community_identity.sql"
psql "${psql_args[@]}" -f "$migration" >/dev/null
psql "${psql_args[@]}" -f "$repo_root/supabase/tests/community_identity.sql"
psql "${psql_args[@]}" -f "$repo_root/supabase/rollbacks/20261027000000_community_identity.sql" >/dev/null
psql "${psql_args[@]}" -f "$migration" >/dev/null
psql "${psql_args[@]}" -f "$repo_root/supabase/tests/community_identity.sql" >/dev/null
printf '%s\n' 'Migration, access checks, rollback and reapply passed.'
