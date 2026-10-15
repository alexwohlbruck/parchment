import { describe, test, expect } from 'vitest'
import { absorbPaths, absorbTracks, deckMeshOut, standing, touchdown, underWay, TOUCHDOWN, SEAM, UNDER_SLACK, metresPerUnit, arch, beside, besideGround, boundsOf, chains, covered, dedupe, clip, cutOut, parseLine, parseProfile, parseShape, deckMesh, densify, fitEdges, joinNeighbours, onDeck, onOwnDeck, rounded, smooth, solve, steady, along, COLUMN_SIDES, LAYER_CLEARANCE, MAX_GRADE, ROUND_TURN, type Chain, type Point } from './decks'

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

  test('a carriageway never folds back onto the slip road it meets at a gore', () => {
    const main = line(60, 0)
    const slip: Point[] = [main[0], [main[1][0], y0 + 12 * M]]
    const joined = chains([
      { points: main, layer: 1, width: 10, kind: 'road', road: 'secondary' },
      { points: slip, layer: 1, width: 10, kind: 'road', road: 'secondary_link' },
    ], () => false, 0.5 * M)
    expect(joined).toHaveLength(2)
  })

  test('a footbridge that doubles back at a landing is still one deck', () => {
    const up = line(0, 40)
    const back: Point[] = [up[1], [up[0][0], y0 + 4 * M]]
    const joined = chains([up, back].map(points => ({ points, layer: 1, width: 3, kind: 'path' as const })), () => false, 0.5 * M)
    expect(joined).toHaveLength(1)
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

describe('paint where decks cross', () => {
  const at = (...xy: Array<[number, number]>): Point[] => xy.map(([x, y]) => [0.2789 + x * M, y0 + y * M])
  const surface = (points: Point[], height: number, width: number) => ({ points: densify(points, 6), z: densify(points, 6).map(() => height), d: along(densify(points, 6)), width })
  const fdr = surface(line(0, 200), 8, 20)
  const bridge = surface(at([100, -60], [100, 60]), 16, 30)
  const levels = (lines: Point[][], decks: ReturnType<typeof surface>[], across = false, rings: Point[][] = []) => {
    const orders = [decks, [...decks].reverse()].map(order => {
      const { lines: z, rings: zr } = onOwnDeck(lines.map(l => densify(l, 3)), rings, order, { across })
      return [...new Set([...z, ...zr].flat().map(v => v?.toFixed(2)))]
    })
    expect(orders[0]).toEqual(orders[1])
    return orders[0]
  }

  test('the lower road keeps its paint under the deck that crosses it', () => {
    const lane = offset(6, 0, 200)
    expect(new Set(onDeck(densify(lane, 3), [fdr, bridge], 0))).toContain(16)
    expect(levels([lane], [fdr, bridge])).toEqual(['8.00'])
  })

  test('the upper deck keeps its paint over the road beneath', () => {
    const edge = at([112, -60], [112, 60])
    expect(new Set(onDeck(densify(edge, 3), [fdr, bridge], 0))).toContain(8)
    expect(levels([edge], [fdr, bridge])).toEqual(['16.00'])
  })

  test('a stop line across the lower road stays on it, drawn or filled', () => {
    expect(levels([at([100, -4], [100, 4])], [fdr, bridge], true)).toEqual(['8.00'])
    expect(levels([], [fdr, bridge], true, [at([99.8, -4], [99.8, 4], [100.2, 4], [100.2, -4], [99.8, -4])])).toEqual(['8.00'])
  })

  test('a short piece of lane stays on its road under a shallow crossing', () => {
    const shallow = surface(at([100 - 60 * Math.cos(0.35), -60 * Math.sin(0.35)], [100 + 60 * Math.cos(0.35), 60 * Math.sin(0.35)]), 16, 20)
    expect(levels([offset(6, 90, 110)], [fdr, shallow])).toEqual(['8.00'])
  })

  test('a route mostly over the bridge stays on the road where it passes under', () => {
    const route = at([100, 60], [100, 15], [80, 0], [150, 0])
    const under = onOwnDeck([densify(route, 3)], [], [fdr, bridge], { centred: true }).lines[0].filter((_, i, all) => i > all.length - 15)
    expect(new Set(under)).toEqual(new Set([8]))
  })

  test('a route turning onto a climbing ramp follows the ramp up without a step', () => {
    const turn = 0.07
    const ramp = densify(at([200, 0], [200 + 200 * Math.cos(turn), 200 * Math.sin(turn)]), 6)
    const climbing = { points: ramp, z: along(ramp).map(d => 8 + (8 * d) / along(ramp).at(-1)!), d: along(ramp), width: 10 }
    const main = surface(line(-600, 600), 8, 20)
    const route = densify([...line(-600, 200), ramp.at(-1)!], 3)
    const z = onOwnDeck([route], [], [main, climbing], { centred: true }).lines[0] as number[]
    const steps = z.slice(1).map((v, i) => Math.abs(v - z[i]))
    expect(Math.max(...steps)).toBeLessThan(0.5)
    expect(z.at(-1)).toBeCloseTo(16, 0)
  })

  test('a wide twin deck overlapping a road does not take its paint', () => {
    expect(levels([offset(3, 0, 200)], [surface(offset(-10, 0, 200), 13, 31), surface(line(0, 200), 9, 12)])).toEqual(['9.00'])
  })

  test('paint on one of two stacked decks stays on its own level', () => {
    const upper = surface(line(100, 300), 16, 20)
    expect(levels([offset(3, 0, 190)], [fdr, upper])).toEqual(['8.00'])
    expect(levels([offset(3, 110, 300)], [fdr, upper])).toEqual(['16.00'])
  })

  test('paint leading in from a joined deck keeps to its level ahead of the deck that wins it', () => {
    const joined = surface(offset(0, -40, 0), 8, 12)
    const stacked = surface(offset(6, -40, -10), 16, 12)
    expect(levels([offset(6, -38, 200)], [fdr, joined, stacked])).toEqual(['8.00'])
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

  test('twin tracks join each other but never a road beside them', () => {
    const rail = (metres: number, z: number) => {
      const t = twin(metres, z)
      return { ...t, chain: { ...t.chain, kind: 'rail' as const, edges: [2.5, 2.5] as [number, number] } }
    }
    const tracks = [rail(0, 106), rail(4, 106.5)]
    expect(joinNeighbours(tracks)[0][0]).toEqual([true, true, true])
    expect(tracks[0].z).toEqual([106.5, 106.5, 106.5])
    const road = { ...twin(7.5, 106.5), chain: { ...twin(7.5, 106.5).chain, edges: [2.5, 2.5] as [number, number] } }
    expect(joinNeighbours([rail(0, 106.5), road]).flat(2).some(Boolean)).toBe(false)
  })

  test('a shared side reaches a little under its neighbour', () => {
    const c = chain(line(0, 40, 80), [false, false])
    const colors = { surface: [0, 0, 0], concrete: [1, 1, 1], parapet: [1, 1, 1] }
    const ys = (open?: [boolean[], boolean[]]) => deckMesh(c, [106, 106, 106], [100, 100, 100], c.points[0], colors, deckMeshOut(), open).position.filter((_, k) => k % 3 === 1)
    const reach = (v: number[]) => Math.max(...v) / M
    expect(reach(ys([[true, true, true], [false, false, false]])) - reach(ys())).toBeCloseTo(SEAM, 1)
  })

  test('only the part under a neighbour dips, so the shared edge stays level with it', () => {
    const c = chain(line(0, 40, 80), [false, false])
    const out = deckMeshOut()
    deckMesh(c, [106, 106, 106], [100, 100, 100], c.points[0], { surface: [0, 0, 0], concrete: [1, 1, 1], parapet: [1, 1, 1] }, out, [[true, true, true], [false, false, false]])
    const top = out.position.flatMap((_, k) => (k % 3 === 0 && out.normal[k + 2] > 0.99 ? [[out.position[k + 1] / M, out.position[k + 2] * metresPerUnit(y0)]] : []))
      .filter(([, z]) => z > 105.9 && z < 106.5)
    const level = top.filter(([y]) => y <= 5.01).map(([, z]) => z)
    const under = top.filter(([y]) => y > 5.01).map(([, z]) => z)
    expect(Math.min(...level)).toBeCloseTo(106, 2)
    expect(Math.max(...under)).toBeLessThan(106)
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

describe('tracks in a road bridge', () => {
  const road = chain(line(0, 100), [true, true])
  const track = (metres: number, ...xs: number[]): Chain => ({ ...chain(offset(metres, ...xs), [true, true]), kind: 'rail', edges: [2.5, 2.5], width: 5 })

  test('a tram in the carriageway is the road deck\'s, not a deck of its own', () => {
    expect(absorbTracks([road, track(1.5, 0, 100)])).toEqual([road])
    expect(absorbTracks([road, track(9, 0, 100)])).toHaveLength(2)
    expect(absorbTracks([road, track(1.5, 0, 140)])).toHaveLength(2)
  })

  test('a served road deck covers the basemap tram that runs in it', () => {
    const served = [{ chain: road, bounds: boundsOf(road.points, 8) }]
    expect(covered({ points: offset(1.5, 0, 50, 100), layer: 1, width: 5, kind: 'rail' }, served)).toBe(true)
    expect(covered({ points: offset(1.5, 0, 50, 100), layer: 2, width: 5, kind: 'rail' }, served)).toBe(false)
  })
})

describe('deck touchdown', () => {
  test('a surface on the ground is drawn toward the eye, one standing clear of it is not', () => {
    expect(touchdown(0)).toBe(TOUCHDOWN.bias)
    expect(touchdown(TOUCHDOWN.fade)).toBe(0)
    expect(touchdown(8)).toBe(0)
  })

  test('every vertex keeps a low colour and a bias, and only the surface is biased', () => {
    const c = chain(line(0, 40, 80), [true, true])
    const out = deckMeshOut()
    deckMesh(c, [100, 104, 100], [100, 100, 100], c.points[0], { surface: [0, 0, 0], concrete: [1, 1, 1], parapet: [1, 1, 1], low: [0.9, 0.9, 0.9] }, out)
    expect(out.low.length).toBe(out.position.length)
    expect(out.bias.length * 3).toBe(out.position.length)
    const biased = out.bias.flatMap((b, k) => (b > 0 ? [k] : []))
    expect(biased.length).toBeGreaterThan(0)
    expect(biased.every(k => out.color[k * 3] === 0 && out.low[k * 3] === 0.9)).toBe(true)
  })
})

describe('standing on decks', () => {
  const deck = chain(line(0, 50, 100), [true, true])
  const surface = { points: deck.points, z: [100, 107, 100], d: along(deck.points), width: 11, bounds: boundsOf(deck.points, 6), ground: [100, 100, 100] }
  const decks = [{ chain: deck, surface }]

  test('an object on a deck stands at its surface, one off it on the ground', () => {
    expect(standing(decks, line(50)[0])).toEqual({ z: 107, height: 7 })
    expect(standing(decks, offset(9, 50)[0])).toBeNull()
  })

  test('a wire stands on a deck it runs with, not one it passes under', () => {
    expect(standing(decks, line(50)[0], [1, 0])?.z).toBe(107)
    expect(standing(decks, line(50)[0], [0, 1])).toBeNull()
  })
})

describe('ways under a deck', () => {
  const road = { points: line(0, 100), half: 5, bounds: boundsOf(line(0, 100), 5 + UNDER_SLACK) }

  test('a lamp beside a road under a deck is the road\'s; one over the road is the deck\'s', () => {
    expect(underWay([road], offset(6.5, 50)[0])).toBe(true)
    expect(underWay([road], offset(2, 50)[0])).toBe(false)
    expect(underWay([road], offset(5 + UNDER_SLACK + 1, 50)[0])).toBe(false)
  })

  test('a wire running with a road under a deck is the road\'s, one crossing it is not', () => {
    expect(underWay([road], offset(1, 50)[0], [1, 0])).toBe(true)
    expect(underWay([road], offset(1, 50)[0], [0, 1])).toBe(false)
  })
})

describe('the decks under a point', () => {
  test('the grid finds what a scan of every segment finds, at cell edges and across decks', () => {
    const decks = [0, 7, 30].map(north => {
      const points = offset(north, ...Array.from({ length: 30 }, (_, k) => k * 6.5))
      return { points, z: points.map((_, k) => 100 + k), d: along(points), width: 9 }
    })
    const scan = (p: Point) => {
      let best: number | null = null
      let distance = Infinity
      for (const deck of decks)
        for (let i = 1; i < deck.points.length; i++) {
          const [a, b] = [deck.points[i - 1], deck.points[i]]
          const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
          const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy)))
          const off = Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]) * metresPerUnit(p[1])
          if (off < deck.width / 2 + 0.5 && off < distance) [best, distance] = [deck.z[i - 1] + (deck.z[i] - deck.z[i - 1]) * t, off]
        }
      return best
    }
    const points: Point[] = []
    for (let x = -10; x < 200; x += 3.7) for (let y = -8; y < 40; y += 1.3) points.push(offset(y, x)[0])
    const lifted = onDeck(points, decks, 0)
    points.forEach((p, k) => {
      const want = scan(p)
      if (want === null) expect(lifted[k]).toBeNull()
      else expect(lifted[k]).toBeCloseTo(want, 6)
    })
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
