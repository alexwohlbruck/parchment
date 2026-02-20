/**
 * Helpers for test data and API-based seeding.
 * Use when tests need to set up or reset data via the backend API.
 */

const getBaseUrl = () =>
  process.env.SERVER_ORIGIN || process.env.VITE_SERVER_ORIGIN || 'http://localhost:5001'

/**
 * Fetch JSON fixture from the e2e fixtures directory.
 * In Node/Playwright we resolve relative to project.
 */
export async function loadFixture<T = unknown>(name: string): Promise<T> {
  const path = await import('path')
  const { fileURLToPath } = await import('url')
  const __dirname = path.dirname(fileURLToPath(import.meta.url))
  const fixturePath = path.resolve(__dirname, '../fixtures', `${name}.json`)
  const fs = await import('fs/promises')
  const raw = await fs.readFile(fixturePath, 'utf-8')
  return JSON.parse(raw) as T
}

/**
 * Health check for the test server.
 */
export async function waitForServer(url?: string, maxAttempts = 60): Promise<boolean> {
  const base = url || getBaseUrl()
  const healthUrl = base.replace(/\/$/, '') + '/'
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(healthUrl)
      if (res.ok || res.status === 207) return true
    } catch {
      // ignore
    }
    await new Promise(r => setTimeout(r, 2000))
  }
  return false
}

/**
 * Fail fast if the backend is not reachable (e.g. Docker not started).
 * Call from test beforeAll/beforeEach so UI runs and "Run selected tests" get a clear error
 * instead of a generic "Network error" in the app.
 */
export async function requireBackend(): Promise<void> {
  const base = getBaseUrl()
  const healthUrl = base.replace(/\/$/, '') + '/'
  try {
    const res = await fetch(healthUrl)
    if (res.ok || res.status === 207) return
  } catch {
    // fall through to throw
  }
  throw new Error(
    `Backend at ${base} is not reachable. E2E tests need the Docker test stack. ` +
      `From repo root run: docker compose -f docker-compose.test.yml --env-file .env.test up -d ` +
      `Or run the full e2e suite once: cd web && bun run test:e2e`
  )
}
