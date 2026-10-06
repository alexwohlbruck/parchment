import { describe, expect, it } from 'vitest'
import {
  GROUND_GRID, groundGrid, insideFootprint, LANDMARK_FLAVOR, materialLight, MAX_ENTRANCES, parseLandmark, polygonRings,
  withoutReplaced,
} from './landmarks'
import { anchorMatrix, localMatrix } from './landmark-layer'

const feature = (properties: Record<string, unknown>, coordinates = [-115.17217, 36.11247]) => ({
  geometry: { type: 'Point', coordinates },
  properties: {
    id: 'paris-las-vegas-eiffel-tower',
    model: 'eiffel-tower.e33ae5cc890d.glb',
    ...properties,
  },
})

describe('parseLandmark', () => {
  it('reads a placement as Barrelman writes it', () => {
    const landmark = parseLandmark(feature({
      name: 'Eiffel Tower, Paris Las Vegas',
      bearing: 45,
      scale: 0.5,
      minzoom: 14,
      replaces: 'way/27831699 way/1',
    }))
    expect(landmark).toMatchObject({
      lng: -115.17217,
      bearing: 45,
      scale: 0.5,
      elevation: 0,
      replaces: ['way/27831699', 'way/1'],
    })
  })

  it('refuses a model name that is not a content-addressed file', () => {
    // The name is pasted into a URL, so anything path-shaped is dropped.
    expect(parseLandmark(feature({ model: '../../auth/sessions' }))).toBeNull()
    expect(parseLandmark(feature({ model: 'eiffel-tower.glb' }))).toBeNull()
  })

  it('carries the model’s credit, and none when it has none', () => {
    expect(parseLandmark(feature({ attribution: ' "Lady Liberty" by Anna M ' }))?.attribution)
      .toBe('"Lady Liberty" by Anna M')
    expect(parseLandmark(feature({}))?.attribution).toBeNull()
  })

  it('drops refs it cannot read rather than the whole landmark', () => {
    expect(parseLandmark(feature({ replaces: 'way/1 5013364 relation/2' }))?.replaces)
      .toEqual(['way/1', 'relation/2'])
  })

  it('reads a detail model and the zoom it takes over at', () => {
    expect(parseLandmark(feature({ detail: 'eiffel-tower.0123456789ab.glb', detailzoom: 17 }))?.detail)
      .toEqual({ model: 'eiffel-tower.0123456789ab.glb', zoom: 17 })
    expect(parseLandmark(feature({}))?.detail).toBeNull()
  })

  it('keeps the low model alone when the detail is unusable', () => {
    // Without a zoom there is nowhere to switch; a bad name is a bad URL.
    expect(parseLandmark(feature({ detail: 'eiffel-tower.0123456789ab.glb' }))?.detail).toBeNull()
    expect(parseLandmark(feature({ detail: '../detail.glb', detailzoom: 17 }))?.detail).toBeNull()
    expect(parseLandmark(feature({ detail: '../detail.glb', detailzoom: 17 }))?.model)
      .toBe('eiffel-tower.e33ae5cc890d.glb')
  })

  it('reads entrances from their JSON, dropping points it cannot use', () => {
    expect(parseLandmark(feature({ entrances: '[[-25.662,0.04,-12.512],[1,2],[1,"a",3],[4,5,6]]' }))?.entrances)
      .toEqual([[-25.662, 0.04, -12.512], [4, 5, 6]])
    expect(parseLandmark(feature({ entrances: 'not json' }))?.entrances).toEqual([])
    expect(parseLandmark(feature({}))?.entrances).toEqual([])
    const many = JSON.stringify(Array.from({ length: MAX_ENTRANCES + 5 }, () => [0, 0, 0]))
    expect(parseLandmark(feature({ entrances: many }))?.entrances).toHaveLength(MAX_ENTRANCES)
  })
})

