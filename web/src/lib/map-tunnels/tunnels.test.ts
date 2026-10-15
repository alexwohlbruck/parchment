import { describe, test, expect } from 'vitest'
import { MAX_GRADE, along, metresPerUnit, outline, type Mesh, type Point } from '@/lib/map-decks/decks'
import { FACADE, FORECOURT, HEADROOM, PROFILES, ROOF, approach, emerge, faceWall, groupPortals, splitAtFace, inside, measureEdges, portalLine, portalMesh, solveCut, type BoreKind, type PortalMesh } from './tunnels'

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

describe('faceWall', () => {
  // A bore running west from its way's end at the origin.
  const bore = [at(0), at(-40)]

  test('finds a wall mapped across the bore near its end, and the way it runs', () => {
    const face = faceWall(bore, [[at(-2, -10), at(-2, 10)]])!
    expect(face.metres).toBeCloseTo(2, 1)
    expect(Math.abs(face.along[1])).toBeCloseTo(1)
  })

  test('takes a skewed wall, but not one running along the bore', () => {
    expect(faceWall(bore, [[at(-4, -4), at(0, 4)]])).not.toBeNull()
    expect(faceWall(bore, [[at(0, 1), at(-20, 2)]])).toBeNull()
  })

  test('leaves a wall deeper in to be the parapet over the bore', () => {
    expect(faceWall(bore, [[at(-7, -10), at(-7, 10)]])).toBeNull()
  })

  test('splits the bore there: the stretch outside runs on in the open', () => {
    const split = splitAtFace([at(0), at(-1), at(-40)], { metres: 2, point: at(-2), along: [0, 1] })
    expect(split.out.map(p => Math.round((p[0] - x0) / M))).toEqual([-2, -1, 0])
    expect(split.bore.map(p => Math.round((p[0] - x0) / M))).toEqual([-2, -40])
  })

  test('keeps a bore to draw on a culvert shorter than the gap round its headwall', () => {
    const split = splitAtFace([at(0), at(-2.2)], { metres: 2, point: at(-2), along: [0, 1] })
    expect(split.bore.length).toBe(2)
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

  test('never sets the floor above the ground just out from the portal', () => {
    const { d, at } = line(160)
    const ground = d.map((_, i) => (i < at ? 8 : 10))
    const cut = solveCut(d, at, ground, [flat(d, 12), flat(d, 12)], 20)!
    expect(cut.floor[at]).toBe(8)
  })

  test('stands the headwall down to the lower bank beside the portal', () => {
    const { d, at } = line(160)
    const cut = solveCut(d, at, flat(d, 10), [flat(d, 10), flat(d, 7)], 13)!
    expect(cut.base).toBe(7)
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

  test('climbs as steeply as it must to meet the ground where the road reaches a junction', () => {
    const { d, at } = line(30)
    const cut = solveCut(d, at, flat(d, 10), [flat(d, 10), flat(d, 10)], 13)!
    expect(cut.floor[0]).toBeGreaterThan(cut.floor[at] + MAX_GRADE * 30)
    expect(cut.floor[0]).toBeCloseTo(10)
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


  test('stops the headwall at the ground behind it', () => {
    const { d, at } = line(160)
    const cut = solveCut(d, at, d.map((_, i) => (i <= at ? 10 : 13)), [flat(d, 10), flat(d, 10)], 13)!
    expect(cut.crown).toBe(13)
  })
})

describe('groupPortals', () => {
  // Bores heading west, their portals at x = `east` and their approaches running east; north is their left.
  const bore = (kind: BoreKind, north: number, half: number, { east = 0, layer = -1, bearing = 0 } = {}) => ({
    out: { points: [at(east, north), at(east + 60, north)], junction: false },
    bore: [at(east, north), at(east - 30, north + 30 * Math.tan(bearing))],
    edges: [half, half] as [number, number],
    kind,
    layer,
  })

  test('takes a road and the sidewalks mapped as tunnels beside it as one portal, with one opening', () => {
    const portals = groupPortals([bore('path', 5, 1), bore('road', 0, 3.5), bore('path', -5, 1)])
    expect(portals).toHaveLength(1)
    expect(portals[0].kind).toBe('road')
    expect(portals[0].edges[0]).toBeCloseTo(6, 1)
    expect(portals[0].edges[1]).toBeCloseTo(6, 1)
    expect(portals[0].piers).toEqual([])
  })

  test('stands a pier between two carriageways under one headwall', () => {
    const [portal, ...rest] = groupPortals([bore('road', 0, 3.5), bore('road', 10, 3.5)])
    expect(rest).toHaveLength(0)
    expect(portal.piers).toHaveLength(1)
    const [from, to] = portal.piers![0].map(Math.abs).sort((a, b) => a - b)
    expect(from).toBeCloseTo(4.1, 1)
    expect(to).toBeCloseTo(5.9, 1)
  })

  test('shares one bore between carriageways mapped on one surface', () => {
    const [portal, ...rest] = groupPortals([bore('road', 0, 3.5), bore('road', 5, 3.5)])
    expect(rest).toHaveLength(0)
    expect(portal.piers).toEqual([])
  })

  test('takes a sidewalk mapped a layer off the road, and keeps a junction either approach meets', () => {
    const road = bore('road', 0, 3.5)
    const path = { ...bore('path', 5, 1, { layer: -2 }), out: { points: [at(0, 5), at(60, 5)], junction: true } }
    const [portal, ...rest] = groupPortals([road, path])
    expect(rest).toHaveLength(0)
    expect(portal.out.junction).toBe(true)
  })

  test('keeps a railway\'s tracks in one opening', () => {
    const [portal, ...rest] = groupPortals([bore('rail', 0, 2.5), bore('rail', 4.5, 2.5)])
    expect(rest).toHaveLength(0)
    expect(portal.piers).toEqual([])
    expect(portal.edges[0] + portal.edges[1]).toBeCloseTo(9.5, 1)
  })

  test('leaves apart bores too far apart, on another layer, staggered, or splaying away', () => {
    expect(groupPortals([bore('road', 0, 3.5), bore('road', 18, 3.5)])).toHaveLength(2)
    expect(groupPortals([bore('road', 0, 3.5), bore('road', 7, 3.5, { layer: -2 })])).toHaveLength(2)
    expect(groupPortals([bore('road', 0, 3.5), bore('rail', 8, 2.5)])).toHaveLength(2)
    expect(groupPortals([bore('road', 0, 3.5), bore('path', 5, 1), bore('rail', 10, 2.5)])).toHaveLength(2)
    expect(groupPortals([bore('road', 0, 3.5), bore('path', 5, 1, { east: 15 })])).toHaveLength(2)
    expect(groupPortals([bore('road', 0, 3.5), bore('path', 5, 1, { bearing: 0.5 })])).toHaveLength(2)
  })

  test('leads with the same bore whichever order the openings come in', () => {
    const [a, b] = [bore('road', 0, 3.5), bore('road', 8, 3.5)]
    expect(groupPortals([a, b])[0].bore).toBe(groupPortals([b, a])[0].bore)
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
  const mesh = (): Mesh => ({ position: [], normal: [], color: [] })
  const build = (face?: Point, edges: [number, number] = [4, 4], piers: Array<[number, number]> = []) => {
    const { points, at: portal } = portalLine([at(0), at(120)], [at(0), at(-40)], 3)
    const d = along(points)
    const cut = solveCut(d, portal, d.map(() => 10), [d.map(() => 10), d.map(() => 10)], 13)!
    const out: PortalMesh = { walls: mesh(), mouth: mesh(), lid: mesh(), floor: mesh(), bore: mesh() }
    portalMesh(points, portal, edges, cut, [0, 0], { surface: [1, 0, 0], concrete: [0, 1, 0], parapet: [0, 0, 1], bore: [1, 1, 0] }, out, face, piers)
    return { out, points, portal, cut }
  }
  /** How far each corner of the mouth lies off the line through the portal along `dir`, in metres. */
  const offLine = (out: PortalMesh, p: Point, dir: Point) => {
    const off: number[] = []
    for (let i = 0; i < out.mouth.position.length; i += 3)
      off.push(Math.abs((out.mouth.position[i] - p[0]) * dir[1] - (out.mouth.position[i + 1] - p[1]) * dir[0]) / M)
    return Math.max(...off)
  }
  /** Each vertex of a colour, with its position and normal. */
  const vertices = (m: Mesh, color: number[]) => {
    const found: Array<{ p: number[]; n: number[] }> = []
    for (let i = 0; i < m.color.length; i += 3)
      if (m.color.slice(i, i + 3).every((c, k) => c === color[k])) found.push({ p: m.position.slice(i, i + 3), n: m.normal.slice(i, i + 3) })
    return found
  }

  test('the walls face the road', () => {
    const { out } = build()
    // The road runs along y0, so each wall faces back across it.
    const walls = vertices(out.walls, [0, 1, 0]).filter(v => Math.abs(v.n[2]) < 0.01 && Math.abs(v.n[1]) > 0.9)
    expect(walls.length).toBeGreaterThan(0)
    expect(walls.every(v => Math.sign(v.n[1]) === -Math.sign(v.p[1] - y0))).toBe(true)
  })

  test('the headwall runs along a wall mapped a little askew across the bore', () => {
    const angle = (80 * Math.PI) / 180
    const face: Point = [Math.cos(angle), Math.sin(angle)]
    const { out, points, portal } = build(face, [1, 1])
    expect(offLine(out, points[portal], face)).toBeLessThan(0.01)
  })

  test('stands square when the mapped wall is too far askew for the walls beside it to follow', () => {
    const angle = Math.PI / 4
    const { out, points, portal } = build([Math.cos(angle), Math.sin(angle)])
    expect(offLine(out, points[portal], [0, 1])).toBeLessThan(0.01)
  })

  test('the mouth stands across the road at the portal, from the floor to the bore\'s roof', () => {
    const { out, points, portal, cut } = build()
    const xs = out.mouth.position.filter((_, i) => i % 3 === 0)
    const zs = out.mouth.position.filter((_, i) => i % 3 === 2).map(z => z * metresPerUnit(y0))
    expect(xs.every(x => Math.abs(x - points[portal][0]) < 0.01 * M)).toBe(true)
    expect(Math.max(...zs)).toBeCloseTo(cut.floor[portal] + cut.headroom, 1)
  })

  test('a pier splits the mouth in two and stands in the headwall between them', () => {
    const { out } = build(undefined, [8, 8], [[-0.5, 0.5]])
    // North of the road is its left; each mouth corner lies outside the pier.
    const north = out.mouth.position.filter((_, i) => i % 3 === 1).map(y => (y0 - y) / M)
    expect(north.every(m => Math.abs(m) >= 0.49)).toBe(true)
    expect(out.mouth.position.length / 9).toBe(4)
    const pier = vertices(out.walls, [0, 1, 0]).filter(v => Math.abs((y0 - v.p[1]) / M) <= 0.51)
    expect(pier.length).toBeGreaterThan(0)
  })
})
