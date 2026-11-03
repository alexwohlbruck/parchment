import { describe, test, expect } from 'vitest'
import { along, densify, metresPerUnit, type Mesh, type Point } from '@/lib/map-decks/decks'
import { parseCut, portalMesh, type Cut, type PortalMesh } from './tunnels'

// About a metre in mercator units at New York's latitude.
const M = 1 / 30400000
const y0 = 0.3761
const x0 = 0.2944
/** A point `east` and `north` metres from the origin. */
const at = (east: number, north = 0): Point => [x0 + east * M, y0 - north * M]

/**
 * A portal at the origin, its road running out east and its bore 40 m in to
 * the west: dug 2.4 m below flat ground at 10 m, climbing back to it at a road's grade.
 */
function portalFixture(): { points: Point[]; portal: number; cut: Cut } {
  const outside = densify([at(120), at(0)], 3)
  const points = [...outside, ...densify([at(0), at(-40)], 3).slice(1)]
  const portal = outside.length - 1
  const d = along(points)
  const floor = points.map((_, i) => (i > portal ? 7.6 : Math.min(10, 7.6 + 0.06 * (d[portal] - d[i]))))
  const open = portal - 15
  const walls = [0, 1].map(() => floor.map((f, i) => (i > portal ? f + 5.4 : i <= open ? f : Math.max(10, f)))) as [number[], number[]]
  return { points, portal, cut: { floor, walls, open, crown: 13, headroom: 4.6, base: 7.6 } }
}

describe('parseCut', () => {
  const props = {
    id: 'road:1,2', kind: 'road', at: 2, open: 1, left_edge: 3.5, right_edge: 4,
    line: '-808340000,352250000;-1000,0;-1000,0;-1000,0', floor: '2000,1990,1980,1980', wall_left: '2000,2010,2034,2034', wall_right: '2000,2012,2034,2034',
    crown: 203.4, headroom: 4.6, base: 198, piers: '-5,5', face: '0.6,0.8',
  }

  test('reads a served cut: its line, heights in decimetres and piers in pairs', () => {
    const cut = parseCut(props)!
    expect(cut.points).toHaveLength(4)
    expect(cut.points[1][0]).toBeLessThan(cut.points[0][0])
    expect(cut.cut.floor).toEqual([200, 199, 198, 198])
    expect(cut.cut.walls[1][1]).toBeCloseTo(201.2)
    expect(cut.piers).toEqual([[-0.5, 0.5]])
    expect(cut.face).toEqual([0.6, 0.8])
    expect(cut.edges).toEqual([3.5, 4])
  })

  test('leaves out a cut whose heights do not match its line, or that opens past its portal', () => {
    expect(parseCut({ ...props, floor: '2000,1990' })).toBeNull()
    expect(parseCut({ ...props, open: 2 })).toBeNull()
    expect(parseCut({ ...props, kind: 'canal' })).toBeNull()
  })

  test('takes no piers or face where none are served', () => {
    const cut = parseCut({ ...props, piers: undefined, face: undefined })!
    expect(cut.piers).toBeUndefined()
    expect(cut.face).toBeUndefined()
  })
})

describe('portalMesh', () => {
  const mesh = (): Mesh => ({ position: [], normal: [], color: [] })
  const build = (face?: Point, edges: [number, number] = [4, 4], piers: Array<[number, number]> = []) => {
    const { points, portal, cut } = portalFixture()
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
