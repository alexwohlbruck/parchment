/**
 * Unit tests for the integration manager's in-memory cache.
 *
 * This is the lookup layer every capability call goes through, and its rules
 * are all about scoping and precedence:
 *
 *   - a user-scope row shadows a system row with the same id, but a lookup
 *     with no userId must NEVER fall back to a user's row;
 *   - capability lookups only return capabilities that are *active*, sorted by
 *     the configured priority so the highest-quality provider wins;
 *   - each cached entry gets its own integration instance, so initializing one
 *     user's Dawarich config can't leak into another user's.
 *
 * Records handed back must also never carry the live instance — that object
 * holds initialized credentials and is not safe to serialize.
 */

import { describe, test, expect, mock, beforeEach } from 'bun:test'
import { IntegrationId } from '../../types/integration.enums'

/** Integrations the registry knows about, keyed by id. */
let registered: Record<string, any> = {}

class FakeRegistry {
  getIntegration(id: string) {
    return registered[id]
  }
}

mock.module('./integration-registry', () => ({
  IntegrationRegistry: FakeRegistry,
}))

const initializeWithTest = mock(
  async (_instance: any, _config: unknown) => undefined,
)
mock.module('../../lib/integration.utils', () => ({ initializeWithTest }))

mock.module('../../lib/logger', () => ({
  logger: { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} },
  logWarn: () => {},
  logError: () => {},
}))

const { IntegrationManagerService } = await import('./integration-manager.service')

/** Build a registry entry whose instances remember their construction. */
function fakeIntegration(over: Partial<any> = {}) {
  class Fake {
    sources = over.sources ?? ['osm']
    capabilityIds = over.capabilityIds ?? ['search']
    capabilities = over.capabilities ?? { search: {} }
    config: unknown = null
    testConnection = mock(async (_config: unknown) => ({ success: true }))
  }
  return new Fake()
}

/** A DB-shaped integration record. */
function record(over: Partial<any> = {}) {
  return {
    id: 'rec-1',
    integrationId: IntegrationId.BARRELMAN,
    userId: null,
    config: { host: 'https://barrelman.test' },
    capabilities: [{ id: 'search', active: true }],
    ...over,
  }
}

let manager: InstanceType<typeof IntegrationManagerService>

beforeEach(() => {
  registered = {
    [IntegrationId.BARRELMAN]: fakeIntegration(),
    [IntegrationId.NOMINATIM]: fakeIntegration(),
    [IntegrationId.DAWARICH]: fakeIntegration({ sources: [] }),
  }
  initializeWithTest.mockClear()
  manager = new IntegrationManagerService()
})

describe('testIntegration', () => {
  test('delegates to the integration’s connection check', async () => {
    const result = await manager.testIntegration(
      IntegrationId.BARRELMAN as any,
      { host: 'x' } as any,
    )

    expect(result).toEqual({ success: true })
    expect(registered[IntegrationId.BARRELMAN].testConnection).toHaveBeenCalled()
  })

  test('reports failure for an unregistered integration', async () => {
    const result = await manager.testIntegration('made-up' as any, {} as any)

    expect(result.success).toBe(false)
    expect(result.message).toContain('not found')
  })
})

describe('initializeIntegration', () => {
  test('caches a system integration', async () => {
    await manager.initializeIntegration(undefined, record() as any)

    expect(manager.getConfiguredIntegrations()).toHaveLength(1)
  })

  test('caches a user integration under that user', async () => {
    await manager.initializeIntegration(
      'user-1',
      record({ userId: 'user-1' }) as any,
    )

    expect(manager.getConfiguredIntegrations('user-1')).toHaveLength(1)
    expect(manager.getConfiguredIntegrations()).toHaveLength(0)
  })

  test('ignores an integration the registry does not know', async () => {
    await manager.initializeIntegration(
      undefined,
      record({ integrationId: 'made-up' }) as any,
    )

    expect(manager.getConfiguredIntegrations()).toHaveLength(0)
  })

  test('initializes with the record’s config', async () => {
    const rec = record()

    await manager.initializeIntegration(undefined, rec as any)

    expect(initializeWithTest.mock.calls[0][1]).toEqual(rec.config)
  })

  test('gives each cached entry its own instance', async () => {
    // Two users configuring the same integration must not share credentials.
    await manager.initializeIntegration(
      'user-1',
      record({ id: 'rec-a', userId: 'user-1' }) as any,
    )
    await manager.initializeIntegration(
      'user-2',
      record({ id: 'rec-b', userId: 'user-2' }) as any,
    )

    const first = manager.getCachedIntegrationInstance(
      record({ id: 'rec-a', userId: 'user-1' }) as any,
    )
    const second = manager.getCachedIntegrationInstance(
      record({ id: 'rec-b', userId: 'user-2' }) as any,
    )

    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(first).not.toBe(second)
  })

  test('the cached instance is not the registry’s own object', async () => {
    await manager.initializeIntegration(undefined, record() as any)

    const instance = manager.getCachedIntegrationInstance(record() as any)

    expect(instance).not.toBe(registered[IntegrationId.BARRELMAN])
  })

  test('re-initializing the same record does not duplicate it', async () => {
    await manager.initializeIntegration(undefined, record() as any)
    await manager.initializeIntegration(undefined, record() as any)

    expect(manager.getConfiguredIntegrations()).toHaveLength(1)
  })
})

