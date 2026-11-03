import { describe, expect, it } from 'vitest'
import { coveredNear, planCoverage } from './landmark-coverage'
import { insideFootprint } from './landmarks'

/** Triangles in plan (x, z) at height y, as one primitive; three points per triangle. */
const primitive = (triangles: number[][], y = 0, node = -1) => ({
  position: new Float32Array(triangles.flatMap(([x, z]) => [x, y, z])),
  index: Uint32Array.from(triangles.keys()),
  node,
})

/** A model from primitives, its bounds measured as `parseGlb` would (at rest, so `pose` applied). */
const model = (primitives: ReturnType<typeof primitive>[], pose?: Map<number, number[]>) => {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const p of primitives)
    for (let i = 0; i < p.position.length; i += 3) {
      const m = pose?.get(p.node)
      const v = [p.position[i], p.position[i + 1], p.position[i + 2]]
      const at = m ? [v[0] + m[12], v[1] + m[13], v[2] + m[14]] : v
      for (let c = 0; c < 3; c++) {
        min[c] = Math.min(min[c], at[c])
        max[c] = Math.max(max[c], at[c])
      }
    }
  return { primitives, min, max }
}

/** Two triangles over a plan rectangle. */
const quad = (x0: number, z0: number, x1: number, z1: number) =>
  [[x0, z0], [x1, z0], [x1, z1], [x0, z0], [x1, z1], [x0, z1]]

/** A walled box with no roof: every wall is edge-on from above. */
const walls = (x0: number, z0: number, x1: number, z1: number) => {
  const corners = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]
  const out: number[] = []
  corners.forEach(([ax, az], i) => {
    const [bx, bz] = corners[(i + 1) % 4]
    out.push(ax, 0, az, bx, 0, bz, bx, 10, bz, ax, 0, az, bx, 10, bz, ax, 10, az)
  })
  return { position: new Float32Array(out), index: Uint32Array.from({ length: out.length / 3 }, (_, i) => i), node: -1 }
}

/**
 * A coaster-like ring: a 3 m ribbon of track around a circle of radius `r`
 * metres, with nothing inside it.
 */
const ring = (r: number, width = 3, segments = 96) => {
  const triangles: number[][] = []
  for (let i = 0; i < segments; i++) {
    const [a, b] = [(2 * Math.PI * i) / segments, (2 * Math.PI * (i + 1)) / segments]
    const inner = (t: number) => [(r - width / 2) * Math.cos(t), (r - width / 2) * Math.sin(t)]
    const outer = (t: number) => [(r + width / 2) * Math.cos(t), (r + width / 2) * Math.sin(t)]
    triangles.push(inner(a), outer(a), outer(b), inner(a), outer(b), inner(b))
  }
  return primitive(triangles, 30)
}

const at = { lng: -80.94, lat: 35.105, bearing: 0, scale: 1 }
const k = Math.cos((at.lat * Math.PI) / 180) * 111320
/** A box in metres east and south of the anchor (the model's x and z), as a GeoJSON ring. */
const box = (x0: number, z0: number, x1: number, z1: number) => [[
  [at.lng + x0 / k, at.lat - z0 / 110574], [at.lng + x1 / k, at.lat - z0 / 110574],
  [at.lng + x1 / k, at.lat - z1 / 110574], [at.lng + x0 / k, at.lat - z1 / 110574],
  [at.lng + x0 / k, at.lat - z0 / 110574],
]]

describe('planCoverage', () => {
  it('leaves the inside of a coaster’s loop uncovered', () => {
    const coaster = planCoverage(model([ring(100)]))
    // A whole plaza of buildings inside the loop, well within its bounding box.
    expect(insideFootprint(at, coaster, box(-20, -20, 20, 20))).toBe(false)
    expect(insideFootprint(at, coaster, box(-60, -10, -40, 10))).toBe(false)
    // A shed standing right under the track is part of the ride.
    expect(insideFootprint(at, coaster, box(99, -1, 101, 1))).toBe(true)
  })

  it('walks the edges, not just the corners', () => {
    // Both ends on the track, open ground between: corners alone would pass.
    const coaster = planCoverage(model([ring(100)]))
    expect(insideFootprint(at, coaster, box(-100.5, -1, 100.5, 1))).toBe(false)
  })

  it('covers a solid tower, so its parts go with it', () => {
    // A 30 m square base with a roof and four walls.
    const tower = planCoverage(model([primitive(quad(-15, -15, 15, 15), 120), walls(-15, -15, 15, 15)]))
    expect(insideFootprint(at, tower, box(-15, -15, 15, 15))).toBe(true)
    expect(insideFootprint(at, tower, box(-5, -5, 5, 5))).toBe(true)
    expect(insideFootprint(at, tower, box(2, -14, 14, -2))).toBe(true)
    // A neighbour that reaches past it stays.
    expect(insideFootprint(at, tower, box(10, -5, 30, 5))).toBe(false)
  })

  it('counts walls seen edge-on, which have no area in plan', () => {
    const shell = planCoverage(model([walls(-20, -20, 20, 20)]))
    expect(coveredNear(shell, -20, 0, 0)).toBe(true)
    expect(coveredNear(shell, 20, 7, 0)).toBe(true)
    // No roof: the middle is open.
    expect(coveredNear(shell, 0, 0, 0)).toBe(false)
  })

  it('reaches a building only as far as the tolerance', () => {
    const tower = planCoverage(model([primitive(quad(-15, -15, 15, 15))]))
    expect(coveredNear(tower, 16, 0, 1.5)).toBe(true)
    expect(coveredNear(tower, 20, 0, 1.5)).toBe(false)
    // Never beyond the bounding box and the tolerance, whatever the grid.
    expect(coveredNear(tower, 17.6, 0, 1.5)).toBe(false)
  })

  it('places moving parts by the pose it is given', () => {
    // A car modelled at its node's origin; at rest the node puts it 40 m east.
    const pose = new Map([[3, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 40, 0, 0, 1]]])
    const wheel = planCoverage(model([primitive(quad(-2, -2, 2, 2), 0, 3), primitive(quad(-1, -1, 1, 1))], pose), pose)
    expect(coveredNear(wheel, 40, 0, 0)).toBe(true)
    expect(coveredNear(wheel, 20, 0, 0)).toBe(false)
  })

  it('caps the grid for a very large model', () => {
    const coaster = planCoverage(model([ring(1000)]))
    expect(coaster.cols).toBeLessThanOrEqual(256)
    expect(coaster.rows).toBeLessThanOrEqual(256)
    expect(insideFootprint(at, coaster, box(-20, -20, 20, 20))).toBe(false)
  })
})
