import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * The browser's view of where Barrelman tiles live.
 *
 * The thing worth guarding is what does NOT come through here: `apiKey` is the
 * account key and stays on the server, so a config that carries one must not
 * produce a URL containing it.
 */
let config: Record<string, unknown> | undefined

vi.mock('@/stores/integrations.store', () => ({
  useIntegrationsStore: () => ({
    getIntegrationConfig: () => config,
    getIntegrationConfigValue: (_id: string, key: string) => config?.[key],
  }),
}))

const { barrelmanTileBase, barrelmanTileKey, withTileKey } = await import(
  './barrelman-tiles'
)

beforeEach(() => {
  config = {
    host: 'https://api.barrelman.dev',
    tileKey: 'public-tile-key',
  }
})

describe('barrelmanTileBase', () => {
  it('serves tiles off the configured host', () => {
    expect(barrelmanTileBase()).toBe('https://api.barrelman.dev/tiles')
  })

  it('prefers tileHost, for a host only the server can reach', () => {
    config = { host: 'http://barrelman:5001', tileHost: 'https://api.barrelman.dev' }

    expect(barrelmanTileBase()).toBe('https://api.barrelman.dev/tiles')
  })

  it('trims a trailing slash rather than emitting a double one', () => {
    config = { host: 'https://api.barrelman.dev/' }

    expect(barrelmanTileBase()).toBe('https://api.barrelman.dev/tiles')
  })

  it('is null when barrelman is not configured, so callers can skip it', () => {
    config = undefined

    expect(barrelmanTileBase()).toBeNull()
  })
})

describe('withTileKey', () => {
  it('puts the key on the URL — a map library cannot set a header', () => {
    expect(withTileKey('https://api.barrelman.dev/tiles/portolan/index.json')).toBe(
      'https://api.barrelman.dev/tiles/portolan/index.json?api_key=public-tile-key',
    )
  })

  it('joins onto a URL that already has a query', () => {
    expect(withTileKey('https://api.barrelman.dev/tiles/x?v=2')).toBe(
      'https://api.barrelman.dev/tiles/x?v=2&api_key=public-tile-key',
    )
  })

  it('leaves the tile template alone when no key is configured', () => {
    config = { host: 'https://api.barrelman.dev' }

    expect(withTileKey('https://api.barrelman.dev/tiles/x/{z}/{x}/{y}.mvt')).toBe(
      'https://api.barrelman.dev/tiles/x/{z}/{x}/{y}.mvt',
    )
  })

  it('escapes a key that would otherwise break the query', () => {
    config = { host: 'https://api.barrelman.dev', tileKey: 'a&b=c' }

    expect(withTileKey('https://api.barrelman.dev/tiles/x')).toBe(
      'https://api.barrelman.dev/tiles/x?api_key=a%26b%3Dc',
    )
  })

  it('never reaches for the account key', () => {
    config = { host: 'https://api.barrelman.dev', apiKey: 'secret-account-key' }

    expect(barrelmanTileKey()).toBeUndefined()
    expect(withTileKey('https://api.barrelman.dev/tiles/x')).not.toContain(
      'secret-account-key',
    )
  })
})
