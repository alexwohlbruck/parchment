import { describe, test, expect } from 'vitest'
import { MAX_GRADE, along, outline, type Mesh, type Point } from '@/lib/map-decks/decks'
import { FACADE, FORECOURT, HEADROOM, PROFILES, ROOF, STEEPEST, approach, emerge, inside, measureEdges, portalLine, portalMesh, solveCut, type PortalMesh } from './tunnels'

// About a metre in mercator units at New York's latitude.
const M = 1 / 30400000
const y0 = 0.3761
const x0 = 0.2944
/** A point `east` and `north` metres from the origin. */
const at = (east: number, north = 0): Point => [x0 + east * M, y0 - north * M]
const tolerance = 0.5 * M

describe('approach', () => {
  // A tunnel heading west, its portal at the origin; the road carries on east.
  const inward = at(-10)
  const reach = (...args: Parameters<typeof approach>) => along(approach(...args).points).at(-1)

  test('follows the road straight on from the portal, across the ways it is split into', () => {
    const { points, junction } = approach(at(0), inward, [[at(0), at(50)], [at(50), at(100)]], tolerance)
    expect(along(points).at(-1)).toBeCloseTo(100, 0)
    expect(junction).toBe(false)
  })

  test('stops where another road meets it', () => {
    const roads = [[at(0), at(50)], [at(50), at(100)], [at(50), at(50, 40)]]
    const { points, junction } = approach(at(0), inward, roads, tolerance)
    expect(along(points).at(-1)).toBeCloseTo(50, 0)
    expect(junction).toBe(true)
  })

  test('carries on across a sliver the tiles leave at a seam', () => {
    const { points, junction } = approach(at(0), inward, [[at(0), at(50)], [at(50), at(51.2)], [at(50.3), at(100)]], tolerance * 3)
    expect(along(points).at(-1)).toBeGreaterThan(99)
    expect(junction).toBe(false)
  })

  test('stops where a road runs through the junction rather than ending at it', () => {
    const roads = [[at(0), at(50)], [at(50), at(100)], [at(50, -30), at(50), at(50, 30)]]
    expect(reach(at(0), inward, roads, tolerance)).toBeCloseTo(50, 0)
  })

  test('does not turn a corner onto another road', () => {
    const roads = [[at(0), at(50)], [at(50), at(50, 60)]]
    expect(reach(at(0), inward, roads, tolerance)).toBeCloseTo(50, 0)
  })

  test('is cut to the length asked for', () => {
    expect(reach(at(0), inward, [[at(0), at(400)]], tolerance, 160)).toBeCloseTo(160, 0)
  })

  test('is just the portal where no road meets it', () => {
    expect(approach(at(0), inward, [[at(5, 30), at(80, 30)]], tolerance).points).toHaveLength(1)
  })
})

describe('measureEdges', () => {
  test('reads each side off the surface around the line', () => {
    const line = [at(0), at(20), at(40)]
    const sides = outline(line, [4, 6], [0, 0])
    const ring = [sides[0].left, sides[2].left, sides[2].right, sides[0].right, sides[0].left]
    const [left, right] = measureEdges(line, [ring])!
    expect(left).toBeCloseTo(4, 1)
    expect(right).toBeCloseTo(6, 1)
  })

  test('is null with no surface beside the line', () => {
    expect(measureEdges([at(0), at(20)], [[at(0, 50), at(20, 50), at(20, 60), at(0, 50)]])).toBeNull()
  })
})

