import { describe, test, expect } from 'vitest'
import { absorbPaths, beside, chains, clip, deckMesh, fitEdges, onDeck, solve, along, LAYER_CLEARANCE, MAX_GRADE, type Chain, type Point } from './decks'

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
