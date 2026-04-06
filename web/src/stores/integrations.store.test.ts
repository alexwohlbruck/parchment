/**
 * Unit tests for integrations store
 *
 * Tests cover:
 * - Public config field access (mapbox token, OSM server URL, etc.)
 * - Computed values (mapboxAccessToken, osmProfile, isMapboxEngineActive)
 * - getIntegrationConfig / getIntegrationConfigValue helpers
 * - Behavior with empty/missing config (public fields only)
 */

import { describe, test, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useIntegrationsStore } from './integrations.store'
import { IntegrationId, IntegrationCapabilityId } from '@server/types/integration.types'
import type { IntegrationRecord } from '@server/types/integration.types'

function makeRecord(overrides: Partial<IntegrationRecord> = {}): IntegrationRecord {
  return {
    id: 'rec-1',
    userId: null,
    integrationId: 'test' as IntegrationId,
    config: {},
    capabilities: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as IntegrationRecord
}

describe('useIntegrationsStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  describe('getIntegrationConfig', () => {
    test('returns config for a configured integration', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = [
        makeRecord({
          integrationId: IntegrationId.MAPBOX,
          config: { accessToken: 'pk.test123' },
        }),
      ]

      const config = store.getIntegrationConfig(IntegrationId.MAPBOX)
      expect(config).toEqual({ accessToken: 'pk.test123' })
    })

    test('returns undefined for unconfigured integration', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = []

      const config = store.getIntegrationConfig(IntegrationId.MAPBOX)
      expect(config).toBeUndefined()
    })

    test('returns undefined when configurations is null (not yet loaded)', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = null

      const config = store.getIntegrationConfig(IntegrationId.MAPBOX)
      expect(config).toBeUndefined()
    })
  })

  describe('getIntegrationConfigValue', () => {
    test('returns specific config value', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = [
        makeRecord({
          integrationId: IntegrationId.MAPBOX,
          config: { accessToken: 'pk.test123' },
        }),
      ]

      expect(store.getIntegrationConfigValue(IntegrationId.MAPBOX, 'accessToken'))
        .toBe('pk.test123')
    })

    test('returns undefined for missing key', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = [
        makeRecord({
          integrationId: IntegrationId.MAPBOX,
          config: { accessToken: 'pk.test123' },
        }),
      ]

      expect(store.getIntegrationConfigValue(IntegrationId.MAPBOX, 'nonExistent'))
        .toBeUndefined()
    })
  })

  describe('mapboxAccessToken', () => {
    test('returns token from configured Mapbox integration', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = [
        makeRecord({
          integrationId: IntegrationId.MAPBOX,
          config: { accessToken: 'pk.mapbox_token' },
        }),
      ]

      expect(store.mapboxAccessToken).toBe('pk.mapbox_token')
    })

    test('returns undefined when Mapbox is not configured', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = []

      expect(store.mapboxAccessToken).toBeUndefined()
    })

    test('returns undefined when config has empty object (public fields stripped)', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = [
        makeRecord({
          integrationId: IntegrationId.MAPBOX,
          config: {},
        }),
      ]

      expect(store.mapboxAccessToken).toBeUndefined()
    })
  })

  describe('osmProfile', () => {
    test('returns profile data from OSM account integration', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = [
        makeRecord({
          integrationId: IntegrationId.OPENSTREETMAP_ACCOUNT,
          config: {
            osmDisplayName: 'testuser',
            osmProfileImageUrl: 'https://example.com/avatar.png',
            osmAccountCreated: '2020-01-01',
            osmChangesetCount: 42,
            osmTraceCount: 5,
          },
        }),
      ]

      expect(store.osmProfile).toEqual({
        osmDisplayName: 'testuser',
        osmProfileImageUrl: 'https://example.com/avatar.png',
        osmAccountCreated: '2020-01-01',
        osmChangesetCount: 42,
        osmTraceCount: 5,
      })
    })

    test('returns null when OSM account is not configured', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = []

      expect(store.osmProfile).toBeNull()
    })

    test('handles partial profile data (some fields public, some stripped)', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = [
        makeRecord({
          integrationId: IntegrationId.OPENSTREETMAP_ACCOUNT,
          config: {
            osmDisplayName: 'testuser',
            // Other profile fields might be missing
          },
        }),
      ]

      const profile = store.osmProfile
      expect(profile).not.toBeNull()
      expect(profile!.osmDisplayName).toBe('testuser')
      expect(profile!.osmProfileImageUrl).toBeUndefined()
    })
  })

  describe('isCapabilityActive', () => {
    test('returns true for active capability', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = [
        makeRecord({
          integrationId: IntegrationId.MAPBOX,
          config: { accessToken: 'pk.test' },
          capabilities: [
            { id: IntegrationCapabilityId.MAP_ENGINE, active: true },
          ],
        }),
      ]

      expect(store.isCapabilityActive(IntegrationId.MAPBOX, IntegrationCapabilityId.MAP_ENGINE))
        .toBe(true)
    })

    test('returns false for inactive capability', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = [
        makeRecord({
          integrationId: IntegrationId.MAPBOX,
          config: { accessToken: 'pk.test' },
          capabilities: [
            { id: IntegrationCapabilityId.MAP_ENGINE, active: false },
          ],
        }),
      ]

      expect(store.isCapabilityActive(IntegrationId.MAPBOX, IntegrationCapabilityId.MAP_ENGINE))
        .toBe(false)
    })

    test('returns false for unconfigured integration', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = []

      expect(store.isCapabilityActive(IntegrationId.MAPBOX, IntegrationCapabilityId.MAP_ENGINE))
        .toBe(false)
    })
  })

  describe('integrationsReady', () => {
    test('returns false when neither data source is loaded', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = null
      store.availableIntegrations = null

      expect(store.integrationsReady).toBe(false)
    })

    test('returns false when only configurations loaded', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = []
      store.availableIntegrations = null

      expect(store.integrationsReady).toBe(false)
    })

    test('returns true when both are loaded (even if empty)', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = []
      store.availableIntegrations = []

      expect(store.integrationsReady).toBe(true)
    })
  })

  describe('clearCache', () => {
    test('resets both data sources to null', () => {
      const store = useIntegrationsStore()
      store.integrationConfigurations = [makeRecord()]
      store.availableIntegrations = []

      store.clearCache()

      expect(store.integrationConfigurations).toBeNull()
      expect(store.availableIntegrations).toBeNull()
    })
  })
})
