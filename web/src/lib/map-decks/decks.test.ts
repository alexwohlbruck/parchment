import { describe, test, expect } from 'vitest'
import { absorbPaths, arch, beside, besideGround, boundsOf, chains, covered, dedupe, clip, cutOut, parseLine, parseProfile, parseShape, deckMesh, densify, fitEdges, joinNeighbours, onDeck, rounded, smooth, solve, steady, along, COLUMN_SIDES, LAYER_CLEARANCE, MAX_GRADE, ROUND_TURN, type Chain, type Point } from './decks'

// About a metre in mercator units at Charlotte's latitude.
const M = 1 / 32780000
const y0 = 0.4012
const line = (...xs: number[]): Point[] => xs.map(x => [0.2789 + x * M, y0])
const chain = (points: Point[], grounded: [boolean, boolean], layer = 1): Chain =>
  ({ points, grounded, layer, width: 10, kind: 'road', edges: [5, 5] })
/** A line parallel to `line`, `metres` to the side `deckMesh` calls left. */
const offset = (metres: number, ...xs: number[]): Point[] => line(...xs).map(([x, y]) => [x, y + metres * M])

describe('chains', () => {
  test('pieces cut at a tile seam join back into one deck', () => {
    const whole = line(0, 40, 80, 120)
    const seam = whole[1][0] + 10 * M
    const west = clip(whole, { minX: 0, minY: 0, maxX: seam, maxY: 1 })
    const east = clip(whole, { minX: seam, minY: 0, maxX: 1, maxY: 1 })
    const joined = chains(
      [...west, ...east].map(points => ({ points, layer: 1, width: 10, kind: 'road' as const })),
      () => false,
      0.5 * M,
    )
    expect(joined).toHaveLength(1)
    expect(along(joined[0].points).at(-1)).toBeCloseTo(along(whole).at(-1)!, 0)
  })

  test('an end that meets another deck stays in the air; a free end lands', () => {
    const decks = chains([
      { points: line(0, 60), layer: 1, width: 10, kind: 'road' },
      { points: [line(60)[0], [line(60)[0][0], y0 + 80 * M]], layer: 2, width: 10, kind: 'road' },
    ], () => false, 0.5 * M)
    const low = decks.find(d => d.layer === 1)!
    expect(low.grounded).toEqual([true, false])
  })

  test('an end cut at the edge of the loaded tiles stays in the air', () => {
    const [deck] = chains([{ points: line(0, 60), layer: 1, width: 10, kind: 'road' }], p => p[0] > line(30)[0][0], 0.5 * M)
    expect(deck.grounded).toEqual([true, false])
  })
})

describe('solve', () => {
  const flat = (n: number) => Array(n).fill(100)

  test('an overpass between grounded embankments spans straight across', () => {
    const points = line(0, 30, 60)
    const z = solve(chain(points, [true, true]), [107, 100, 107])
    expect(z[0]).toBe(107)
    expect(z[2]).toBe(107)
    expect(z[1]).toBeCloseTo(107, 6)
  })

  test('a short footbridge on flat ground rises no steeper than a road may', () => {
    const points = line(0, 15, 30)
    const z = solve(chain(points, [true, true]), flat(3))
    expect(z[1] - 100).toBeCloseTo(MAX_GRADE * along(points)[1], 6)
  })

  test('a deck that carries on into another stays a layer up at that end', () => {
    const z = solve(chain(line(0, 200, 400), [true, false], 2), flat(3))
    expect(z[2]).toBe(100 + 2 * LAYER_CLEARANCE)
    expect(z[0]).toBe(100)
  })
})

describe('deck mesh and paint', () => {
  test('builds whole triangles, all above the ground', () => {
    const c = chain(line(0, 40, 80), [false, false])
    const z = solve(c, [100, 100, 100])
    const mesh = deckMesh(c, z, [100, 100, 100], c.points[0], { surface: [0, 0, 0], concrete: [1, 1, 1], parapet: [1, 1, 1] }, { position: [], normal: [], color: [] })
    expect(mesh.position.length % 9).toBe(0)
    expect(mesh.position.length).toBe(mesh.normal.length)
  })

  test('paint along a deck is lifted onto it, and off it stays on the ground', () => {
    const c = chain(line(0, 40, 80), [true, true])
    const z = solve(c, [100, 100, 100])
    const lifted = onDeck([...line(40), [0.2789 + 40 * M, y0 + 50 * M]], [{ points: c.points, z, d: along(c.points), width: 10 }], 0.05)
    expect(lifted[0]).toBeCloseTo(z[1] + 0.05, 6)
    expect(lifted[1]).toBeNull()
  })
})

