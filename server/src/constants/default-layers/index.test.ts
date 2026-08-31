import { describe, it, expect } from 'bun:test'
import { resolveProxyUrls } from './index'

/**
 * Placeholder resolution in default layer templates.
 *
 * `{BARRELMAN_TILES}` is the one that carries a credential. Barrelman tiles are
 * fetched by the browser, so the key has to be on the URL — which means the
 * template cannot spell it and this function has to append it, correctly, to
 * URLs that may already have a query of their own.
 */
const SERVER = 'https://api.parchment.test'
const BARRELMAN = { base: 'https://api.barrelman.dev/tiles', tileKey: 'tiles-key' }

const source = (tiles: string[]) => ({ source: { type: 'vector', tiles } })
const tileUrl = (config: any) => config.source.tiles[0]

describe('resolveProxyUrls', () => {
  it('points barrelman tiles at barrelman, with the key on the URL', () => {
    const resolved = resolveProxyUrls(
      source(['{BARRELMAN_TILES}/bicycle_ways/{z}/{x}/{y}']),
      SERVER,
      BARRELMAN,
    )

    expect(tileUrl(resolved)).toBe(
      'https://api.barrelman.dev/tiles/bicycle_ways/{z}/{x}/{y}?api_key=tiles-key',
    )
  })

  it('leaves the tile coordinate placeholders for the renderer', () => {
    const resolved = resolveProxyUrls(
      source(['{BARRELMAN_TILES}/transit_platforms/{z}/{x}/{y}']),
      SERVER,
      BARRELMAN,
    )

    expect(tileUrl(resolved)).toContain('/{z}/{x}/{y}')
  })

  it('appends the key to a template that already has a query', () => {
    const resolved = resolveProxyUrls(
      source(['{BARRELMAN_TILES}/bicycle_ways/{z}/{x}/{y}?style=thin']),
      SERVER,
      BARRELMAN,
    )

    expect(tileUrl(resolved)).toBe(
      'https://api.barrelman.dev/tiles/bicycle_ways/{z}/{x}/{y}?style=thin&api_key=tiles-key',
    )
  })

  it('omits the key when barrelman has none, rather than sending "undefined"', () => {
    const resolved = resolveProxyUrls(
      source(['{BARRELMAN_TILES}/bicycle_ways/{z}/{x}/{y}']),
      SERVER,
      { base: 'https://api.barrelman.dev/tiles' },
    )

    expect(tileUrl(resolved)).toBe(
      'https://api.barrelman.dev/tiles/bicycle_ways/{z}/{x}/{y}',
    )
  })

  it('resolves to nothing when barrelman is not configured', () => {
    const resolved = resolveProxyUrls(
      source(['{BARRELMAN_TILES}/bicycle_ways/{z}/{x}/{y}']),
      SERVER,
    )

    expect(tileUrl(resolved)).toBe('/bicycle_ways/{z}/{x}/{y}')
  })

  it('still routes the proxied providers through this server', () => {
    const resolved = resolveProxyUrls(
      source(['{PROXY_URL}/mapillary/mly1_computed_public/2/{z}/{x}/{y}']),
      SERVER,
      BARRELMAN,
    )

    expect(tileUrl(resolved)).toBe(
      'https://api.parchment.test/proxy/mapillary/mly1_computed_public/2/{z}/{x}/{y}',
    )
  })

  it('never leaks the barrelman key into a non-barrelman URL', () => {
    const resolved = resolveProxyUrls(
      source(['{PROXY_URL}/loom/tram/geo/{z}/{x}/{y}']),
      SERVER,
      BARRELMAN,
    )

    expect(tileUrl(resolved)).not.toContain('tiles-key')
  })
})
