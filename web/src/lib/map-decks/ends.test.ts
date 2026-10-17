import { describe, expect, test } from 'vitest'
import { along, boundsOf, coveredSides, deckMeshOut, grownRing, innerSides, inside, jointAreas, landedOn, metresPerUnit, placedPiers, type Point } from './decks'
import { joinedLines, layPaint, type PastEnd } from './paint'
import { testSurface } from './test-surface'

const y0 = 0.4012
const M = 1 / metresPerUnit(y0)
const at = (x: number, y = 0): Point => [0.2789 + x * M, y0 + y * M]
const line = (...xs: number[]): Point[] => xs.map(x => at(x))
const colors = { white: [1, 1, 1], yellow: [1, 1, 0], green: [0, 1, 0], red: [1, 0, 0], asphalt: [0.5, 0.5, 0.5] }

describe('inside', () => {
  test('even-odd over a polygon with a hole', () => {
    const outer = [at(0, 0), at(10, 0), at(10, 10), at(0, 10)]
    const hole = [at(4, 4), at(6, 4), at(6, 6), at(4, 6)]
    expect(inside(at(2, 2), [outer, hole])).toBe(true)
    expect(inside(at(5, 5), [outer, hole])).toBe(false)
    expect(inside(at(12, 5), [outer])).toBe(false)
  })
})

describe('a carriageway past a deck\'s skewed end', () => {
  const points = line(0, 20, 40)
  const surface = testSurface(points, [100, 100, 100], [100, 100, 100])
  const area = [[at(-15, -5), at(40, -5), at(40, 5), at(-15, 5)]]
  const paint = [{ props: { kind: 'surface', pattern: 'fill', color: 'asphalt' }, runs: [], areas: [area] }]
  const near = [boundsOf([at(-20, 0), at(0, 0)], 8)]

  test('is laid on the deck over it and on the ground beside its end, never under it', () => {
    const mesh = deckMeshOut()
    layPaint(mesh, paint, [surface], colors, points[0], { ground: { at: () => 99, near, low: [0.9, 0.9, 0.9] } })
    let [onDeck, beside] = [0, 0]
    for (let k = 0; k < mesh.position.length; k += 9) {
      const x = (mesh.position[k] + mesh.position[k + 3] + mesh.position[k + 6]) / 3 / M
      const z = (mesh.position[k + 2] + mesh.position[k + 5] + mesh.position[k + 8]) / 3 * metresPerUnit(y0)
      expect(x).toBeGreaterThan(-15.01)
      if (x > 0.01) {
        onDeck++
        expect(z).toBeGreaterThan(100)
      } else if (x < -0.01) {
        beside++
        expect(z).toBeLessThan(99.1)
      }
    }
    expect(onDeck).toBeGreaterThan(0)
    expect(beside).toBeGreaterThan(0)
  })

  test('is not laid beside the deck where the ground is not known', () => {
    const mesh = deckMeshOut()
    layPaint(mesh, paint, [surface], colors, points[0], { ground: { at: () => null, near, low: [0.9, 0.9, 0.9] } })
    expect(mesh.position.length).toBeGreaterThan(0)
    // Only what lies on the deck, which runs a quarter metre past its drawn end.
    for (let k = 0; k < mesh.position.length; k += 3) expect(mesh.position[k] / M).toBeGreaterThan(-0.26)
  })
})

describe('a painted area with no corner on a deck', () => {
  test('is cut to decks at its own level and never onto one far below', () => {
    const upper = line(0, 30)
    const lower = line(0, 30).map(([x, y]) => [x, y + 20 * M] as Point)
    const decks = [testSurface(upper, [110, 110], [100, 100], 4), testSurface(lower, [100, 100], [92, 92], 4)]
    // A long thin hatch whose corners lie past both decks' sides, at the upper deck's level by its own corner on it.
    const ring = [at(10, 0), at(12, 0), at(12, 30), at(10, 30)]
    const mesh = deckMeshOut()
    layPaint(mesh, [{ props: { kind: 'hatch', pattern: 'fill', color: 'white' }, runs: [], areas: [[ring]] }], decks, colors, upper[0])
    for (let k = 2; k < mesh.position.length; k += 3) expect(mesh.position[k] * metresPerUnit(y0)).toBeGreaterThan(105)
  })
})

