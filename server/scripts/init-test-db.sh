#!/bin/sh
# Re-run migrations and seed for the test database.
# Run inside the server container when using docker-compose.test.yml:
#   docker compose -f docker-compose.test.yml exec parchment-server-test sh /app/server/scripts/init-test-db.sh
# Or from repo root with test DB URL:
#   DATABASE_URL=postgresql://test_user:test_password@localhost:5433/parchment_test bun run server/scripts/init-test-db.sh
set -e
cd /app/server 2>/dev/null || true
echo "Running migrations..."
bun run migrate:prod
echo "Running seed (APP_TESTER_EMAIL will be used for initial user if set)..."
bun run seed:prod
echo "Test database ready."
