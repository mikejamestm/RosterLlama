#!/bin/sh
set -eu
PGDATA=${PGDATA:-/var/lib/postgresql/data/pgdata}
export PGDATA
root=/var/lib/postgresql/data
marker="$root/.rosterllama-restored"
if [ -f "$marker" ]; then exec docker-entrypoint.sh postgres; fi
: "${SOURCE_DATABASE_URL:?Source database is required for initial migration}"
if [ -f "$PGDATA/PG_VERSION" ]; then
  echo 'Refusing to overwrite an initialized database without the completed migration marker' >&2
  exit 1
fi
frozen=0
pid=
cleanup() {
  result=$?
  trap - EXIT
  if [ "$result" -ne 0 ] && [ "$frozen" -eq 1 ]; then
    PGOPTIONS='-c default_transaction_read_only=off' psql "$SOURCE_DATABASE_URL" -v ON_ERROR_STOP=1 -f /usr/local/share/unfreeze.sql || true
  fi
  if [ -n "$pid" ]; then kill -TERM "$pid" 2>/dev/null || true; wait "$pid" || true; fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 1' TERM INT
PGOPTIONS='-c default_transaction_read_only=off' psql "$SOURCE_DATABASE_URL" -v ON_ERROR_STOP=1 -f /usr/local/share/freeze.sql
frozen=1
umask 077
pg_dump "$SOURCE_DATABASE_URL" --format=custom --no-owner --no-acl --file="$root/pre-migration.dump"
pg_restore --list "$root/pre-migration.dump" > "$root/pre-migration.contents"
docker-entrypoint.sh postgres &
pid=$!
for attempt in $(seq 1 90); do
  if pg_isready -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" >/dev/null 2>&1; then break; fi
  sleep 1
done
export PGPASSWORD="$POSTGRES_PASSWORD"
pg_restore --exit-on-error --single-transaction --no-owner --no-acl -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$root/pre-migration.dump"
# Compare every public table's row count without printing customer records.
query="SELECT format('SELECT %L AS table_name, count(*) AS rows FROM %I.%I;', tablename, schemaname, tablename) FROM pg_tables WHERE schemaname='public' ORDER BY tablename;"
printf '%s\n\\gexec\n' "$query" > "$root/counts.sql"
psql "$SOURCE_DATABASE_URL" -XAt -v ON_ERROR_STOP=1 -f "$root/counts.sql" > "$root/source-counts.txt"
psql -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -XAt -v ON_ERROR_STOP=1 -f "$root/counts.sql" > "$root/restored-counts.txt"
cmp "$root/source-counts.txt" "$root/restored-counts.txt"
touch "$marker"
echo 'PERSISTENT_DATABASE_RESTORE_VERIFIED: every public table row count matches; original database retained read-only'
kill -TERM "$pid"
wait "$pid"
pid=
trap - EXIT TERM INT
exec docker-entrypoint.sh postgres