describe('solveCut', () => {
  /** A portal `length` metres out along a line sampled every 2 m, with 20 m of bore past it. */
  const line = (length: number) => {
    const d = Array.from({ length: (length + 20) / 2 + 1 }, (_, i) => i * 2)
    return { d, at: length / 2 }
  }
  const flat = (d: number[], h: number) => d.map(() => h)

  test('digs the portal to headroom under the cover and ramps up at a road grade', () => {
    const { d, at } = line(160)
    const cut = solveCut(d, at, flat(d, 10), [flat(d, 10), flat(d, 10)], 13)!
    expect(cut.floor[at]).toBeCloseTo(13 - HEADROOM - ROOF)
    const climb = (cut.floor[at - 10] - cut.floor[at]) / (d[at] - d[at - 10])
    expect(climb).toBeCloseTo(MAX_GRADE)
    // It opens where the floor has climbed back to the ground.
    expect(d[at] - d[cut.open]).toBeCloseTo((10 - cut.floor[at]) / MAX_GRADE, -1)
    expect(cut.floor[cut.open]).toBe(10)
  })

  test('reads the ground just out from a portal whose own sample lands on the slope into the bore', () => {
    const { d, at } = line(160)
    const ground = d.map((_, i) => (i < at ? -2 : i === at ? 1 : 3))
    expect(solveCut(d, at, ground, [flat(d, 2.8), flat(d, 2.8)], 2.8)).not.toBeNull()
  })

  test('gives a path less headroom and a steeper climb than a road', () => {
    const { d, at } = line(160)
    const road = solveCut(d, at, flat(d, 10), [flat(d, 10), flat(d, 10)], 13)!
    const path = solveCut(d, at, flat(d, 10), [flat(d, 10), flat(d, 10)], 13, true, PROFILES.path)!
    expect(path.floor[at]).toBeCloseTo(13 - PROFILES.path.headroom - ROOF)
    expect(path.floor[at]).toBeGreaterThan(road.floor[at])
    expect(d[at] - d[path.open]).toBeLessThan(d[at] - d[road.open])
  })

  test('digs nothing where the road goes in at grade, under a building or a deck', () => {
    const { d, at } = line(160)
    expect(solveCut(d, at, flat(d, 10), [flat(d, 10.5), flat(d, 10.5)], 10.5)).toBeNull()
  })

  test('keeps a portal where the ground already dips below it', () => {
    const { d, at } = line(160)
    const ground = d.map((s, i) => (i <= at ? 2 - Math.max(0, 40 - (d[at] - s)) * 0.12 : 3))
    const cut = solveCut(d, at, ground, [flat(d, 2.5), flat(d, 2.5)], 3)!
    expect(cut.floor[at]).toBeCloseTo(ground[at])
  })

  test('climbs more steeply where the road reaches a junction first, and meets the ground there', () => {
    const { d, at } = line(30)
    const cut = solveCut(d, at, flat(d, 10), [flat(d, 10), flat(d, 10)], 13)!
    expect(cut.floor[0]).toBeGreaterThan(cut.floor[at] + MAX_GRADE * 30)
    expect(cut.floor[0]).toBeCloseTo(10)
    expect((cut.floor[0] - cut.floor[at]) / 30).toBeLessThanOrEqual(MAX_GRADE * STEEPEST + 1e-9)
  })

  test('keeps a road grade where the road runs on past what is loaded', () => {
    const { d, at } = line(30)
    const cut = solveCut(d, at, flat(d, 10), [flat(d, 10), flat(d, 10)], 13, false)!
    expect(cut.floor[0]).toBeCloseTo(cut.floor[at] + MAX_GRADE * 30)
  })

  test('gives a portal into a hillside a forecourt to open from', () => {
    const { d, at } = line(160)
    const ground = d.map((_, i) => (i <= at ? 10 : 40))
    const cut = solveCut(d, at, ground, [flat(d, 10), flat(d, 10)], 40)!
    expect(cut.floor[at]).toBe(10)
    expect(d[at] - d[cut.open]).toBeGreaterThanOrEqual(FORECOURT)
    expect(cut.crown).toBe(10 + HEADROOM + ROOF + FACADE)
  })

  test('walls hold back the ground beside the cut and close to nothing where it opens', () => {
    const { d, at } = line(160)
    const cut = solveCut(d, at, flat(d, 10), [flat(d, 10), flat(d, 11)], 13)!
    expect(cut.walls[0][at]).toBe(10)
    expect(cut.walls[1][at]).toBe(11)
    expect(cut.walls[0][cut.open]).toBe(cut.floor[cut.open])
  })
})

describe('emerge', () => {
  const box = [[at(-5, -10), at(20, -10), at(20, 10), at(-5, 10), at(-5, -10)]]
  const covered = (p: Point) => inside(p, box)

  test('moves a portal under a building out to its face, the covered stretch joining the bore', () => {
    const moved = emerge([at(0), at(100)], [at(0), at(-40)], covered)!
    expect((moved.out[0][0] - x0) / M).toBeCloseTo(20, 0)
    expect(along(moved.bore).at(-1)).toBeCloseTo(60, 0)
  })

  test('leaves a portal in the open where it is', () => {
    const out = [at(30), at(100)]
    expect(emerge(out, [at(30), at(0)], covered)!.out).toBe(out)
  })
})

describe('portalMesh', () => {
  const build = () => {
    const { points, at: portal } = portalLine([at(0), at(120)], [at(0), at(-40)], 3)
    const d = along(points)
    const cut = solveCut(d, portal, d.map(() => 10), [d.map(() => 10), d.map(() => 10)], 13)!
    const out: PortalMesh = { inside: mesh(), lid: mesh(), outside: mesh(), earth: mesh() }
    portalMesh(points, portal, [4, 4], cut, [0, 0], { surface: [1, 0, 0], concrete: [0, 1, 0], parapet: [0, 0, 1], bore: [0, 1, 0], ground: [1, 1, 0] }, out)
    return { out, points, portal, cut }
  }
  const mesh = (): Mesh => ({ position: [], normal: [], color: [] })
  /** Each vertex of a colour, with its position and normal. */
  const vertices = (m: Mesh, color: number[]) => {
    const found: Array<{ p: number[]; n: number[] }> = []
    for (let i = 0; i < m.color.length; i += 3)
      if (m.color.slice(i, i + 3).every((c, k) => c === color[k])) found.push({ p: m.position.slice(i, i + 3), n: m.normal.slice(i, i + 3) })
    return found
  }

  test('the road faces up and the walls face the road', () => {
    const { out } = build()
    expect(vertices(out.inside, [1, 0, 0]).every(v => v.n[2] > 0.99)).toBe(true)
    // The road runs along y0, so each wall faces back across it.
    const walls = vertices(out.inside, [0, 1, 0]).filter(v => Math.abs(v.n[2]) < 0.01 && Math.abs(v.n[1]) > 0.9)
    expect(walls.length).toBeGreaterThan(0)
    expect(walls.every(v => Math.sign(v.n[1]) === -Math.sign(v.p[1] - y0))).toBe(true)
  })

  test('the earth over the bore never faces down', () => {
    const { out } = build()
    const earth = vertices(out.earth, [1, 1, 0])
    expect(earth.length).toBeGreaterThan(0)
    expect(earth.every(v => v.n[2] >= 0)).toBe(true)
  })

  test('the lid covers the cut from where it opens to the portal', () => {
    const { out, points, portal, cut } = build()
    const xs = out.lid.position.filter((_, i) => i % 3 === 0)
    expect(Math.max(...xs)).toBeLessThanOrEqual(points[cut.open][0] + 6 * M)
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(points[portal][0] - 6 * M)
  })
})
