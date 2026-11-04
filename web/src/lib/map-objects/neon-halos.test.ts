import { describe, expect, it } from 'vitest'
import type { GlbPrimitive } from './glb.mjs'
import { HALO_FLOATS, neonHalos, packHalos, principalAxes } from './neon-halos'

type Quad = [number, number, number][]

/** One primitive of quads, each given by four corners in order. */
function primitive(material: string, quads: Quad[], node = -1): GlbPrimitive {
  const position = new Float32Array(quads.flat(2))
  const index = new Uint16Array(quads.flatMap((_, q) => [0, 1, 2, 0, 2, 3].map(i => q * 4 + i)))
  return {
    position, normal: new Float32Array(position.length), index, color: [0.7, 0.02, 0.02, 1], material,
    uv: null, floodlight: null, image: null, alphaMode: 'OPAQUE', alphaCutoff: 0.5, doubleSided: false, node,
  }
}

/** A vertical panel facing +z, `w` wide and `h` tall, its lower left corner at (x, y, z). */
const panel = (x: number, y: number, z: number, w: number, h: number): Quad =>
  [[x, y, z], [x + w, y, z], [x + w, y + h, z], [x, y + h, z]]

const length = (v: number[]) => Math.hypot(...v)

describe('neonHalos', () => {
  it('fits a flat screen with a card of its own size, in its own plane', () => {
    const [halo] = neonHalos([primitive('neon-screen-red', [panel(0, 10, 0, 12, 6)])])
    expect(halo.billboard).toBe(false)
    expect(halo.centre.map(c => +c.toFixed(3))).toEqual([6, 13, 0])
    expect([length(halo.u), length(halo.v)].map(c => +c.toFixed(3))).toEqual([6, 3])
    expect(Math.abs(halo.u[2]) + Math.abs(halo.v[2])).toBeLessThan(1e-6)
    expect(halo.strength).toBeCloseTo(1)
  })

  it('makes one sign of separate letters on one face', () => {
    const letters = [0, 1.5, 3, 4.5].map(x => panel(x, 0, 0, 1, 2))
    expect(neonHalos([primitive('neon-sign-red', letters)])).toHaveLength(1)
  })

  it('gives a screen round a corner a card per face', () => {
    const front = panel(0, 0, 0, 8, 6)
    const side: Quad = [[8, 0, 0], [8, 0, -8], [8, 6, -8], [8, 6, 0]]
    const halos = neonHalos([primitive('neon-screen-blue', [front, side])])
    expect(halos).toHaveLength(2)
    expect(halos.every(h => h.strength > 0.9)).toBe(true)
  })

  it('glows faintly for a sign that fills little of its card', () => {
    const ring = [panel(0, 0, 0, 20, 0.6), panel(0, 19.4, 0, 20, 0.6), panel(0, 0.6, 0, 0.6, 18.8), panel(19.4, 0.6, 0, 0.6, 18.8)]
    const [halo] = neonHalos([primitive('neon-wheel', ring)])
    expect(halo.strength).toBeLessThan(0.15)
  })

  it('leaves out materials that are not neon, and parts that move', () => {
    expect(neonHalos([primitive('sign-frame', [panel(0, 0, 0, 10, 5)])])).toEqual([])
    expect(neonHalos([primitive('neon-wheel', [panel(0, 0, 0, 10, 5)], 2)])).toEqual([])
  })

  it('packs a fixed number of floats per halo', () => {
    const halos = neonHalos([primitive('neon-screen-red', [panel(0, 0, 0, 10, 5)])])
    expect(packHalos(halos)).toHaveLength(halos.length * HALO_FLOATS)
  })
})

describe('principalAxes', () => {
  it('finds the axes of a stretched, rotated covariance', () => {
    const c = Math.SQRT1_2
    // 9 along (c, c, 0), 1 along (-c, c, 0), 4 along z.
    const axes = principalAxes([[5, 4, 0], [4, 5, 0], [0, 0, 4]])
    const along = axes.map(a => Math.abs(a[0] * c + a[1] * c))
    expect(Math.max(...along)).toBeCloseTo(1)
  })
})
