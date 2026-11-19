import { describe, expect, it } from 'vitest'
import type { GlbPrimitive } from './glb.mjs'
import { LANDMARK_LIGHT, landmarkGlows, landmarkPools } from './landmark-lights'
import type { Halo } from './neon-halos'

const FLOATS = 7

/** A primitive of one material whose vertices are the given points. */
function primitive(material: string, points: number[][], node = -1): GlbPrimitive {
  return { material, node, position: new Float32Array(points.flat()), index: new Uint16Array(0), color: [1, 1, 1] } as unknown as GlbPrimitive
}

const sign = (height: number, half: number): Halo =>
  ({ centre: [0, height, 0], u: [half, 0, 0], v: [0, 1, 0], color: [1, 0, 0], margin: 1, strength: 1, billboard: false })

describe('landmarkPools', () => {
  it('gives each lamp one pool under it, however many vertices its bulb has', () => {
    const bulb = (x: number) => [[x, 4, 0], [x + 0.2, 4.2, 0.1], [x + 0.1, 4.1, 0.2]]
    const pools = landmarkPools([primitive('lamp', [...bulb(0.5), ...bulb(20.5)])], [])
    expect(pools.length / FLOATS).toBe(2)
    expect(pools[0]).toBeCloseTo(0.6)
    expect(pools[3]).toBe(LANDMARK_LIGHT.lampReach)
    expect(pools[FLOATS]).toBeCloseTo(20.6)
  })

  it('leaves out what is not a lamp, and lamps on a moving part', () => {
    expect(landmarkPools([primitive('stone', [[0, 4, 0]]), primitive('lamp', [[0, 4, 0]], 2)], [])).toHaveLength(0)
  })

  it('throws nothing on the ground from a lamp far over it, as one on a bridge cable', () => {
    const pools = landmarkPools([primitive('lamp', [[0.5, 6, 0], [20.5, 14, 0], [40.5, 40, 0]])], [])
    expect(pools.length / FLOATS).toBe(2)
    expect(pools[4]).toBe(LANDMARK_LIGHT.lampColor[0])
    expect(pools[FLOATS + 4]).toBeCloseTo(LANDMARK_LIGHT.lampColor[0] / 2)
  })

  it('throws a higher sign wider and dimmer, in its own colour', () => {
    const [low, high] = [sign(4, 3), sign(40, 3)].map(h => landmarkPools([], [h]))
    expect(high[3]).toBeGreaterThan(low[3])
    expect(high[4]).toBeLessThan(low[4])
    expect(low[4]).toBeGreaterThan(0)
    expect([low[5], low[6]]).toEqual([0, 0])
  })

  it('glows round every bulb, however high', () => {
    const glows = landmarkGlows([primitive('lamp', [[0.5, 6, 0], [40.5, 40, 0]]), primitive('stone', [[0, 4, 0]])])
    expect(glows.length / FLOATS).toBe(2)
    expect([...glows.slice(FLOATS, FLOATS + 4)]).toEqual([40.5, 40, 0, Math.fround(LANDMARK_LIGHT.glowReach)])
  })
})
