/**
 * The basemap's maxzoom: which depth a session's style starts on, and when the
 * TileJSON's answer changes it now rather than next session.
 */
import { describe, test, expect, beforeEach } from 'vitest'
import {
  basemapMaxzoom,
  DEFAULT_BASEMAP_MAXZOOM,
  probeBasemapMaxzoom,
  recallBasemapMaxzoom,
  setBasemapMaxzoom,
} from './basemap-zoom'

const SERVER = 'https://api.example/proxy/barrelman'

const tileJson = (maxzoom: unknown) => (async () => Response.json({ tilejson: '3.0.0', minzoom: 0, maxzoom })) as unknown as typeof fetch
const status = (code: number) => (async () => new Response(null, { status: code })) as unknown as typeof fetch
const offline = (async () => {
  throw new TypeError('Failed to fetch')
}) as unknown as typeof fetch

/** A new session: nothing recalled or asked yet, storage as the last one left it. */
function newSession() {
  setBasemapMaxzoom()
  recallBasemapMaxzoom(SERVER)
}

beforeEach(() => {
  localStorage.clear()
  setBasemapMaxzoom()
})

describe('the depth a session starts on', () => {
  test('z14 for a tile server never asked', () => {
    newSession()
    expect(basemapMaxzoom()).toBe(DEFAULT_BASEMAP_MAXZOOM)
  })

  test('what the last session read from the TileJSON', async () => {
    newSession()
    await probeBasemapMaxzoom(SERVER, tileJson(15))
    newSession()
    expect(basemapMaxzoom()).toBe(15)
  })

  test('z14 again once the server stops serving a TileJSON', async () => {
    newSession()
    await probeBasemapMaxzoom(SERVER, tileJson(15))
    newSession()
    await probeBasemapMaxzoom(SERVER, status(404))
    newSession()
    expect(basemapMaxzoom()).toBe(14)
  })

  test('unchanged by an answer that is not a real depth', async () => {
    newSession()
    await probeBasemapMaxzoom(SERVER, tileJson(22))
    await probeBasemapMaxzoom(`${SERVER}/b`, tileJson('15'))
    newSession()
    expect(basemapMaxzoom()).toBe(14)
  })
})

describe('a session whose style is already built', () => {
  test('keeps a deeper basemap for the next session instead of rebuilding', async () => {
    newSession()
    expect(await probeBasemapMaxzoom(SERVER, tileJson(15))).toBe(false)
    expect(basemapMaxzoom()).toBe(14)
  })

  test('rebuilds at once when the server is shallower than the style', async () => {
    newSession()
    await probeBasemapMaxzoom(SERVER, tileJson(15))
    newSession()
    expect(await probeBasemapMaxzoom(SERVER, tileJson(14))).toBe(true)
    expect(basemapMaxzoom()).toBe(14)
  })

  test('keeps its depth when the server cannot be reached or errors', async () => {
    newSession()
    await probeBasemapMaxzoom(SERVER, tileJson(15))
    newSession()
    expect(await probeBasemapMaxzoom(SERVER, offline)).toBe(false)
    setBasemapMaxzoom(15)
    expect(await probeBasemapMaxzoom(SERVER, status(502))).toBe(false)
    newSession()
    expect(basemapMaxzoom()).toBe(15)
  })

  test('asks each tile server once, however many style rebuilds ask', async () => {
    newSession()
    let calls = 0
    const counted = (async () => {
      calls++
      return Response.json({ maxzoom: 15 })
    }) as unknown as typeof fetch
    await Promise.all([probeBasemapMaxzoom(SERVER, counted), probeBasemapMaxzoom(SERVER, counted)])
    await probeBasemapMaxzoom(SERVER, counted)
    expect(calls).toBe(1)
  })
})
