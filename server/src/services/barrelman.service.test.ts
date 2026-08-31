import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'

/**
 * Where Barrelman lives.
 *
 * Previews clone the whole database, integration config included, so every
 * preview inherits whichever Barrelman the source instance pointed at. The
 * env override is what lets a branch talk to its own Barrelman without
 * editing a record that other instances share — so it has to actually win
 * over the configured host, and has to leave the normal path alone when unset.
 */

let configured:
  | { host?: string; apiKey?: string; tileHost?: string; tileKey?: string }
  | undefined

mock.module('./integrations', () => ({
  integrationManager: {
    getConfiguredIntegrations: () => (
      configured ? [{ integrationId: 'barrelman', config: configured }] : []
    ),
  },
}))

const { resolveBarrelmanConfig, resolveBarrelmanTileConfig } = await import(
  './barrelman.service'
)

const ORIGINAL = {
  host: process.env.BARRELMAN_HOST,
  apiKey: process.env.BARRELMAN_API_KEY,
  tileHost: process.env.BARRELMAN_TILE_HOST,
  tileKey: process.env.BARRELMAN_TILE_KEY,
}

beforeEach(() => {
  configured = { host: 'https://barrelman.example', apiKey: 'configured-key' }
  delete process.env.BARRELMAN_HOST
  delete process.env.BARRELMAN_API_KEY
  delete process.env.BARRELMAN_TILE_HOST
  delete process.env.BARRELMAN_TILE_KEY
})

afterEach(() => {
  if (ORIGINAL.host) process.env.BARRELMAN_HOST = ORIGINAL.host
  else delete process.env.BARRELMAN_HOST
  if (ORIGINAL.apiKey) process.env.BARRELMAN_API_KEY = ORIGINAL.apiKey
  else delete process.env.BARRELMAN_API_KEY
  if (ORIGINAL.tileHost) process.env.BARRELMAN_TILE_HOST = ORIGINAL.tileHost
  else delete process.env.BARRELMAN_TILE_HOST
  if (ORIGINAL.tileKey) process.env.BARRELMAN_TILE_KEY = ORIGINAL.tileKey
  else delete process.env.BARRELMAN_TILE_KEY
})

describe('resolveBarrelmanConfig', () => {
  it('uses the configured integration when no override is set', () => {
    expect(resolveBarrelmanConfig()).toEqual({
      host: 'https://barrelman.example',
      apiKey: 'configured-key',
    })
  })

  it('lets the environment override the configured host', () => {
    process.env.BARRELMAN_HOST = 'http://127.0.0.1:5001'

    expect(resolveBarrelmanConfig()?.host).toBe('http://127.0.0.1:5001')
  })

  it('keeps the configured key, so pointing elsewhere needs one variable', () => {
    process.env.BARRELMAN_HOST = 'http://127.0.0.1:5001'

    expect(resolveBarrelmanConfig()?.apiKey).toBe('configured-key')
  })

  it('takes an override key when the target needs a different one', () => {
    process.env.BARRELMAN_HOST = 'http://127.0.0.1:5001'
    process.env.BARRELMAN_API_KEY = 'local-key'

    expect(resolveBarrelmanConfig()?.apiKey).toBe('local-key')
  })

  it('works with no integration configured at all', () => {
    configured = undefined
    process.env.BARRELMAN_HOST = 'http://127.0.0.1:5001'

    expect(resolveBarrelmanConfig()).toEqual({
      host: 'http://127.0.0.1:5001',
      apiKey: undefined,
    })
  })

  it('reports nothing when neither source names a host', () => {
    configured = undefined

    expect(resolveBarrelmanConfig()?.host).toBeUndefined()
  })
})

/**
 * The service's only job here is to feed the integration config to the
 * resolver; the resolution rules are covered in `lib/barrelman-tiles.test.ts`.
 */
describe('resolveBarrelmanTileConfig', () => {
  it('resolves tiles from the configured integration', () => {
    configured = {
      host: 'https://barrelman.example',
      apiKey: 'configured-key',
      tileKey: 'public-tile-key',
    }

    expect(resolveBarrelmanTileConfig()).toEqual({
      base: 'https://barrelman.example/tiles',
      tileKey: 'public-tile-key',
    })
  })

  it('never carries the account key', () => {
    configured = { host: 'https://barrelman.example', apiKey: 'configured-key' }

    expect(resolveBarrelmanTileConfig()?.tileKey).toBeUndefined()
  })

  it('reports nothing when Barrelman is not configured', () => {
    configured = undefined

    expect(resolveBarrelmanTileConfig()).toBeUndefined()
  })
})
