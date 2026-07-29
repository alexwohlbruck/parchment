/**
 * Unit tests for the rideshare service.
 *
 * Unlike most capability lookups this one queries EVERY configured provider
 * rather than the highest-priority one — users compare Uber against Lyft side
 * by side — so the tests pin that fan-out, and that one provider failing must
 * not lose the others' quotes (`Promise.allSettled`, not `all`).
 *
 * The cache key rounds coordinates to ~11m, which is what lets a user nudge a
 * waypoint without re-billing an upstream API call.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'

let configuredIntegrations: any[] = []
let throwOnLookup = false

const getConfiguredIntegrationsByCapability = mock((_capability: string) => {
  if (throwOnLookup) throw new Error('registry not ready')
  return configuredIntegrations
})

/** Per-record estimate function, keyed by the record's id. */
const estimators: Record<string, ReturnType<typeof mock>> = {}

const getCachedIntegrationInstance = mock((record: any) => {
  if (record.noInstance) return null
  if (record.noCapability) return { capabilities: {} }
  return {
    capabilities: {
      rideshareEstimate: { getRideshareEstimates: estimators[record.id] },
    },
  }
})

mock.module('./integrations', () => ({
  integrationManager: {
    getConfiguredIntegrationsByCapability,
    getCachedIntegrationInstance,
  },
}))

const { RideshareService } = await import('./rideshare.service')

const request = {
  origin: { lat: 35.22713, lng: -80.84312 },
  destination: { lat: 35.31234, lng: -80.91234 },
}

/** Register a provider record plus its estimator mock. */
function provider(id: string, response: unknown, extra: object = {}) {
  estimators[id] = mock(async (_req: unknown) => response)
  return { id, integrationId: id, ...extra }
}

let service: InstanceType<typeof RideshareService>

beforeEach(() => {
  configuredIntegrations = []
  throwOnLookup = false
  for (const key of Object.keys(estimators)) delete estimators[key]
  getConfiguredIntegrationsByCapability.mockClear()
  getCachedIntegrationInstance.mockClear()
  // A fresh instance per test — the cache is instance state.
  service = new RideshareService()
})

describe('getEstimates', () => {
  test('returns an empty list when no provider is configured', async () => {
    const estimates = await service.getEstimates(request as any)

    expect(estimates).toEqual([])
  })

  test('queries every configured provider, not just the first', async () => {
    configuredIntegrations = [
      provider('uber', { provider: 'uber', price: 12 }),
      provider('lyft', { provider: 'lyft', price: 14 }),
    ]

    const estimates = await service.getEstimates(request as any)

    expect(estimates).toHaveLength(2)
    expect(estimators.uber).toHaveBeenCalled()
    expect(estimators.lyft).toHaveBeenCalled()
  })

  test('passes the request through to each provider', async () => {
    configuredIntegrations = [provider('uber', { provider: 'uber' })]

    await service.getEstimates(request as any)

    expect(estimators.uber.mock.calls[0][0]).toEqual(request)
  })

  test('one provider failing does not lose the others', async () => {
    configuredIntegrations = [
      provider('uber', { provider: 'uber', price: 12 }),
      provider('lyft', { provider: 'lyft', price: 14 }),
    ]
    estimators.uber.mockRejectedValueOnce(new Error('uber 503'))

    const estimates = await service.getEstimates(request as any)

    expect(estimates).toHaveLength(1)
    expect((estimates[0] as any).provider).toBe('lyft')
  })

  test('skips a record with no cached instance', async () => {
    configuredIntegrations = [
      provider('uber', { provider: 'uber' }, { noInstance: true }),
      provider('lyft', { provider: 'lyft' }),
    ]

    const estimates = await service.getEstimates(request as any)

    expect(estimates).toHaveLength(1)
  })

  test('skips an instance without the rideshare capability', async () => {
    configuredIntegrations = [
      provider('uber', { provider: 'uber' }, { noCapability: true }),
    ]

    const estimates = await service.getEstimates(request as any)

    expect(estimates).toEqual([])
  })

  test('drops a provider that resolves to nothing', async () => {
    configuredIntegrations = [provider('uber', null)]

    const estimates = await service.getEstimates(request as any)

    expect(estimates).toEqual([])
  })
})

describe('caching', () => {
  test('a repeat request within the TTL does not re-query providers', async () => {
    configuredIntegrations = [provider('uber', { provider: 'uber', price: 12 })]

    await service.getEstimates(request as any)
    const second = await service.getEstimates(request as any)

    expect(estimators.uber).toHaveBeenCalledTimes(1)
    expect(second).toHaveLength(1)
  })

  test('coordinates within ~11m share a cache entry', async () => {
    configuredIntegrations = [provider('uber', { provider: 'uber', price: 12 })]

    await service.getEstimates(request as any)
    // 5th decimal place only — below the 4-decimal rounding.
    await service.getEstimates({
      origin: { lat: 35.227131, lng: -80.843121 },
      destination: { lat: 35.312341, lng: -80.912341 },
    } as any)

    expect(estimators.uber).toHaveBeenCalledTimes(1)
  })

  test('a meaningfully different route is a separate cache entry', async () => {
    configuredIntegrations = [provider('uber', { provider: 'uber', price: 12 })]

    await service.getEstimates(request as any)
    await service.getEstimates({
      origin: request.origin,
      destination: { lat: 36.5, lng: -81.5 },
    } as any)

    expect(estimators.uber).toHaveBeenCalledTimes(2)
  })

  test('an empty result is not cached, so the next call retries', async () => {
    configuredIntegrations = [provider('uber', null)]

    await service.getEstimates(request as any)
    await service.getEstimates(request as any)

    expect(estimators.uber).toHaveBeenCalledTimes(2)
  })

  test('the cache expires after the TTL', async () => {
    configuredIntegrations = [provider('uber', { provider: 'uber', price: 12 })]
    const realNow = Date.now

    await service.getEstimates(request as any)
    try {
      Date.now = () => realNow() + 5 * 60 * 1000
      await service.getEstimates(request as any)
    } finally {
      Date.now = realNow
    }

    expect(estimators.uber).toHaveBeenCalledTimes(2)
  })

  test('caching is per service instance', async () => {
    configuredIntegrations = [provider('uber', { provider: 'uber', price: 12 })]

    await service.getEstimates(request as any)
    await new RideshareService().getEstimates(request as any)

    expect(estimators.uber).toHaveBeenCalledTimes(2)
  })
})

describe('isRideshareAvailable', () => {
  test('is false with no providers configured', () => {
    configuredIntegrations = []

    expect(service.isRideshareAvailable()).toBe(false)
  })

  test('is true once a provider is configured', () => {
    configuredIntegrations = [provider('uber', {})]

    expect(service.isRideshareAvailable()).toBe(true)
  })

  test('reports false rather than throwing when the registry errors', () => {
    // Called during trip planning; a registry hiccup must not fail the trip.
    throwOnLookup = true

    expect(service.isRideshareAvailable()).toBe(false)
  })
})