describe('deck width', () => {
  test('a point beside a deck reads as on the side the mesh calls left', () => {
    expect(beside(line(0, 100), offset(6, 50)[0])).toMatchObject({ left: true, alongside: true })
    expect(beside(line(0, 100), offset(-6, 50)[0]).left).toBe(false)
    expect(beside(line(0, 100), line(130)[0]).alongside).toBe(false)
  })

  test('edges fit the kerbs, each side its own', () => {
    const road = chain(line(0, 100), [true, true])
    const [left, right] = fitEdges(road, [...offset(7, 10, 90), ...offset(-5, 10, 90)])
    expect(left).toBeCloseTo(7, 0)
    expect(right).toBeCloseTo(5, 0)
  })

  test('sidewalk bridges either side fold into the road deck', () => {
    const road = chain(line(0, 100), [true, true])
    const walk = (metres: number): Chain => ({ ...chain(offset(metres, 0, 100), [true, true]), kind: 'path', width: 2, edges: [1, 1] })
    const decks = absorbPaths([road, walk(8), walk(-8)])
    expect(decks).toHaveLength(1)
    expect(decks[0].edges[0]).toBeCloseTo(9, 0)
    expect(decks[0].edges[1]).toBeCloseTo(9, 0)
  })

  test('a footbridge of its own stays its own deck', () => {
    const road = chain(line(0, 100), [true, true])
    const far: Chain = { ...chain(offset(40, 0, 100), [true, true]), kind: 'path', width: 2, edges: [1, 1] }
    const across: Chain = { ...chain([line(50)[0], offset(30, 50)[0]], [true, true]), kind: 'path', width: 2, edges: [1, 1] }
    expect(absorbPaths([road, far, across])).toHaveLength(3)
  })
})

describe('deck profile', () => {
  test('a long span is sampled often enough to follow the ground under it', () => {
    const points = densify(line(0, 100), 6)
    expect(points.length).toBe(18)
    const d = along(points)
    for (let i = 1; i < d.length; i++) expect(d[i] - d[i - 1]).toBeLessThanOrEqual(6.01)
  })

  test('a deck over a rise in the middle of its span never dips into it', () => {
    const points = densify(line(0, 120), 6)
    const ground = along(points).map(d => 100 + Math.max(0, 8 - Math.abs(d - 60) / 4))
    const z = smooth(solve(chain(points, [true, true]), ground), along(points), ground)
    z.forEach((h, i) => expect(h).toBeGreaterThanOrEqual(ground[i]))
    expect(Math.max(...z)).toBeGreaterThan(107)
  })

  test('a long deck over uneven ground runs as one arch, without waves', () => {
    const points = densify(line(0, 900), 6)
    const d = along(points)
    const ground = d.map((x, i) => 100 + 1.5 * Math.sin(x / 40) + (i % 7 === 3 ? 4 : 0))
    const z = smooth(solve(chain(points, [true, true]), ground), d, steady(ground, d))
    // Never a sag: every height at least the lower of the highest either side of it.
    z.forEach((h, i) => expect(Math.min(Math.max(...z.slice(0, i + 1)), Math.max(...z.slice(i))) - h).toBeLessThan(0.01))
    for (let i = 1; i < z.length - 1; i++) expect(Math.abs(z[i + 1] - 2 * z[i] + z[i - 1])).toBeLessThan(0.05)
  })

  test('the arch is the least concave line over every point, through both ends', () => {
    expect(arch([0, 10, 20, 30, 40], [0, 5, 1, 5, 0])).toEqual([0, 5, 5, 5, 0])
  })

  test('a lone spike in the ground is read through', () => {
    expect(steady([1, 1, 1, 9, 1, 1], [0, 6, 12, 18, 24, 30])[3]).toBe(1)
  })

  test('easing takes the kink out of a ramp without lifting its ends', () => {
    const points = densify(line(0, 60), 6)
    const d = along(points)
    const raw = d.map(x => 100 + Math.max(0, x - 30) * 0.06)
    const eased = smooth(raw, d, d.map(() => 100))
    expect(eased[0]).toBe(raw[0])
    expect(eased.at(-1)).toBe(raw.at(-1))
    const kink = (zs: number[], i: number) => Math.abs(zs[i + 1] - 2 * zs[i] + zs[i - 1])
    const at = d.findIndex(x => x >= 30)
    expect(kink(eased, at)).toBeLessThan(kink(raw, at))
  })
})

