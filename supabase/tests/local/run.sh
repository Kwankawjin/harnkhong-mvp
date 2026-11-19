#!/usr/bin/env bash
# Rebuild a throwaway database from every migration, then run SQL tests against it.
# Usage: supabase/tests/local/run.sh [test.sql ...]
# Needs a local Postgres 16 and a superuser role for the current OS user (peer auth).
# It only ever touches the database named below (default: harnkhong_test).
set -euo pipefail
cd "$(dirname "$0")/../../.."
DB=${HARNKHONG_TEST_DB:-harnkhong_test}
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB"
"${PSQL[@]}" -d "$DB" -f supabase/tests/local/supabase-stubs.sql
for file in supabase/migrations/*.sql; do
  "${PSQL[@]}" -d "$DB" -f "$file" > /dev/null || { echo "migration failed: $file"; exit 1; }
done
echo "migrations: ok ($(ls supabase/migrations/*.sql | wc -l) files)"
if [ "$#" -eq 0 ]; then set -- supabase/tests/billing.sql; fi
for test in "$@"; do
  "${PSQL[@]}" -d "$DB" -f "$test"
  echo "test passed: $test"
done