describe('getIntegration — scoping', () => {
  test('returns a user’s own integration', async () => {
    await manager.initializeIntegration(
      'user-1',
      record({ userId: 'user-1' }) as any,
    )

    expect(manager.getIntegration('user-1', 'rec-1')).toBeDefined()
  })

  test('falls back to a system integration for a user lookup', async () => {
    await manager.initializeIntegration(undefined, record() as any)

    expect(manager.getIntegration('user-1', 'rec-1')).toBeDefined()
  })

  test('a system lookup never returns a user’s row', async () => {
    await manager.initializeIntegration(
      'user-1',
      record({ userId: 'user-1' }) as any,
    )

    expect(manager.getIntegration(undefined, 'rec-1')).toBeUndefined()
  })

  test('one user cannot read another user’s integration', async () => {
    await manager.initializeIntegration(
      'user-1',
      record({ userId: 'user-1' }) as any,
    )

    expect(manager.getIntegration('user-2', 'rec-1')).toBeUndefined()
  })

  test('returns undefined for an unknown id', async () => {
    expect(manager.getIntegration('user-1', 'nope')).toBeUndefined()
  })

  test('strips the live instance from the returned record', async () => {
    await manager.initializeIntegration(undefined, record() as any)

    const returned = manager.getIntegration(undefined, 'rec-1') as any

    // The instance holds initialized credentials and must not be serialized.
    expect('integration' in returned).toBe(false)
    expect(returned.integrationId).toBe(IntegrationId.BARRELMAN)
  })
})

describe('getConfiguredIntegrations', () => {
  test('returns only system rows with no user id', async () => {
    await manager.initializeIntegration(undefined, record({ id: 'sys' }) as any)
    await manager.initializeIntegration(
      'user-1',
      record({ id: 'usr', userId: 'user-1' }) as any,
    )

    const rows = manager.getConfiguredIntegrations()

    expect(rows.map((r) => r.id)).toEqual(['sys'])
  })

  test('returns the user’s rows plus system rows', async () => {
    await manager.initializeIntegration(undefined, record({ id: 'sys' }) as any)
    await manager.initializeIntegration(
      'user-1',
      record({ id: 'usr', userId: 'user-1' }) as any,
    )

    const ids = manager.getConfiguredIntegrations('user-1').map((r) => r.id)

    expect(ids).toContain('sys')
    expect(ids).toContain('usr')
  })

  test('excludes other users’ rows', async () => {
    await manager.initializeIntegration(
      'user-2',
      record({ id: 'other', userId: 'user-2' }) as any,
    )

    expect(manager.getConfiguredIntegrations('user-1')).toHaveLength(0)
  })

  test('is empty for a user with nothing configured', () => {
    expect(manager.getConfiguredIntegrations('nobody')).toEqual([])
  })
})

describe('getConfiguredIntegrationsByCapability', () => {
  test('returns integrations exposing an active capability', async () => {
    await manager.initializeIntegration(undefined, record() as any)

    expect(
      manager.getConfiguredIntegrationsByCapability('search' as any),
    ).toHaveLength(1)
  })

  test('skips a capability that is present but inactive', async () => {
    await manager.initializeIntegration(
      undefined,
      record({ capabilities: [{ id: 'search', active: false }] }) as any,
    )

    expect(
      manager.getConfiguredIntegrationsByCapability('search' as any),
    ).toHaveLength(0)
  })

  test('skips integrations without the capability at all', async () => {
    await manager.initializeIntegration(undefined, record() as any)

    expect(
      manager.getConfiguredIntegrationsByCapability('routing' as any),
    ).toHaveLength(0)
  })

  test('sorts by configured priority, highest first', async () => {
    // Barrelman (105) outranks Nominatim (90).
    await manager.initializeIntegration(
      undefined,
      record({ id: 'nom', integrationId: IntegrationId.NOMINATIM }) as any,
    )
    await manager.initializeIntegration(
      undefined,
      record({ id: 'barrel', integrationId: IntegrationId.BARRELMAN }) as any,
    )

    const ids = manager
      .getConfiguredIntegrationsByCapability('search' as any)
      .map((r) => r.integrationId)

    expect(ids).toEqual([IntegrationId.BARRELMAN, IntegrationId.NOMINATIM])
  })

  test('spans both user and system scopes', async () => {
    await manager.initializeIntegration(undefined, record({ id: 'sys' }) as any)
    await manager.initializeIntegration(
      'user-1',
      record({ id: 'usr', userId: 'user-1' }) as any,
    )

    expect(
      manager.getConfiguredIntegrationsByCapability('search' as any),
    ).toHaveLength(2)
  })
})