describe('materialLight', () => {
  const night = LANDMARK_FLAVOR.dark.night
  const day = LANDMARK_FLAVOR.light.night

  it('is night on the dark map only', () => {
    expect(night).toBe(true)
    expect(day).toBe(false)
  })

  it('lights windows warm at night and barely by day, as Open Landmarks does', () => {
    expect(materialLight('window', night, false)).toMatchObject({ intensity: 0.5 })
    expect(materialLight('window', day, false)).toMatchObject({ intensity: 0.06, base: null })
  })

  it('turns plain windows slate at night, but never repaints a painted facade', () => {
    const slate = [0x64 / 255, 0x79 / 255, 0x8a / 255]
    expect(materialLight('window', night, false)?.base).toEqual(slate)
    expect(materialLight('window', night, true)?.base).toBeNull()
  })

  it('lights entrances at night only', () => {
    expect(materialLight('entrance', night, false)?.intensity).toBe(2.4)
    expect(materialLight('entrance', day, false)?.intensity).toBe(0)
  })

  it('treats every suffixed window as a window, and glass as glass', () => {
    // A GLB cannot repeat a material name, so a second window colour is `window-2`.
    expect(materialLight('window-2', night, true)).toMatchObject({ intensity: 0.5, base: null })
    expect(materialLight('glass', night, false)).toBeNull()
  })

  it('leaves every other material alone', () => {
    expect(materialLight('stone', night, false)).toBeNull()
    expect(materialLight('', night, true)).toBeNull()
  })
})

describe('insideFootprint', () => {
  // A 20 m × 8 m model, long side east–west at bearing 0.
  const footprint = { minX: -10, maxX: 10, minZ: -4, maxZ: 4 }
  const at = { lng: -73.9971025, lat: 40.7312347, bearing: 0, scale: 1 }
  const k = Math.cos((at.lat * Math.PI) / 180) * 111320
  /** A box in metres east and north of the anchor, as a GeoJSON ring. */
  const box = (e0: number, n0: number, e1: number, n1: number) => [[
    [at.lng + e0 / k, at.lat + n0 / 110574], [at.lng + e1 / k, at.lat + n0 / 110574],
    [at.lng + e1 / k, at.lat + n1 / 110574], [at.lng + e0 / k, at.lat + n1 / 110574],
  ]]

  it('takes a building lying within the model', () => {
    expect(insideFootprint(at, footprint, box(-9.5, -3.5, 9.5, 3.5))).toBe(true)
  })

  it('leaves a building that reaches past it, however much of it is inside', () => {
    // The fort under the Statue of Liberty: centred on the model, far larger.
    expect(insideFootprint(at, footprint, box(-50, -50, 50, 50))).toBe(false)
    expect(insideFootprint(at, footprint, box(5, -3, 15, 3))).toBe(false)
  })

  it('turns with the bearing', () => {
    // The same long box, but laid north–south: inside only once turned 90°.
    const ns = box(-3.5, -9.5, 3.5, 9.5)
    expect(insideFootprint(at, footprint, ns)).toBe(false)
    expect(insideFootprint({ ...at, bearing: 90 }, footprint, ns)).toBe(true)
  })

  it('scales with the placement', () => {
    expect(insideFootprint({ ...at, scale: 0.5 }, footprint, box(-9.5, -3.5, 9.5, 3.5))).toBe(false)
  })

  it('reads multipolygons', () => {
    const geometry = { type: 'MultiPolygon', coordinates: [box(-1, -1, 1, 1), box(-50, -50, -40, -40)] }
    expect(insideFootprint(at, footprint, polygonRings(geometry))).toBe(false)
  })
})

describe('withoutReplaced', () => {
  it('leaves the filter alone when nothing is replaced', () => {
    expect(withoutReplaced(['!has', 'hide_3d'], 'building', [])).toEqual(['!has', 'hide_3d'])
  })

  it('converts the legacy filter, since a style cannot mix the two syntaxes', () => {
    expect(withoutReplaced(['!has', 'hide_3d'], 'building', [], [33574370])).toEqual([
      'all',
      ['!', ['has', 'hide_3d']],
      ['!', ['in', ['id'], ['literal', [33574370]]]],
    ])
  })

  it('never turns a ref into a basemap id, since those ids are merged', () => {
    // way/229651145 would be 2296511452 — which on the basemap can be the id
    // of every building of that height in the tile.
    expect(withoutReplaced(null, 'building', ['way/229651145'])).toBeNull()
  })

  it('matches Barrelman’s buildings by the ref they carry', () => {
    expect(withoutReplaced(null, 'buildings_3d', ['way/1'])).toEqual(
      ['!', ['in', ['get', 'id'], ['literal', ['way/1']]]],
    )
  })
})

