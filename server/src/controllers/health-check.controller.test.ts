/**
 * Endpoint tests for the health check.
 *
 * This endpoint is what the container healthcheck and the deploy scripts poll,
 * so the status-code mapping is the contract: 200 healthy, 207 degraded,
 * 503 unhealthy. A degraded dependency must never read as healthy, and a
 * failing dependency must never surface as a 200 with a scary body.
 */

import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test'
import { createDbMock } from '../test/db-mock'
import { createTestApp, req } from '../test/app'

const dbMock = createDbMock()
mock.module('../db', () => ({ db: dbMock.db }))

/** Integration records returned per capability, keyed by capability id. */
let integrationsByCapability: Record<string, unknown[]> = {
  geocoding: [{ integrationId: 'pelias', config: {} }],
  routing: [{ integrationId: 'valhalla', config: {} }],
}
let testResult: { success: boolean } = { success: true }
let testThrows = false

const getConfiguredIntegrationsByCapability = mock(
  (capability: string) => integrationsByCapability[capability] ?? [],
)
const testIntegration = mock(async () => {
  if (testThrows) throw new Error('probe exploded')
  return testResult
})

mock.module('../services/integrations', () => ({
  integrationManager: { getConfiguredIntegrationsByCapability, testIntegration },
}))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
}))

const healthCheck = (await import('./health-check.controller')).default
const app = createTestApp(healthCheck)

beforeEach(() => {
  dbMock.reset()
  integrationsByCapability = {
    geocoding: [{ integrationId: 'pelias', config: {} }],
    routing: [{ integrationId: 'valhalla', config: {} }],
  }
  testResult = { success: true }
  testThrows = false
  getConfiguredIntegrationsByCapability.mockClear()
  testIntegration.mockClear()
})

describe('GET / — healthy', () => {
  test('returns 200 when the database and probes all succeed', async () => {
    const res = await req(app).get('/')

    expect(res.status).toBe(200)
    expect(res.body.status).toBe('healthy')
  })

  test('needs no authentication — the container healthcheck is anonymous', async () => {
    const res = await req(app).get('/')

    expect(res.status).toBe(200)
  })

  test('reports the package version and environment', async () => {
    const res = await req(app).get('/')

    expect(typeof res.body.version).toBe('string')
    expect(res.body.version).toMatch(/^\d+\.\d+\.\d+/)
    // Reported from NODE_ENV rather than hardcoded, so this holds however the
    // suite was invoked.
    expect(res.body.environment).toBe(process.env.NODE_ENV ?? 'unknown')
  })

  test('includes uptime, memory and an ISO timestamp', async () => {
    const res = await req(app).get('/')

    expect(typeof res.body.uptime).toBe('number')
    expect(typeof res.body.memory.heapUsed).toBe('number')
    expect(new Date(res.body.timestamp).toISOString()).toBe(res.body.timestamp)
  })

  test('probes both geocoding and routing', async () => {
    await req(app).get('/')

    const probed = getConfiguredIntegrationsByCapability.mock.calls.map((c) => c[0])
    expect(probed).toContain('geocoding')
    expect(probed).toContain('routing')
  })
})

describe('GET / — degraded', () => {
  test('207s when no geocoding integration is configured', async () => {
    integrationsByCapability.geocoding = []

    const res = await req(app).get('/')

    expect(res.status).toBe(207)
    expect(res.body.status).toBe('degraded')
  })

  test('207s when no routing integration is configured', async () => {
    integrationsByCapability.routing = []

    const res = await req(app).get('/')

    expect(res.status).toBe(207)
    expect(res.body.status).toBe('degraded')
  })

  test('207s when a dependency probe reports failure', async () => {
    testResult = { success: false }

    const res = await req(app).get('/')

    expect(res.status).toBe(207)
    expect(res.body.status).toBe('degraded')
  })

  test('a throwing probe degrades rather than 500s', async () => {
    testThrows = true

    const res = await req(app).get('/')

    expect(res.status).toBe(207)
    expect(res.body.status).toBe('degraded')
  })
})

describe('GET / — unhealthy', () => {
  const workingSelect = dbMock.db.select

  /** Make the health check's `db.select(...).limit(1)` probe blow up. */
  function breakDatabase() {
    dbMock.db.select = () => {
      throw new Error('connection refused')
    }
  }

  afterEach(() => {
    dbMock.db.select = workingSelect
  })

  test('503s when the database query fails', async () => {
    breakDatabase()

    const res = await req(app).get('/')

    expect(res.status).toBe(503)
    expect(res.body.status).toBe('unhealthy')
  })

  test('an unhealthy response still carries the version payload', async () => {
    breakDatabase()

    const res = await req(app).get('/')

    expect(typeof res.body.version).toBe('string')
    expect(res.body.timestamp).toBeDefined()
  })

  test('the database recovers once the failure clears', async () => {
    breakDatabase()
    expect((await req(app).get('/')).status).toBe(503)

    dbMock.db.select = workingSelect

    expect((await req(app).get('/')).status).toBe(200)
  })
})
