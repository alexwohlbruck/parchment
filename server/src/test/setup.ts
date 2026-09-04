/**
 * Test bootstrap — preloaded before every test file via bunfig.toml.
 *
 * Gives the suite a deterministic environment so a run doesn't depend on
 * whatever happens to be in a developer's shell. Two things matter here:
 *
 *   1. DB-backed tests point at the isolated test database (port 5433), never
 *      the dev database. See `scripts/test-db.sh`.
 *   2. Crypto env vars get fixed, obviously-fake values. Modules like
 *      `server-identity` and `integration-encryption` throw at import when
 *      these are missing, which would fail unrelated tests that merely pull in
 *      a service transitively.
 *
 * Every value is a default: an explicitly exported variable always wins, so CI
 * can point the suite at a service container without touching this file.
 */

const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  TZ: 'UTC',

  DATABASE_URL:
    process.env.TEST_DATABASE_URL ??
    'postgresql://test_user:test_password@localhost:5433/parchment_test',
  POSTGRES_USER: 'test_user',
  POSTGRES_PASSWORD: 'test_password',
  POSTGRES_HOST: 'localhost',
  POSTGRES_DB: 'parchment_test',

  SERVER_ORIGIN: 'http://localhost:5001',
  CLIENT_ORIGIN: 'http://localhost:5174',

  // 32 zero bytes / 32 0x01 bytes, base64. Deterministic so signature and
  // envelope fixtures stay stable across runs.
  SERVER_IDENTITY_PRIVATE_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  PARCHMENT_INTEGRATION_ENCRYPTION_KEY:
    'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',

  // Keep the mailer from attempting real SMTP if a test reaches it.
  SMTP_HOST: '',

  APP_TESTER_EMAIL: 'test@parchment.local',
}

for (const [key, value] of Object.entries(defaults)) {
  process.env[key] ??= value
}