describe('neighbouring decks', () => {
  const twin = (metres: number, z: number) => ({ chain: chain(offset(metres, 0, 50, 100), [true, true]), z: [z, z, z] })

  test('twin carriageways side by side lose the parapets between them and meet at one height', () => {
    const decks = [twin(0, 106), twin(10.5, 105.5)]
    const open = joinNeighbours(decks)
    expect(open[0][0]).toEqual([true, true, true])
    expect(open[0][1]).toEqual([false, false, false])
    expect(open[1][1]).toEqual([true, true, true])
    expect(decks[1].z).toEqual([106, 106, 106])
  })

  test('a deck crossing over another keeps its parapets', () => {
    const open = joinNeighbours([twin(0, 100), twin(10.5, 112)])
    expect(open.flat(2).some(Boolean)).toBe(false)
  })

  test('a shared side draws no parapet', () => {
    const c = chain(line(0, 40, 80), [false, false])
    const z = [106, 106, 106]
    const colors = { surface: [0, 0, 0], concrete: [1, 1, 1], parapet: [1, 1, 1] }
    const both = deckMesh(c, z, [100, 100, 100], c.points[0], colors, { position: [], normal: [], color: [] })
    const one = deckMesh(c, z, [100, 100, 100], c.points[0], colors, { position: [], normal: [], color: [] }, [[true, true, true], [false, false, false]])
    expect(one.position.length).toBeLessThan(both.position.length)
  })
})

describe('dedupe', () => {
  const box = (from: number, to: number) => ({ minX: line(from)[0][0], minY: 0, maxX: line(to)[0][0], maxY: 1 })
  const piece = (points: Point[], zoom: number, tile = box(-1000, 1000)) =>
    ({ points, layer: 1, width: 10, kind: 'road' as const, zoom, tile })

  test('a bridge a closer tile also carries is kept only once', () => {
    const kept = dedupe([piece(line(0, 100), 13), piece(offset(1, 0, 100), 14, box(-500, 500))])
    expect(kept).toHaveLength(1)
    expect(kept[0].zoom).toBe(14)
  })

  test('what is left of a parent meets the closer tile at its edge and joins it', () => {
    const child = box(-500, 100)
    const kept = dedupe([piece(line(0, 200), 13), ...clip(offset(0.5, 0, 200), child).map(p => piece(p, 14, child))])
    const parent = kept.find(p => p.zoom === 13)!
    expect(parent.points[0][0]).toBeCloseTo(line(100)[0][0], 12)
    expect(chains(kept, () => false, 1.5 * M)).toHaveLength(1)
  })

  test('tiles side by side at different zooms both keep their pieces', () => {
    const kept = dedupe([piece(line(0, 100), 13, box(-500, 100)), piece(line(100, 200), 14, box(100, 500))])
    const span = along(line(0, 100)).at(-1)!
    expect(kept.map(p => along(p.points).at(-1)!)).toEqual([expect.closeTo(span, 6), expect.closeTo(span, 6)])
  })
})

describe('cutOut', () => {
  test('keeps the stretches either side of a box', () => {
    const runs = cutOut(line(0, 100), { minX: line(40)[0][0], minY: 0, maxX: line(60)[0][0], maxY: 1 })
    const span = along(line(0, 40)).at(-1)!
    expect(runs.map(r => along(r).at(-1)!)).toEqual([expect.closeTo(span, 6), expect.closeTo(span, 6)])
  })
})

