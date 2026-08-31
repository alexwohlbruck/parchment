import { describe, it, expect, beforeEach, afterEach } from 'bun:test'
import { resolveTileConfig } from './barrelman-tiles'

/**
 * Where the browser is told to fetch tiles.
 *
 * Two things this must never get wrong: it must not hand out an address only
 * the server can reach (the browser then silently draws nothing), and it must
 * not carry the account key — only the public, tiles-scoped one.
 */
const ORIGINAL = {
  host: process.env.BARRELMAN_HOST,
  tileHost: process.env.BARRELMAN_TILE_HOST,
  tileKey: process.env.BARRELMAN_TILE_KEY,
}

beforeEach(() => {
  delete process.env.BARRELMAN_HOST
  delete process.env.BARRELMAN_TILE_HOST
  delete process.env.BARRELMAN_TILE_KEY
})

afterEach(() => {
  for (const [name, value] of [
    ['BARRELMAN_HOST', ORIGINAL.host],
    ['BARRELMAN_TILE_HOST', ORIGINAL.tileHost],
    ['BARRELMAN_TILE_KEY', ORIGINAL.tileKey],
  ] as const) {
    if (value) process.env[name] = value
    else delete process.env[name]
  }
})

describe('resolveTileConfig', () => {
  it('serves tiles off the configured host', () => {
    expect(resolveTileConfig({ host: 'https://api.barrelman.dev', tileKey: 'k' })).toEqual({
      base: 'https://api.barrelman.dev/tiles',
      tileKey: 'k',
    })
  })

  it('prefers tileHost, for a host only the server can reach', () => {
    const resolved = resolveTileConfig({
      host: 'http://barrelman:5001',
      tileHost: 'https://api.barrelman.dev',
    })

    expect(resolved?.base).toBe('https://api.barrelman.dev/tiles')
  })

  it('trims a trailing slash rather than emitting a double one', () => {
    expect(resolveTileConfig({ host: 'https://api.barrelman.dev/' })?.base).toBe(
      'https://api.barrelman.dev/tiles',
    )
  })

  it('follows a BARRELMAN_HOST override, so a preview does not talk to prod', () => {
    process.env.BARRELMAN_HOST = 'https://branch.barrelman.example'

    expect(resolveTileConfig({ host: 'https://api.barrelman.dev' })?.base).toBe(
      'https://branch.barrelman.example/tiles',
    )
  })

  it('lets BARRELMAN_TILE_HOST outrank the host override', () => {
    // The two are reached over different networks: the server may talk to a
    // preview instance the browser has no route to.
    process.env.BARRELMAN_HOST = 'http://barrelman:5001'
    process.env.BARRELMAN_TILE_HOST = 'https://tiles.example'

    expect(resolveTileConfig({ host: 'https://api.barrelman.dev' })?.base).toBe(
      'https://tiles.example/tiles',
    )
  })

  it('takes an override key for a host that needs a different one', () => {
    process.env.BARRELMAN_TILE_KEY = 'env-tile-key'

    expect(
      resolveTileConfig({ host: 'https://api.barrelman.dev', tileKey: 'configured' })
        ?.tileKey,
    ).toBe('env-tile-key')
  })

  it('reports no key when none is configured, rather than inventing one', () => {
    expect(resolveTileConfig({ host: 'https://api.barrelman.dev' })?.tileKey).toBeUndefined()
  })

  it('reports nothing when no host is known at all', () => {
    expect(resolveTileConfig(undefined)).toBeUndefined()
    expect(resolveTileConfig({ tileKey: 'orphan-key' })).toBeUndefined()
  })
})
