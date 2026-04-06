import { describe, test, expect } from 'bun:test'

// Import the function directly — it's a pure function with no DB dependencies
import { extractPublicConfig } from './integration.service'
import { IntegrationScope } from '../types/integration.types'
import type { IntegrationDefinition } from '../types/integration.types'

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
