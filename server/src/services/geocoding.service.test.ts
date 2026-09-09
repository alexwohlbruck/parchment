/**
 * Tests for provider selection in the geocoding service.
 *
 * The behaviour worth pinning: providers are tried in the order the integration
 * manager hands them back (priority-sorted, Barrelman first), a provider that
 * errors or returns nothing yields to the next, and an outage across *all* of
 * them still surfaces as an error rather than looking like an empty result.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'

let configuredIntegrations: any[] = []
const instances = new Map<string, any>()

mock.module('./integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationsByCapability: () => configuredIntegrations,
    getCachedIntegrationInstance: (record: any) => instances.get(record.integrationId),
  },
}))

mock.module('../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logError: () => {},
  logWarn: () => {},
}))

const { forwardGeocode, reverseGeocode } = await import('./geocoding.service')

/** Register a provider, in priority order, with the given geocoding behaviour. */
function provider(integrationId: string, geocoding: any) {
  configuredIntegrations.push({ integrationId })
  instances.set(integrationId, { capabilities: { geocoding } })
}

const place = (name: string) => ({ name }) as any

/** A provider that answers both directions with the same fixed result. */
function answering(name: string) {
  return {
    geocode: mock(async () => [place(name)]),
    reverseGeocode: mock(async () => [place(name)]),
  }
}

const empty = () => ({
  geocode: mock(async () => []),
  reverseGeocode: mock(async () => []),
})

const failing = (message: string) => ({
  geocode: mock(async () => {
    throw new Error(message)
  }),
  reverseGeocode: mock(async () => {
    throw new Error(message)
  }),
})

beforeEach(() => {
  configuredIntegrations = []
  instances.clear()
})

describe('provider priority', () => {
  test('uses the first provider the manager returns', async () => {
    provider('barrelman', answering('from barrelman'))
    provider('nominatim', answering('from nominatim'))

    const { results, integrationId } = await reverseGeocode(35.2, -80.8)

    expect(integrationId).toBe('barrelman')
    expect(results[0].name).toBe('from barrelman')
  })

  test('does not call lower-priority providers once one answers', async () => {
    const nominatim = answering('from nominatim')
    provider('barrelman', answering('from barrelman'))
    provider('nominatim', nominatim)

    await forwardGeocode('coffee')

    expect(nominatim.geocode).not.toHaveBeenCalled()
  })
})

describe('fallback', () => {
  test('falls through to the next provider when the first has no coverage', async () => {
    provider('barrelman', empty())
    provider('nominatim', answering('from nominatim'))

    const { results, integrationId } = await reverseGeocode(48.85, 2.29)

    expect(integrationId).toBe('nominatim')
    expect(results[0].name).toBe('from nominatim')
  })

  test('falls through to the next provider when the first throws', async () => {
    provider('barrelman', failing('barrelman unreachable'))
    provider('nominatim', answering('from nominatim'))

    const { integrationId } = await forwardGeocode('coffee')

    expect(integrationId).toBe('nominatim')
  })

  test('skips a provider that is configured but has no geocoding capability', async () => {
    configuredIntegrations.push({ integrationId: 'stale' })
    instances.set('stale', { capabilities: {} })
    provider('nominatim', answering('from nominatim'))

    const { integrationId } = await reverseGeocode(35.2, -80.8)

    expect(integrationId).toBe('nominatim')
  })
})

describe('exhausted providers', () => {
  test('reports the highest-priority provider when every one comes back empty', async () => {
    provider('barrelman', empty())
    provider('nominatim', empty())

    const { results, integrationId } = await reverseGeocode(0, 0)

    expect(results).toEqual([])
    expect(integrationId).toBe('barrelman')
  })

  test('signals "none configured" with a null integrationId', async () => {
    const { results, integrationId } = await forwardGeocode('coffee')

    expect(results).toEqual([])
    expect(integrationId).toBeNull()
  })

  test('rethrows when every provider fails, so an outage is not read as no results', async () => {
    provider('barrelman', failing('barrelman unreachable'))
    provider('nominatim', failing('nominatim rate limited'))

    await expect(reverseGeocode(35.2, -80.8)).rejects.toThrow('nominatim rate limited')
  })

  test('an empty provider after a failing one is not treated as a total outage', async () => {
    provider('barrelman', failing('barrelman unreachable'))
    provider('nominatim', empty())

    const { results } = await forwardGeocode('coffee')

    expect(results).toEqual([])
  })
})

describe('argument passing', () => {
  test('forwards the query and location bias to the provider', async () => {
    const barrelman = answering('hit')
    provider('barrelman', barrelman)

    await forwardGeocode('9201 University City Blvd', 35.3, -80.73)

    expect(barrelman.geocode).toHaveBeenCalledWith('9201 University City Blvd', 35.3, -80.73)
  })

  test('forwards the coordinate to the provider', async () => {
    const barrelman = answering('hit')
    provider('barrelman', barrelman)

    await reverseGeocode(35.2271, -80.8431)

    expect(barrelman.reverseGeocode).toHaveBeenCalledWith(35.2271, -80.8431)
  })
})