describe('grownRing', () => {
  test('grows a ring outward whichever way it winds', () => {
    const square = [at(0, 0), at(10, 0), at(10, 10), at(0, 10)]
    for (const ring of [square, [...square].reverse()]) {
      const grown = grownRing(ring, 1)
      const xs = grown.map(p => (p[0] - at(0, 0)[0]) / M)
      expect(Math.min(...xs)).toBeCloseTo(-1, 3)
      expect(Math.max(...xs)).toBeCloseTo(11, 3)
    }
  })
})

describe('an area on a deck\'s drawn top', () => {
  test('covers exactly its part of the deck, at the height of the top drawn there', async () => {
    const { deckMesh } = await import('./decks')
    const points = line(0, 10, 20, 30)
    const chain = { points, grounded: [true, true] as [boolean, boolean], layer: 1, width: 12, kind: 'road' as const, edges: [6, 6] as [number, number] }
    const z = [100, 101, 102, 101]
    const tops: any[] = []
    deckMesh(chain, z, [99, 99, 99, 99], points[0], { surface: [0, 0, 0], concrete: [1, 1, 1], parapet: [1, 1, 1] }, deckMeshOut(), undefined, undefined, tops)
    const surface = { points, z, d: along(points), width: 13, bounds: boundsOf(points, 7), kind: 'road' as const, tops, edges: [points.map(([x, y]) => [x, y + 6 * M] as Point), points.map(([x, y]) => [x, y - 6 * M] as Point)] as [Point[], Point[]] }
    const ring = [at(5, -3), at(25, -3), at(25, 3), at(5, 3)]
    const mesh = deckMeshOut()
    layPaint(mesh, [{ props: { kind: 'surface', pattern: 'fill', color: 'asphalt' }, runs: [], areas: [[ring]] }], [surface], colors, points[0])
    const p = mesh.position
    let area = 0
    for (let k = 0; k < p.length; k += 9) area += Math.abs((p[k + 3] - p[k]) * (p[k + 7] - p[k + 1]) - (p[k + 6] - p[k]) * (p[k + 4] - p[k + 1])) / 2 / (M * M)
    expect(area).toBeCloseTo(120, 0)
    for (let k = 0; k < p.length; k += 3) {
      const x = p[k] / M
      const expected = x <= 10 ? 100 + x / 10 : 101 + (Math.min(x, 20) - 10) / 10
      if (x < 20) expect(p[k + 2] * metresPerUnit(y0)).toBeCloseTo(expected + 0.01, 2)
    }
  })

  test('is never laid on a railway deck', () => {
    const points = line(0, 10, 20, 30)
    const surface = testSurface(points, [100, 101, 102, 101], [99, 99, 99, 99], 6, { kind: 'rail' })
    const mesh = deckMeshOut()
    layPaint(mesh, [{ props: { kind: 'surface', pattern: 'fill', color: 'asphalt' }, runs: [], areas: [[[at(5, -3), at(25, -3), at(25, 3), at(5, 3)]]] }], [surface], colors, points[0])
    expect(mesh.position.length).toBe(0)
  })
})

describe('subtractConvex', () => {
  test('leaves exactly the area outside the hole, and ignores an edge of no length', async () => {
    const { subtractConvex } = await import('./decks')
    const tri = [at(0, 0), at(10, 0), at(0, 10)]
    const hole = [at(0, 0), at(5, 0), at(5, 0), at(5, 5), at(0, 5)]
    const area = (p: Point[]) => Math.abs(p.reduce((a, q, i) => a + q[0] * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * q[1], 0)) / 2 / (M * M)
    expect(subtractConvex(tri, hole).reduce((a, p) => a + area(p), 0)).toBeCloseTo(50 - 25, 1)
  })
})