/** Column-major 3x3 times a vector. */
const apply3 = (m: Float32Array, [x, y, z]: number[]) => [
  m[0] * x + m[3] * y + m[6] * z,
  m[1] * x + m[4] * y + m[7] * z,
  m[2] * x + m[5] * y + m[8] * z,
].map(v => Math.round(v * 1e6) / 1e6 + 0)

describe('localMatrix', () => {
  // The map frame is east, south, up. Model north is glTF -Z.
  it('stands the model up: glTF Y becomes the map’s up', () => {
    expect(apply3(localMatrix(0, 1), [0, 1, 0])).toEqual([0, 0, 1])
  })

  it('keeps model north pointing north at bearing 0', () => {
    expect(apply3(localMatrix(0, 1), [0, 0, -1])).toEqual([0, -1, 0])
  })

  it('turns model north clockwise to the bearing', () => {
    // 90° is east; the Eiffel Tower's 44° is between north and east.
    expect(apply3(localMatrix(90, 1), [0, 0, -1])).toEqual([1, 0, 0])
    const [e, s] = apply3(localMatrix(44, 1), [0, 0, -1])
    expect(e).toBeGreaterThan(0)
    expect(s).toBeLessThan(0)
  })

  it('flips handedness exactly once, which the projection flips back', () => {
    const m = localMatrix(30, 1)
    const det =
      m[0] * (m[4] * m[8] - m[7] * m[5]) -
      m[3] * (m[1] * m[8] - m[7] * m[2]) +
      m[6] * (m[1] * m[5] - m[4] * m[2])
    // glTF is right-handed; east-south-up is left-handed as coordinates. A
    // model placed without being mirrored therefore has determinant -1 here,
    // and MapLibre's projection — which turns south-pointing y into the
    // screen's up — supplies the other flip, so an authored counter-clockwise
    // face is still counter-clockwise on screen. `ObjectLayer` mirrors its
    // models instead (+1 here) and so draws with `frontFace(CW)`.
    expect(det).toBeCloseTo(-1)
  })

  it('scales uniformly', () => {
    expect(apply3(localMatrix(0, 0.5), [0, 330, 0])).toEqual([0, 0, 165])
  })
})

describe('anchorMatrix', () => {
  it('moves the model to its anchor and scales metres to mercator', () => {
    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const m = anchorMatrix(identity, { x: 0.25, y: 0.5, z: 0, perMetre: 1e-7 })
    // A point 10 m east of the anchor.
    const x = m[0] * 10 + m[12]
    expect(x).toBeCloseTo(0.25 + 1e-6, 10)
    expect(m[13]).toBeCloseTo(0.5, 10)
  })
})

describe('groundGrid', () => {
  const footprint = { minX: -10, maxX: 10, minZ: -4, maxZ: 4 }
  const at = { lng: -73.9971025, lat: 40.7312347, bearing: 0, scale: 1 }
  const k = Math.cos((at.lat * Math.PI) / 180) * 111320

  it('runs row by row from the north-west corner', () => {
    const points = groundGrid(at, footprint)
    expect(points).toHaveLength(GROUND_GRID * GROUND_GRID)
    // -Z is north, so the first point is (minX, minZ): the north-west corner.
    const [lng, lat] = points[0]
    expect((lng - at.lng) * k).toBeCloseTo(-10, 6)
    expect((lat - at.lat) * 110574).toBeCloseTo(4, 6)
    // The end of the first row is the north-east corner.
    expect((points[GROUND_GRID - 1][0] - at.lng) * k).toBeCloseTo(10, 6)
  })

  it('turns and scales with the placement, staying on the footprint', () => {
    const turned = { ...at, bearing: 37, scale: 0.5 }
    // insideFootprint undoes the same turn, so every sample lands on it.
    expect(insideFootprint(turned, footprint, [groundGrid(turned, footprint)])).toBe(true)
    // A quarter turn puts the north-west corner at the north-east.
    const [lng, lat] = groundGrid({ ...at, bearing: 90 }, footprint)[0]
    expect((lng - at.lng) * k).toBeCloseTo(4, 6)
    expect((lat - at.lat) * 110574).toBeCloseTo(10, 6)
  })
})
