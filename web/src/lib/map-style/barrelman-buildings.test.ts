/**
 * The probe that decides where the 3D buildings come from.
 *
 * Getting this wrong is not subtle: report available when the source is not and
 * the map draws no buildings at all, which is worse than the doubled ones the
 * move fixes. So the bar is that only a tile with bytes in it counts.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  probeBarrelmanBuildings,
  barrelmanBuildingsReady,
  setBarrelmanBuildingsReady,
} from './barrelman-buildings'

const CENTRE = { lng: -80.8431, lat: 35.2271 } // Charlotte
const url = (z: number, x: number, y: number) => `https://tiles.test/buildings_3d/${z}/${x}/${y}`

const answer = (init: { ok: boolean; bytes?: number }) =>
  vi.fn(async () => ({
    ok: init.ok,
    arrayBuffer: async () => new ArrayBuffer(init.bytes ?? 0),
  })) as any

beforeEach(() => setBarrelmanBuildingsReady(null))
afterEach(() => {
  setBarrelmanBuildingsReady(null)
  vi.unstubAllGlobals()
})

describe('probeBarrelmanBuildings', () => {
  test('a tile with bytes in it means the source is serving', async () => {
    vi.stubGlobal('fetch', answer({ ok: true, bytes: 1024 }))
    const changed = await probeBarrelmanBuildings(url, CENTRE)
    expect(changed).toBe(true)
    expect(barrelmanBuildingsReady()).toBe(true)
  })

  test('a 404 leaves the buildings where they are', async () => {
    // What an un-migrated instance answers: Martin does not know the source.
    vi.stubGlobal('fetch', answer({ ok: false }))
    await probeBarrelmanBuildings(url, CENTRE)
    expect(barrelmanBuildingsReady()).toBe(false)
  })

  test('an empty answer does not count, or the map trades doubles for nothing', async () => {
    // The view is created empty and filled out of band, so an instance can have
    // the source and no rows in it. That must read as "not yet".
    vi.stubGlobal('fetch', answer({ ok: true, bytes: 0 }))
    await probeBarrelmanBuildings(url, CENTRE)
    expect(barrelmanBuildingsReady()).toBe(false)
  })

  test('a network failure is not a reason to blank the buildings', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }) as any)
    await probeBarrelmanBuildings(url, CENTRE)
    expect(barrelmanBuildingsReady()).toBe(false)
  })

  test('it asks once per tile server, not once per style rebuild', async () => {
    const fetchMock = answer({ ok: true, bytes: 64 })
    vi.stubGlobal('fetch', fetchMock)
    await probeBarrelmanBuildings(url, CENTRE)
    const changed = await probeBarrelmanBuildings(url, CENTRE)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Second time round nothing changed, so a caller does not rebuild again.
    expect(changed).toBe(false)
  })

  test('it asks at the map centre, so an empty view reads as empty', async () => {
    const fetchMock = answer({ ok: true, bytes: 8 })
    vi.stubGlobal('fetch', fetchMock)
    await probeBarrelmanBuildings(url, CENTRE)
    // z14 tile containing Charlotte — a fixed tile would answer for open ocean
    // on an instance whose view exists but was never populated.
    expect(fetchMock.mock.calls[0][0]).toBe('https://tiles.test/buildings_3d/14/4512/6477')
  })
})