describe('jointAreas', () => {
  test('paves the wedge between two square ends that bend at a node', async () => {
    const { jointAreas, inside } = await import('./decks')
    // The bridge runs east from x=0, the road on the ground leaves it bent 5 degrees, each ending square to itself.
    const t = Math.tan((5 * Math.PI) / 180)
    const bridge = [at(0, -3), at(30, -3), at(30, 3), at(0, 3)]
    const road = [at(0 + 3 * t, -3), at(0 - 3 * t, 3), at(-30, 3 - 30 * t), at(-30, -3 - 30 * t)]
    const [joint] = jointAreas([{ p: at(0, 0), out: [-1, 0], half: 4 }], [bridge, road])
    expect(joint).toBeDefined()
    expect(inside(at(-0.1, 2.9), [joint])).toBe(true)
    expect(inside(at(0, 6), [joint])).toBe(false)
  })
})

describe('landedOn', () => {
  const points = line(0, 6, 12, 18, 24, 30, 36, 42, 48)
  const chain = { points, grounded: [true, true] as [boolean, boolean], layer: 1, width: 12, kind: 'road' as const, edges: [6, 6] as [number, number] }
  const z = [100, 101, 102, 103, 104, 103, 102, 101, 100]

  test('brings a grounded end to the ground drawn there, easing in along the deck', () => {
    const out = landedOn(chain, z, p => (p[0] < points[4][0] ? 99.2 : 100))
    expect(out[0]).toBeCloseTo(99.2, 6)
    expect(out[4]).toBeCloseTo(104, 6)
    expect(out[8]).toBeCloseTo(100, 6)
    expect(out[1]).toBeGreaterThan(99.2 + 1 - 0.8)
  })

  test('leaves an end in a hollow the drawn ground does not show', () => {
    expect(landedOn(chain, z, () => 97)).toEqual(z)
    expect(landedOn({ ...chain, grounded: [false, false] }, z, () => 99.5)).toEqual(z)
  })
})

describe('the road beyond a deck laid on its end', () => {
  const points = line(0, 10, 20, 30)
  const surface = testSurface(points, [100, 100, 100, 100], [99.5, 99.5, 99.5, 99.5])
  const laid = (run: Point[]) => {
    const mesh = deckMeshOut()
    layPaint(mesh, [{ props: { kind: 'lane', pattern: 'solid', color: 'white' }, runs: [run], areas: [] }], [surface], colors, points[0], { atGrade: true })
    return mesh.position.length
  }

  test('takes the lines running with the deck', () => {
    expect(laid([at(1, 2), at(12, 2)])).toBeGreaterThan(0)
  })

  test('leaves out a road crossing it', () => {
    expect(laid([at(5, -5), at(5, 5)])).toBe(0)
  })
})

describe('joinedLines', () => {
  const props = { kind: 'centre', pattern: 'double', color: 'yellow' }
  const bridge = [{ props, runs: [[at(0, 0), at(10, 0), at(20, 0), at(30, 0)]], areas: [] }]

  test('eases a bridge line end onto the ground line beside it and cuts the ground line there', () => {
    const ground = [{ props, runs: [[at(25, 0.8), at(60, 0.8)]], areas: [] }]
    const joined = joinedLines(bridge, ground)
    const run = joined.bridge[0].runs[0]
    expect((run[run.length - 1][1] - y0) / M).toBeCloseTo(0.8, 6)
    expect((run[0][1] - y0) / M).toBeCloseTo(0, 6)
    expect((joined.ground[0].runs[0][0][0] - at(0)[0]) / M).toBeCloseTo(30, 6)
  })

  test('leaves a cross street whole', () => {
    const ground = [{ props, runs: [[at(31, -40), at(31, 40)]], areas: [] }]
    expect(joinedLines(bridge, ground).ground[0].runs[0]).toEqual(ground[0].runs[0])
  })

  test('eases a two-point bridge line over its last metres only', () => {
    const ground = [{ props, runs: [[at(25, 0.8), at(60, 0.8)]], areas: [] }]
    const run = joinedLines([{ props, runs: [[at(0, 0), at(30, 0)]], areas: [] }], ground).bridge[0].runs[0]
    expect((run[run.length - 1][1] - y0) / M).toBeCloseTo(0.8, 6)
    expect(run.filter(q => (q[0] - at(0)[0]) / M < 20).every(q => Math.abs(q[1] - y0) < 1e-12)).toBe(true)
  })

  test('leaves lines of another kind alone', () => {
    const ground = [{ props: { ...props, color: 'white' }, runs: [[at(25, 0.8), at(60, 0.8)]], areas: [] }]
    expect(joinedLines(bridge, ground).bridge[0].runs[0].every(q => Math.abs(q[1] - y0) < 1e-12)).toBe(true)
  })
})

