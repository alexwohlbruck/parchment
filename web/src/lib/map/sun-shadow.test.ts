import { describe, expect, it } from 'vitest'
import { multiply, sunLightMatrix, tileToMercator } from './sun-shadow'

const apply = (m: ArrayLike<number>, p: number[]) => [0, 1, 2, 3].map(r => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r] * p[3])

describe('sunLightMatrix', () => {
  const perMetre = 1 / 33e6
  const center: [number, number] = [0.27, 0.4]
  const d = 800 * perMetre
  const view = {
    center, perMetre, radius: 2000, ceiling: 300, floor: 0, toward: [0.5, 0.5, -1] as [number, number, number],
    corners: [[center[0] - d, center[1] - d], [center[0] + d, center[1] - d], [center[0] + d, center[1] + d], [center[0] - d, center[1] + d]] as Array<[number, number]>,
  }
  const L = sunLightMatrix(view).light

  it('fits the visible ground, at every height up to the ceiling, inside the map', () => {
    for (const [x, y] of view.corners) for (const h of [0, 300]) {
      const c = apply(L, [x, y, h * perMetre, 1])
      for (const v of c.slice(0, 3)) expect(Math.abs(v)).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('puts a point up the light ray on the same texel, nearer the sun', () => {
    const ground = apply(L, [center[0], center[1], 0, 1])
    // 100 m back toward the sun: west, south, up, in mercator y running south.
    const up = apply(L, [center[0] - 50 * perMetre, center[1] + 50 * perMetre, 100 * perMetre, 1])
    expect(up[0]).toBeCloseTo(ground[0], 9)
    expect(up[1]).toBeCloseTo(ground[1], 9)
    expect(up[2]).toBeLessThan(ground[2])
  })

  it("sizes a texel as the view's extent over the map's texels", () => {
    const { texelMetres } = sunLightMatrix(view)
    expect(texelMetres).toBeGreaterThanOrEqual(1600 / 2048)
    expect(texelMetres).toBeLessThan(4000 / 2048)
  })
})

describe('tileToMercator', () => {
  it('maps a tile corner and its far corner to the tile bounds', () => {
    const t = tileToMercator(2, 1, 3, 0, 1)
    expect(apply(t, [0, 0, 0, 1]).slice(0, 2)).toEqual([0.25, 0.75])
    expect(apply(multiply(t, new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])), [8192, 8192, 0, 1]).slice(0, 2)).toEqual([0.5, 1])
  })
})
