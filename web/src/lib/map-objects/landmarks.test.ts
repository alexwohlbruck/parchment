import { describe, expect, it } from 'vitest'
import { basemapIds, parseLandmark, withoutReplaced } from './landmarks'
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
})

describe('basemapIds', () => {
  it('matches both suffixes the basemap uses for a way', () => {
    // 278316990 is what the deployed basemap calls the Las Vegas tower.
    expect(basemapIds(['way/27831699'])).toEqual([278316992, 278316990])
  })

  it('matches relations under both suffixes too', () => {
    // The Statue of Liberty's terraces: relation 3079001 is 30790010.
    expect(basemapIds(['relation/3079001'])).toEqual([30790013, 30790010])
    expect(basemapIds(['node/5'])).toEqual([51, 50])
  })
})

describe('withoutReplaced', () => {
  it('leaves the filter alone when nothing is replaced', () => {
    expect(withoutReplaced(['!has', 'hide_3d'], 'building', [])).toEqual(['!has', 'hide_3d'])
  })

  it('converts the legacy filter, since a style cannot mix the two syntaxes', () => {
    expect(withoutReplaced(['!has', 'hide_3d'], 'building', ['way/1'])).toEqual([
      'all',
      ['!', ['has', 'hide_3d']],
      ['!', ['in', ['id'], ['literal', [12, 10]]]],
    ])
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
