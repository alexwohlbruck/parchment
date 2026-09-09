#!/bin/sh
# Bring up the isolated test database and migrate it.
#
# DB-backed tests run against this Postgres (port 5433 from docker-compose.test.yml),
# never the dev database — a crashed run can leave orphan rows, and tests are free
# to truncate here. Idempotent: safe to run before every test invocation.
#
#   sh server/scripts/test-db.sh
#
# Set TEST_DATABASE_URL to point the suite somewhere else (CI service container,
# a remote instance); this script then only waits for it and migrates.
set -e

REPO_ROOT=$(cd "$(dirname "$0")/../.." && pwd)
DB_URL=${TEST_DATABASE_URL:-postgresql://test_user:test_password@localhost:5433/parchment_test}

# Only manage the container when using the default local URL. A caller-supplied
# TEST_DATABASE_URL means the database is provisioned elsewhere (CI service
# container, remote instance) and is already up.
if [ -z "$TEST_DATABASE_URL" ]; then
  echo "Starting test database..."
  # Pass the test credentials explicitly. `docker compose` auto-loads the repo
  # root .env, so without these the container would be initialized with the
  # *dev* database credentials and every connection here would fail auth.
  POSTGRES_DB=parchment_test \
  POSTGRES_USER=test_user \
  POSTGRES_PASSWORD=test_password \
    docker compose -f "$REPO_ROOT/docker-compose.test.yml" up -d parchment-db-test
fi

cd "$REPO_ROOT/server"

# Poll by actually connecting over TCP the way the tests will, not with
# pg_isready: the kartoza image runs initdb then restarts, and pg_isready
# reports ready during that window while connections still fail with
# "the database system is starting up" (57P03).
echo "Waiting for test database..."
DATABASE_URL="$DB_URL" bun -e '
  const postgres = (await import("postgres")).default
  const deadline = Date.now() + 90_000
  for (;;) {
    const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} })
    try {
      await sql`select 1`
      await sql.end()
      process.exit(0)
    } catch (error) {
      await sql.end({ timeout: 0 }).catch(() => {})
      if (Date.now() > deadline) {
        console.error("Test database did not accept connections within 90s:", error.message)
        process.exit(1)
      }
      await new Promise((r) => setTimeout(r, 1000))
    }
  }
'

echo "Migrating test database..."
DATABASE_URL="$DB_URL" POSTGRES_USER=test_user bun src/migrate.ts

echo "Test database ready at $DB_URL"