describe('placedPiers', () => {
  const points = line(0, 30, 60, 90, 120)
  const chain = { points, grounded: [true, true] as [boolean, boolean], layer: 1, width: 12, kind: 'road' as const, edges: [6, 6] as [number, number] }
  const z = [100, 108, 108, 108, 100]
  const ground = [100, 100, 100, 100, 100]

  test('stands a pier every span where the deck is high, moved off what lies beneath', () => {
    expect(placedPiers(chain, z, ground, () => true)).toEqual([14, 42, 70, 98])
    const piers = placedPiers(chain, z, ground, at => Math.abs(at - 42) > 4)
    expect(piers).toContain(37)
    expect(piers.every(at => Math.abs(at - 42) > 4)).toBe(true)
  })
})

describe('jointAreas', () => {
  test('paves one wedge per lane when clustered', () => {
    const end = { p: at(0), out: [1, 0] as Point, half: 8 }
    const lane = (y: number) => [at(-1, y), at(0.5, y), at(0.5, y + 1.5), at(-1, y + 1.5)]
    expect(jointAreas([end], [lane(-6), lane(5)]).length).toBe(1)
    expect(jointAreas([end], [lane(-6), lane(5)], 2.5).length).toBe(2)
  })
})

describe('a bridge line past its deck\'s end', () => {
  test('is laid on the ground there, where the deck owns it', () => {
    const points = line(0, 10, 20, 30)
    const surface = testSurface(points, [100, 100, 100, 100], [99.5, 99.5, 99.5, 99.5])
    const mesh = deckMeshOut()
    const ground = { at: () => 99, near: [boundsOf([at(-20), at(0)], 3)], low: [0, 0, 0] }
    layPaint(mesh, [{ props: { kind: 'centre', pattern: 'solid', color: 'yellow' }, runs: [[at(-15), at(10)]], areas: [] }], [surface], colors, points[0], { ground })
    const xs = mesh.position.filter((_, k) => k % 3 === 0).map(v => v / M)
    const zs = mesh.position.filter((_, k) => k % 3 === 2).map(v => v * metresPerUnit(y0))
    expect(Math.min(...xs)).toBeLessThan(-14)
    expect(Math.min(...zs)).toBeCloseTo(99.04, 2)
  })
})

describe('paint at a deck end it owns', () => {
  const points = line(0, 10, 20, 30, 40, 50, 60, 70, 80)
  const zs = (mesh: ReturnType<typeof deckMeshOut>) => mesh.position.filter((_, k) => k % 3 === 2).map(v => v * metresPerUnit(y0))
  const lay = (surface: ReturnType<typeof testSurface>, run: Point[], g: number, past?: PastEnd[]) => {
    const mesh = deckMeshOut()
    const ground = { at: () => g, near: [boundsOf([at(-20), at(5)], 4)], low: [0, 0, 0] }
    layPaint(mesh, [{ props: { kind: 'centre', pattern: 'solid', color: 'yellow' }, runs: [run], areas: [] }], [surface], colors, points[0], { ground, past })
    return zs(mesh)
  }
  const low = testSurface(points, points.map(() => 100), points.map(() => 99.5))

  test('lies on the drawn ground where that stands over an at-grade end, never under the deck, and not mid-span', () => {
    expect(Math.max(...lay(low, [at(2), at(8)], 100.5))).toBeCloseTo(100.54, 2)
    expect(Math.max(...lay(low, [at(2), at(8)], 99))).toBeCloseTo(100.04, 2)
    expect(Math.max(...lay(low, [at(35), at(45)], 100.5))).toBeCloseTo(100.04, 2)
  })

  test('steps down to the ground off an at-grade end, but not off a high one', () => {
    expect(Math.min(...lay(low, [at(-10), at(6)], 99))).toBeCloseTo(99.04, 2)
    const high = testSurface(points, points.map(() => 108), points.map(() => 100))
    expect(lay(high, [at(-10), at(6)], 100).filter(z => z > 100.5 && z < 107.5)).toEqual([])
  })

  test('past a bridge\'s end leaves a deck high overhead alone', () => {
    const over = testSurface(line(-20, -10, 0, 10), [108, 108, 108, 108], [100, 100, 100, 100])
    const zsPast = lay(over, [at(-15), at(-5)], 100, [{ p: at(0), out: [-1, 0], reach: 20, half: 4 }])
    expect(Math.max(...zsPast)).toBeLessThan(101)
  })

  test('keeps a bridge\'s own paint on its high deck beside another way\'s end', () => {
    const over = testSurface(line(-20, -10, 0, 10), [108, 108, 108, 108], [100, 100, 100, 100])
    const zsOwn = lay(over, [at(-15), at(-5)], 100, [{ p: at(-10, 8), out: [0, 1], reach: 18, half: 10 }])
    expect(Math.max(...zsOwn)).toBeGreaterThan(107)
  })
})

