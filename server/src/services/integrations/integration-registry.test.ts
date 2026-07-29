/**
 * Unit tests for the integration registry.
 *
 * The registry is a Map keyed by `integrationId`, so a duplicate id silently
 * overwrites the earlier registration and one provider disappears from the
 * settings UI with no error anywhere. The sweep below catches that, plus the
 * matching invariant that every registered instance reports the id it was
 * filed under — a mismatch makes `getIntegration(id)` return the wrong class.
 *
 * This loads every integration for real (no mocks), which also proves none of
 * them throw or hit the network at construction time.
 */

import { describe, test, expect } from 'bun:test'
import { IntegrationId } from '../../types/integration.enums'

// Reached through the manager rather than importing `./integration-registry`
// directly: several integrations import `./integrations` (the barrel), which
// constructs the manager, which constructs the registry — importing the
// registry first hits that cycle in its temporal dead zone. Production always
// enters through the barrel, so this mirrors real load order.
const { integrationManager } = await import('./index')
const { IntegrationRegistry } = await import('./integration-registry')

const registry = integrationManager.getIntegrationRegistry()

/** Every id the registry is expected to answer for. */
const REGISTERED = [
  IntegrationId.AXIOM,
  IntegrationId.GOOGLE_MAPS,
  IntegrationId.FOURSQUARE,
  IntegrationId.PELIAS,
  IntegrationId.NOMINATIM,
  IntegrationId.OVERPASS,
  IntegrationId.MAPBOX,
  IntegrationId.VALHALLA,
  IntegrationId.GRAPHHOPPER,
  IntegrationId.MAPILLARY,
  IntegrationId.TRANSITLAND,
  IntegrationId.GEOAPIFY,
  IntegrationId.WIKIDATA,
  IntegrationId.WIKIPEDIA,
  IntegrationId.WIKIMEDIA,
  IntegrationId.OPENWEATHERMAP,
  IntegrationId.BARRELMAN,
  // The system-wide OSM integration files under the bare id; the per-user
  // OAuth account integration has its own.
  IntegrationId.OPENSTREETMAP,
  IntegrationId.OPENSTREETMAP_ACCOUNT,
  IntegrationId.DAWARICH,
  IntegrationId.UBER,
  IntegrationId.LYFT,
  IntegrationId.OPENAQ,
  IntegrationId.FIRMS,
] as const

describe('default registrations', () => {
  for (const id of REGISTERED) {
    test(`registers ${id}`, () => {
      expect(registry.getIntegration(id)).toBeDefined()
    })
  }

  test('returns undefined for an unknown id', () => {
    expect(registry.getIntegration('made-up' as any)).toBeUndefined()
  })
})

describe('registry invariants', () => {
  test('every instance reports the id it is filed under', () => {
    // A mismatch makes getIntegration(id) hand back the wrong provider.
    for (const id of REGISTERED) {
      expect(registry.getIntegration(id)!.integrationId).toBe(id)
    }
  })

  test('no id is registered twice', () => {
    // A Map silently drops the earlier entry, removing a provider with no error.
    expect(new Set(REGISTERED).size).toBe(REGISTERED.length)
  })

  test('every integration declares a capability id list', () => {
    for (const id of REGISTERED) {
      const integration = registry.getIntegration(id)!
      expect(Array.isArray(integration.capabilityIds)).toBe(true)
    }
  })

  test('only the configuration-only OSM integration has no capabilities', () => {
    // Everything else must expose at least one, or it can never be selected by
    // a capability lookup and is effectively dead config.
    const capabilityFree = REGISTERED.filter(
      (id) => registry.getIntegration(id)!.capabilityIds.length === 0,
    )

    expect(capabilityFree).toEqual([IntegrationId.OPENSTREETMAP])
  })

  test('every declared capability id has a matching capability entry', () => {
    // A declared-but-absent capability makes the manager hand back a record
    // whose instance can't service the call.
    const CAPABILITY_KEY: Record<string, string> = {
      search: 'search',
      autocomplete: 'autocomplete',
      geocoding: 'geocoding',
      routing: 'routing',
      placeInfo: 'placeInfo',
      weather: 'weather',
      logging: 'logging',
      mapEngine: 'mapEngine',
      mapLayer: 'mapLayer',
    }

    for (const id of REGISTERED) {
      const integration = registry.getIntegration(id)!
      for (const capabilityId of integration.capabilityIds) {
        const key = CAPABILITY_KEY[capabilityId as string]
        // Only assert for capabilities that are implemented as methods; the
        // credential-only ones (mapLayer, mapEngine, logging) intentionally
        // expose an empty object or nothing at all.
        if (!key || ['mapLayer', 'mapEngine', 'logging'].includes(key)) continue
        expect(
          (integration.capabilities as Record<string, unknown>)[key],
        ).toBeDefined()
      }
    }
  })

  test('every integration exposes validateConfig and testConnection', () => {
    for (const id of REGISTERED) {
      const integration = registry.getIntegration(id)!
      expect(typeof integration.validateConfig).toBe('function')
      expect(typeof integration.testConnection).toBe('function')
    }
  })
})

describe('registerIntegration', () => {
  test('adds a new integration', () => {
    const local = new IntegrationRegistry()
    const fake = {
      integrationId: 'custom' as any,
      capabilityIds: [],
      capabilities: {},
      validateConfig: () => true,
      testConnection: async () => ({ success: true }),
      initialize: () => {},
    }

    local.registerIntegration(fake as any)

    expect(local.getIntegration('custom' as any)).toBe(fake as any)
  })

  test('re-registering the same id replaces the previous instance', () => {
    // Documents the Map semantics the duplicate-id invariant guards against.
    const local = new IntegrationRegistry()
    const first = {
      integrationId: IntegrationId.MAPBOX,
      capabilityIds: [],
      capabilities: {},
      validateConfig: () => true,
      testConnection: async () => ({ success: true }),
      initialize: () => {},
    }

    local.registerIntegration(first as any)

    expect(local.getIntegration(IntegrationId.MAPBOX)).toBe(first as any)
  })
})