describe('besideGround', () => {
  test('a bank beside the abutment does not lift the deck end', () => {
    const d = [0, 6, 12, 60, 108, 114, 120]
    const centre = d.map(() => 100)
    const bank = d.map(() => 104)
    const g = besideGround(centre, bank, centre, d)
    expect(g[0]).toBe(100)
    expect(g[1]).toBeCloseTo(100 + MAX_GRADE * 6, 6)
    expect(g[3]).toBeCloseTo(100 + MAX_GRADE * 60, 6)
  })
})

describe('served profiles', () => {
  test('decimetres to metres', () => {
    expect(parseProfile('2054,2061,-5')).toEqual([205.4, 206.1, -0.5])
    expect(parseProfile(undefined)).toEqual([])
  })

  test('exact samples from lng,lat and steps in 1e-7 degrees', () => {
    expect(parseLine('-808469645,352217126;-182,187')).toEqual([[-80.8469645, 35.2217126], [-80.8469827, 35.2217313]])
  })
})

describe('covered', () => {
  test('a basemap bridge lying on a served deck is drawn already; one beside it is not', () => {
    const deck = chain(line(0, 100), [true, true])
    const served = [{ chain: deck, bounds: boundsOf(deck.points, 8) }]
    const piece = (points: Point[]) => ({ points, layer: 1, width: 10, kind: 'road' as const })
    expect(covered(piece(offset(1, 0, 50, 100)), served)).toBe(true)
    expect(covered(piece(offset(20, 0, 50, 100)), served)).toBe(false)
  })
})

describe('deckMesh structure', () => {
  const colors = { surface: [0, 0, 0], concrete: [1, 1, 1], parapet: [0.5, 0.5, 0.5] }
  const mesh = () => ({ position: [] as number[], normal: [] as number[], color: [] as number[] })
  const triangles = (m: ReturnType<typeof mesh>, shade: number) => m.color.filter((_, i) => i % 9 === 0 && m.color[i] === shade).length

  test('a deck running at the ground is just road: no slab, parapets or piers', () => {
    const c = chain(line(0, 40, 80), [true, true])
    const m = deckMesh(c, [100.2, 100.3, 100.2], [100, 100, 100], c.points[0], colors, mesh())
    expect(triangles(m, 0)).toBe(4)
    expect(triangles(m, 1) + triangles(m, 0.5)).toBe(0)
  })

  test('piers stand where they are given', () => {
    const c = chain(line(0, 40, 80), [true, true])
    const m = deckMesh(c, [110, 110, 110], [100, 100, 100], c.points[0], colors, mesh(), [[], []], [20])
    const spaced = deckMesh(c, [110, 110, 110], [100, 100, 100], c.points[0], colors, mesh())
    const slab = 3 * 2 * 2
    // A round column of COLUMN_SIDES faces under a cap beam: four sides and its underside.
    const pier = COLUMN_SIDES * 2 + 5 * 2
    expect(triangles(m, 1) - slab).toBe(pier)
    expect(triangles(spaced, 1) - slab).toBe(pier * 3)
  })

  test('a wide deck stands on a bent of columns, a narrow one on one', () => {
    const wide = { ...chain(line(0, 40, 80), [true, true]), edges: [12, 12] as [number, number] }
    const m = deckMesh(wide, [110, 110, 110], [100, 100, 100], wide.points[0], colors, mesh(), [[], []], [20])
    const slab = 3 * 2 * 2
    expect(triangles(m, 1) - slab).toBe(2 * COLUMN_SIDES * 2 + 5 * 2)
  })
})

