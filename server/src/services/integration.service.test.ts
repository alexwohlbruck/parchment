import { describe, test, expect } from 'bun:test'

// Import the function directly — it's a pure function with no DB dependencies
import {
  extractPublicConfig,
  parseIntegrationData,
  integrationConfigBlobType,
  INTEGRATION_CONFIG_BLOB_PREFIX,
  IntegrationSchemeConflictError,
} from './integration.service'
import { IntegrationScope } from '../types/integration.types'
import type { IntegrationDefinition } from '../types/integration.types'
import type { IntegrationRow } from '../schema/integrations.schema'
import { IntegrationId } from '../types/integration.enums'

function makeDefinition(
  overrides: Partial<IntegrationDefinition> = {},
): IntegrationDefinition {
  return {
    id: 'test' as any,
    name: 'Test',
    description: 'Test integration',
    color: '#000',
    capabilities: [],
    paid: false,
    cloud: true,
    configSchema: 'testSchema',
    scope: [IntegrationScope.SYSTEM],
    ...overrides,
  }
}

describe('extractPublicConfig', () => {
  test('returns empty object when definition is undefined', () => {
    const result = extractPublicConfig({ secret: 'abc', host: 'localhost' }, undefined)
    expect(result).toEqual({})
  })

  test('returns empty object when definition has no publicFields or resolvePublicConfig', () => {
    const def = makeDefinition()
    const result = extractPublicConfig(
      { apiKey: 'secret123', host: 'https://example.com' },
      def,
    )
    expect(result).toEqual({})
  })

  test('returns empty object when publicFields is an empty array', () => {
    const def = makeDefinition({ publicFields: [] })
    const result = extractPublicConfig(
      { apiKey: 'secret123', host: 'https://example.com' },
      def,
    )
    expect(result).toEqual({})
  })

  test('returns only fields listed in publicFields', () => {
    const def = makeDefinition({ publicFields: ['host'] })
    const result = extractPublicConfig(
      { apiKey: 'secret123', host: 'https://example.com', extra: 'data' },
      def,
    )
    expect(result).toEqual({ host: 'https://example.com' })
  })

  test('does not include publicFields that are missing from config', () => {
    const def = makeDefinition({ publicFields: ['host', 'missingField'] })
    const result = extractPublicConfig({ host: 'https://example.com' }, def)
    expect(result).toEqual({ host: 'https://example.com' })
  })

  test('never leaks fields not in publicFields', () => {
    const def = makeDefinition({ publicFields: ['accessToken'] })
    const config = {
      accessToken: 'pk.abc123',
      clientSecret: 'supersecret',
      apiKey: 'key123',
      password: 'hunter2',
    }
    const result = extractPublicConfig(config, def)
    expect(result).toEqual({ accessToken: 'pk.abc123' })
    expect(result).not.toHaveProperty('clientSecret')
    expect(result).not.toHaveProperty('apiKey')
    expect(result).not.toHaveProperty('password')
  })

  test('supports multiple publicFields', () => {
    const def = makeDefinition({ publicFields: ['accessToken', 'host'] })
    const config = {
      accessToken: 'pk.abc123',
      host: 'https://example.com',
      clientSecret: 'supersecret',
    }
    const result = extractPublicConfig(config, def)
    expect(result).toEqual({
      accessToken: 'pk.abc123',
      host: 'https://example.com',
    })
  })

  test('resolvePublicConfig takes precedence over publicFields', () => {
    const def = makeDefinition({
      publicFields: ['raw'],
      resolvePublicConfig: (config) => ({
        derivedUrl: `https://${config.host}/api`,
      }),
    })
    const result = extractPublicConfig(
      { host: 'example.com', raw: 'value', secret: 'hidden' },
      def,
    )
    expect(result).toEqual({ derivedUrl: 'https://example.com/api' })
    expect(result).not.toHaveProperty('raw')
    expect(result).not.toHaveProperty('secret')
  })

  test('resolvePublicConfig can return empty object', () => {
    const def = makeDefinition({
      resolvePublicConfig: () => ({}),
    })
    const result = extractPublicConfig({ secret: 'abc' }, def)
    expect(result).toEqual({})
  })

  test('handles empty config object', () => {
    const def = makeDefinition({ publicFields: ['accessToken'] })
    const result = extractPublicConfig({}, def)
    expect(result).toEqual({})
  })

  // OSM system integration specific test
  test('OSM resolvePublicConfig resolves production server URL', () => {
    const resolvePublicConfig = (config: Record<string, any>) => {
      const server = config.server || 'production'
      const OSM_SERVERS: Record<string, string> = {
        production: 'https://www.openstreetmap.org',
        sandbox: 'https://master.apis.dev.openstreetmap.org',
      }
      let serverUrl: string
      if (server === 'custom' && config.customServerUrl) {
        serverUrl = config.customServerUrl.replace(/\/+$/, '')
      } else {
        serverUrl = OSM_SERVERS[server] || OSM_SERVERS.production
      }
      return { serverUrl }
    }

    expect(
      resolvePublicConfig({ server: 'production', clientId: 'id', clientSecret: 'secret' }),
    ).toEqual({ serverUrl: 'https://www.openstreetmap.org' })

    expect(
      resolvePublicConfig({ server: 'sandbox', clientId: 'id', clientSecret: 'secret' }),
    ).toEqual({ serverUrl: 'https://master.apis.dev.openstreetmap.org' })

    expect(
      resolvePublicConfig({
        server: 'custom',
        customServerUrl: 'https://osm.local/',
        clientId: 'id',
      }),
    ).toEqual({ serverUrl: 'https://osm.local' })

    // Falls back to production for unknown server values
    expect(
      resolvePublicConfig({ server: 'unknown' }),
    ).toEqual({ serverUrl: 'https://www.openstreetmap.org' })

    // Falls back to production when server is missing
    expect(
      resolvePublicConfig({}),
    ).toEqual({ serverUrl: 'https://www.openstreetmap.org' })

    // Never leaks secrets
    const result = resolvePublicConfig({
      server: 'sandbox',
      clientId: 'my-client-id',
      clientSecret: 'my-secret',
      redirectUri: 'https://example.com/callback',
    })
    expect(result).toEqual({ serverUrl: 'https://master.apis.dev.openstreetmap.org' })
    expect(result).not.toHaveProperty('clientId')
    expect(result).not.toHaveProperty('clientSecret')
    expect(result).not.toHaveProperty('redirectUri')
  })
})