describe('getConfiguredIntegrationForSource', () => {
  test('returns the highest-priority integration serving the source', async () => {
    await manager.initializeIntegration(
      undefined,
      record({ id: 'nom', integrationId: IntegrationId.NOMINATIM }) as any,
    )
    await manager.initializeIntegration(
      undefined,
      record({ id: 'barrel', integrationId: IntegrationId.BARRELMAN }) as any,
    )

    const chosen = manager.getConfiguredIntegrationForSource(
      'osm' as any,
      'search' as any,
    )

    expect(chosen!.integrationId).toBe(IntegrationId.BARRELMAN)
  })

  test('ignores integrations that do not serve the source', async () => {
    await manager.initializeIntegration(
      undefined,
      record({ id: 'daw', integrationId: IntegrationId.DAWARICH }) as any,
    )

    expect(
      manager.getConfiguredIntegrationForSource('osm' as any, 'search' as any),
    ).toBeUndefined()
  })

  test('returns undefined when nothing matches the capability', async () => {
    await manager.initializeIntegration(undefined, record() as any)

    expect(
      manager.getConfiguredIntegrationForSource('osm' as any, 'routing' as any),
    ).toBeUndefined()
  })
})

describe('cache eviction', () => {
  test('removeIntegration drops a system row', async () => {
    await manager.initializeIntegration(undefined, record() as any)

    manager.removeIntegration(undefined, 'rec-1')

    expect(manager.getConfiguredIntegrations()).toHaveLength(0)
  })

  test('removeIntegration drops a user row without touching system rows', async () => {
    await manager.initializeIntegration(undefined, record({ id: 'sys' }) as any)
    await manager.initializeIntegration(
      'user-1',
      record({ id: 'usr', userId: 'user-1' }) as any,
    )

    manager.removeIntegration('user-1', 'usr')

    expect(manager.getConfiguredIntegrations('user-1').map((r) => r.id)).toEqual([
      'sys',
    ])
  })

  test('clearUserIntegrations empties one user only', async () => {
    await manager.initializeIntegration(
      'user-1',
      record({ id: 'a', userId: 'user-1' }) as any,
    )
    await manager.initializeIntegration(
      'user-2',
      record({ id: 'b', userId: 'user-2' }) as any,
    )

    manager.clearUserIntegrations('user-1')

    expect(manager.getConfiguredIntegrations('user-1')).toHaveLength(0)
    expect(manager.getConfiguredIntegrations('user-2')).toHaveLength(1)
  })

  test('clearUserIntegrations with no user clears system rows', async () => {
    await manager.initializeIntegration(undefined, record() as any)

    manager.clearUserIntegrations()

    expect(manager.getConfiguredIntegrations()).toHaveLength(0)
  })
})

describe('capability and instance lookup', () => {
  test('getIntegrationCapabilities reads the registry', () => {
    expect(
      manager.getIntegrationCapabilities(IntegrationId.BARRELMAN as any),
    ).toEqual(['search'])
  })

  test('getIntegrationCapabilities is empty for an unknown integration', () => {
    expect(manager.getIntegrationCapabilities('made-up' as any)).toEqual([])
  })

  test('getCachedIntegrationInstance returns the live instance', async () => {
    await manager.initializeIntegration(undefined, record() as any)

    expect(
      manager.getCachedIntegrationInstance(record() as any),
    ).toBeDefined()
  })

  test('getCachedIntegrationInstance is undefined for an uncached record', () => {
    expect(
      manager.getCachedIntegrationInstance(record({ id: 'nope' }) as any),
    ).toBeUndefined()
  })

  test('getIntegrationRegistry exposes the registry', () => {
    expect(manager.getIntegrationRegistry()).toBeInstanceOf(FakeRegistry)
  })
})