describe('decks following their outline', () => {
  const colors = { surface: [0, 0, 0], concrete: [1, 1, 1], parapet: [0.5, 0.5, 0.5] }
  /** The deck surface's corners, in metres from the deck's start: [along, to the left]. */
  const surface = (c: Chain) => {
    const m = deckMesh(c, [110, 110, 110], [100, 100, 100], c.points[0], colors, { position: [], normal: [], color: [] })
    const corners: Array<[number, number]> = []
    for (let k = 0; k < m.position.length; k += 3)
      if (m.color[k] === 0) corners.push([Math.round(m.position[k] / M), Math.round(m.position[k + 1] / M)])
    return corners
  }

  test('each side reaches as far as its own edge at every vertex', () => {
    const c: Chain = { ...chain(line(0, 40, 80), [true, true]), sides: [[6, 10, 6], [4, 4, 8]] }
    const corners = surface(c)
    const at = (x: number) => corners.filter(([along]) => along === x).map(([, left]) => left)
    expect(Math.max(...at(0))).toBe(6)
    expect(Math.min(...at(0))).toBe(-4)
    expect(Math.max(...at(40))).toBe(10)
    expect(Math.min(...at(80))).toBe(-8)
  })

  test('ends meet the outline: a side runs on past its end, or stops short of it', () => {
    const c: Chain = { ...chain(line(0, 40, 80), [true, true]), caps: [-5, 10, 0, 0] }
    const corners = surface(c)
    const left = corners.filter(([, side]) => side > 0).map(([along]) => along)
    const right = corners.filter(([, side]) => side < 0).map(([along]) => along)
    expect(Math.min(...left)).toBe(-5)
    expect(Math.min(...right)).toBe(10)
    expect(Math.max(...left, ...right)).toBe(80)
  })

  test('twin carriageways whose edges meet lose the parapet between them', () => {
    // Centrelines 12 m apart: 5 m edges leave a gap, edges reaching 6 m in do not.
    const twin = (sides?: [number[], number[]]) => [
      { chain: { ...chain(line(0, 40, 80), [true, true]), ...(sides ? { sides } : {}) }, z: [110, 110, 110] },
      { chain: { ...chain(offset(12, 0, 40, 80), [true, true]), ...(sides ? { sides: [sides[1], sides[0]] as [number[], number[]] } : {}) }, z: [110, 110, 110] },
    ]
    expect(joinNeighbours(twin())[0][0].some(Boolean)).toBe(false)
    expect(joinNeighbours(twin([[6, 6, 6], [5, 5, 5]]))[0][0].every(Boolean)).toBe(true)
  })

  test('a served deck takes its shape only from rows that carry one for every sample', () => {
    const shaped = { format: 2, left_edges: '60,62,65', right_edges: '40,40,41', caps: '-12,8,0,0' }
    expect(parseShape(shaped, 3)).toEqual({ sides: [[6, 6.2, 6.5], [4, 4, 4.1]], caps: [-1.2, 0.8, 0, 0] })
    expect(parseShape({ ...shaped, format: 1 }, 3)).toEqual({})
    expect(parseShape({ format: 2 }, 3)).toEqual({})
    expect(parseShape(shaped, 4)).toEqual({})
  })
})

describe('rounded', () => {
  test('fills in a curve so no two vertices turn more than ROUND_TURN, keeping its ends and straights', () => {
    // A quarter circle of radius 40 m in 6 m chords, as decks are served, then a straight.
    const steps = Math.round((40 * Math.PI) / 2 / 6)
    const arc: Point[] = Array.from({ length: steps + 1 }, (_, k) => {
      const a = (k / steps) * (Math.PI / 2)
      return [0.2789 + 40 * Math.sin(a) * M, y0 + 40 * (1 - Math.cos(a)) * M]
    })
    const points: Point[] = [...arc, [arc[steps][0], arc[steps][1] + 60 * M]]
    const c = chain(points, [true, true])
    const z = points.map((_, i) => 100 + i)
    const r = rounded(c, z, z.map(() => 90))
    expect(r.chain.points.length).toBeGreaterThan(points.length)
    expect(r.chain.points[0]).toEqual(points[0])
    expect(r.chain.points.at(-1)).toEqual(points.at(-1))
    expect(r.z.length).toBe(r.chain.points.length)
    const p = r.chain.points
    for (let i = 1; i < p.length - 1; i++) {
      const [ux, uy, vx, vy] = [p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1], p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]]
      expect(Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy))).toBeLessThanOrEqual(ROUND_TURN * 1.1)
    }
    const straight = chain(line(0, 50, 100), [true, true])
    expect(rounded(straight, [1, 2, 3], [0, 0, 0]).chain).toBe(straight)
  })
})