describe('integration scheme helpers', () => {
  test('integrationConfigBlobType composes the namespaced blob type', () => {
    expect(integrationConfigBlobType('dawarich')).toBe(
      'integration-config:dawarich',
    )
    expect(integrationConfigBlobType('mapbox')).toBe(
      'integration-config:mapbox',
    )
    expect(integrationConfigBlobType('dawarich').startsWith(
      INTEGRATION_CONFIG_BLOB_PREFIX,
    )).toBe(true)
  })

  test('IntegrationSchemeConflictError carries integrationId and scheme', () => {
    const err = new IntegrationSchemeConflictError('dawarich', 'user-e2ee')
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('IntegrationSchemeConflictError')
    expect(err.integrationId).toBe('dawarich')
    expect(err.scheme).toBe('user-e2ee')
    expect(err.message).toContain('dawarich')
    expect(err.message).toContain('user-e2ee')
  })
})

describe('parseIntegrationData scheme branching', () => {
  function makeRow(overrides: Partial<IntegrationRow> = {}): IntegrationRow {
    return {
      id: 'row-1',
      userId: 'user-1',
      integrationId: IntegrationId.DAWARICH,
      scheme: 'user-e2ee',
      configCiphertext: null,
      configNonce: null,
      configKeyVersion: 1,
      capabilities: JSON.stringify([]) as any,
      createdAt: new Date('2026-04-23T00:00:00Z'),
      updatedAt: new Date('2026-04-23T00:00:00Z'),
      ...overrides,
    }
  }

  test('user-e2ee rows return empty config without attempting decrypt', () => {
    // If this function tried to decrypt null ciphertext, it would throw and
    // the record would be returned as null. Asserting a non-null record with
    // config={} proves the scheme branch skipped decrypt entirely.
    const row = makeRow({
      configCiphertext: null,
      configNonce: null,
    })
    const record = parseIntegrationData(row)
    expect(record).not.toBeNull()
    expect(record!.scheme).toBe('user-e2ee')
    expect(record!.config).toEqual({})
    expect(record!.integrationId).toBe(IntegrationId.DAWARICH)
  })

  test('user-e2ee rows preserve metadata fields from the row', () => {
    const row = makeRow({
      id: 'custom-id',
      userId: 'user-42',
      capabilities: JSON.stringify([
        { id: 'search' as any, active: true },
      ]) as any,
    })
    const record = parseIntegrationData(row)
    expect(record).not.toBeNull()
    expect(record!.id).toBe('custom-id')
    expect(record!.userId).toBe('user-42')
    expect(record!.capabilities).toEqual([
      { id: 'search' as any, active: true },
    ])
  })

  test('malformed capabilities JSON on user-e2ee rows degrades to empty list', () => {
    const row = makeRow({ capabilities: 'not-json' as any })
    const record = parseIntegrationData(row)
    expect(record).not.toBeNull()
    expect(record!.capabilities).toEqual([])
  })
})