describe('coveredSides', () => {
  test('marks the side of a deck lying on another road deck at its height, not one beside it', () => {
    const chain = (points: Point[]) => ({ points, grounded: [true, true] as [boolean, boolean], layer: 1, width: 10, kind: 'road' as const, edges: [5, 5] as [number, number] })
    const main = { chain: chain(line(0, 10, 20, 30, 40)), z: [10, 10, 10, 10, 10] }
    const across = { chain: chain([at(20, -3), at(20, 20)]), z: [10, 10] }
    const beside = { chain: chain([at(0, 40), at(40, 40)]), z: [10, 10] }
    const [, onAcross] = coveredSides([main, across, beside])
    expect(onAcross[1][0]).toBe(true)
    expect(onAcross[0][1]).toBe(false)
  })
})

describe('innerSides', () => {
  // As served: shaped, with its sides at every point.
  const chain = (points: Point[], kind: 'road' | 'path' | 'rail' = 'road') =>
    ({ points, grounded: [true, true] as [boolean, boolean], layer: 1, width: 10, kind, edges: [5, 5] as [number, number], sides: [points.map(() => 5), points.map(() => 5)] as [number[], number[]] })
  const outline = (rings: Point[][]) => ({ rings, bounds: boundsOf(rings[0]) })

  test('leaves a parapet only where a side lies along its bridge\'s outline', () => {
    // A road 5 m either side of y = 0, in an outline reaching 5 m to the south and 20 m to the north.
    const deck = { chain: chain(line(0, 10, 20, 30, 40)) }
    const [sides] = innerSides([deck], [outline([[at(-5, -5), at(45, -5), at(45, 20), at(-5, 20), at(-5, -5)]])])
    const north = sides.findIndex(side => side.slice(1, -1).every(Boolean))
    expect(north).toBeGreaterThanOrEqual(0)
    expect(sides[1 - north].some(Boolean)).toBe(false)
  })

  test('keeps the parapets of a deck passing under another bridge\'s outline, and of one the map does not shape', () => {
    // A long deck with only its middle fifth under the outline.
    const under = { chain: chain(line(-40, -30, -20, -10, 0, 10, 20, 30, 40, 50)) }
    const over = [outline([[at(-2, -20), at(12, -20), at(12, 20), at(-2, 20), at(-2, -20)]])]
    expect(innerSides([under], over)[0].flat().some(Boolean)).toBe(false)
    const { sides: _, ...unshaped } = chain(line(0, 10, 20, 30, 40))
    const around = [outline([[at(-5, -20), at(45, -20), at(45, 20), at(-5, 20), at(-5, -20)]])]
    expect(innerSides([{ chain: unshaped }], around)[0].flat().some(Boolean)).toBe(false)
  })

  test('keeps every parapet of a deck in no outline, and a rail deck\'s', () => {
    const far = [outline([[at(100, 100), at(120, 100), at(120, 120), at(100, 120), at(100, 100)]])]
    expect(innerSides([{ chain: chain(line(0, 10, 20)) }], far)[0].flat().some(Boolean)).toBe(false)
    const around = [outline([[at(-20, -20), at(60, -20), at(60, 20), at(-20, 20), at(-20, -20)]])]
    expect(innerSides([{ chain: chain(line(0, 10, 20), 'rail') }], around)[0].flat().some(Boolean)).toBe(false)
  })
})
