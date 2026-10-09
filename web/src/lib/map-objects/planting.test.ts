import { describe, test, expect } from 'vitest'
import { blockedAlong, buildExclusions, plant, polygonsOf, spansAt, MERCATOR_METRE } from './planting'
import { forestTree, woodFamily, CROWN_SUFFIX, FOREST_GRID, type WoodTags } from './forest'
import { TREE_FAMILIES } from './trees'

const plantForest = (rings: any, bounds: any, ex: any) => plant(rings, bounds, ex, FOREST_GRID)
const FOREST_SPACING = FOREST_GRID.dx * MERCATOR_METRE

const square = (w: number, s: number, e: number, n: number) => ({
  type: 'Polygon',
  coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]],
})
const wood = polygonsOf(square(-80.85, 35.2, -80.845, 35.204))[0]
const everywhere = { minX: 0, minY: 0, maxX: 1, maxY: 1 }

describe('forest planting', () => {
  test('a ring with a hole gives two spans across the hole', () => {
    const rings = polygonsOf({
      type: 'Polygon',
      coordinates: [square(0, 0, 10, 10).coordinates[0], square(4, 4, 6, 6).coordinates[0]],
    })[0]
    expect(spansAt(rings, rings[0][0][1] + (rings[0][2][1] - rings[0][0][1]) / 2)).toHaveLength(2)
  })

  test('plants roughly one tree per grid cell inside the wood', () => {
    const trees = plantForest(wood, everywhere, buildExclusions([], []))
    const [x0, , x1] = [wood[0][0][0], 0, wood[0][1][0]]
    const cells = ((x1 - x0) / FOREST_SPACING) * ((wood[0][0][1] - wood[0][2][1]) / FOREST_SPACING)
    expect(trees.length).toBeGreaterThan(cells * 0.9)
    expect(trees.length).toBeLessThan(cells * 1.1)
  })

  test('is the same forest every time', () => {
    const ex = buildExclusions([], [])
    expect(plantForest(wood, everywhere, ex)).toEqual(plantForest(wood, everywhere, ex))
  })

  test('keeps clear of a road through it and a building inside it', () => {
    const road = { properties: { class: 'primary' }, geometry: { type: 'LineString', coordinates: [[-80.851, 35.202], [-80.844, 35.202]] } }
    const building = { geometry: square(-80.8495, 35.2005, -80.8485, 35.2012) }
    const trees = plantForest(wood, everywhere, buildExclusions([road], [building]))
    for (const [lng, lat] of trees) {
      expect(Math.abs(lat - 35.202) * 111000 > 9, `${lng},${lat}`).toBe(true)
      const inBuilding = lng > -80.8495 && lng < -80.8485 && lat > 35.2005 && lat < 35.2012
      expect(inBuilding).toBe(false)
    }
  })

  test('grows on under a bridge', () => {
    const coordinates = [[-80.851, 35.202], [-80.844, 35.202]]
    const road = { properties: { class: 'primary' }, geometry: { type: 'LineString', coordinates } }
    const bridge = { properties: { class: 'primary', brunnel: 'bridge' }, geometry: { type: 'LineString', coordinates } }
    const all = plantForest(wood, everywhere, buildExclusions([], []))
    expect(plantForest(wood, everywhere, buildExclusions([bridge], []))).toEqual(all)
    expect(plantForest(wood, everywhere, buildExclusions([road], [])).length).toBeLessThan(all.length)
  })

  test('two tiles of one wood plant disjoint sets', () => {
    const mid = (wood[0][0][0] + wood[0][1][0]) / 2
    const ex = buildExclusions([], [])
    const west = plantForest(wood, { ...everywhere, maxX: mid }, ex)
    const east = plantForest(wood, { ...everywhere, minX: mid }, ex)
    const all = plantForest(wood, everywhere, ex)
    expect(west.length + east.length).toBe(all.length)
  })

  test('only trees well inside the wood are interior', () => {
    const road = { properties: { class: 'primary' }, geometry: { type: 'LineString', coordinates: [[-80.851, 35.202], [-80.844, 35.202]] } }
    const trees = plantForest(wood, everywhere, buildExclusions([road], []))
    const metres = (a: number, b: number) => Math.abs(a - b) * 111000
    for (const [lng, lat, , , interior] of trees) {
      const fromEdge = Math.min(
        metres(lat, 35.2), metres(lat, 35.204), metres(lat, 35.202),
        metres(lng, -80.85) * 0.82, metres(lng, -80.845) * 0.82,
      )
      if (fromEdge < 15) expect(interior, `${lng},${lat}`).toBe(false)
      if (fromEdge > 50) expect(interior, `${lng},${lat}`).toBe(true)
    }
    expect(trees.some(t => t[4])).toBe(true)
  })

  test('interior trees draw only their crowns; sparse ones stay whole and grow larger', () => {
    const edge = forestTree(0, 0, 4, 7)
    expect(edge.model.endsWith(CROWN_SUFFIX)).toBe(false)
    expect(forestTree(0, 0, 4, 7, { interior: true, sparse: false }).model).toBe(`${edge.model}${CROWN_SUFFIX}`)
    const sparse = forestTree(0, 0, 4, 7, { interior: true, sparse: true })
    expect(sparse.model).toBe(edge.model)
    expect(sparse.spread).toBeGreaterThan(edge.spread)
    expect(sparse.height).toBeGreaterThan(edge.height)
  })

  describe('by what the wood holds', () => {
    const cells = Array.from({ length: 2000 }, (_, k) => [k % 50, Math.floor(k / 50)] as const)
    const broadleafShare = (wood: WoodTags) =>
      cells.filter(([i, j]) => woodFamily(wood, i, j) === 'broadleaf').length / cells.length

    test('a needleleaved wood is all conifers, a broadleaved or leafless one all broadleaves', () => {
      expect(broadleafShare({ leaf_type: 'needleleaved' })).toBe(0)
      expect(broadleafShare({ leaf_type: 'broadleaved' })).toBe(1)
      expect(broadleafShare({ leaf_type: 'leafless' })).toBe(1)
    })

    test('a mixed wood is about half and half; an untagged one keeps the broadleaf-heavy mix', () => {
      expect(broadleafShare({ leaf_type: 'mixed' })).toBeCloseTo(0.5, 1)
      expect(broadleafShare({})).toBeCloseTo(0.7, 1)
    })

    test('a genus outranks the leaf type', () => {
      expect(woodFamily({ genus: 'Pinus', leaf_type: 'mixed' }, 1, 2)).toBe('pine')
      expect(woodFamily({ genus: 'Phoenix' }, 1, 2)).toBe('datePalm')
      expect(woodFamily({ genus: 'Quercus' }, 1, 2)).toBe('broadleaf')
    })

    test('a needleleaved wood plants conifer models, and its interior keeps their crowns', () => {
      const wood = { leaf_type: 'needleleaved' }
      for (const [i, j] of cells.slice(0, 50)) {
        const edge = forestTree(0, 0, i, j, { wood })
        expect(TREE_FAMILIES.conifer).toContain(edge.model)
        expect(forestTree(0, 0, i, j, { wood, interior: true }).model).toBe(`${edge.model}${CROWN_SUFFIX}`)
      }
    })

    test('a palm, which has no crown model, stands whole inside a wood', () => {
      const tree = forestTree(0, 0, 1, 2, { wood: { genus: 'Phoenix' }, interior: true })
      expect(TREE_FAMILIES.datePalm).toContain(tree.model)
    })
  })
})

describe('blocked spans along a line', () => {
  test('match a point-by-point clearance check for ways at any angle', () => {
    const rnd = (k: number) => ((Math.sin(k * 12.9898) * 43758.5453) % 1 + 1) % 1
    const ways = Array.from({ length: 12 }, (_, k) => ({
      properties: { class: 'service' },
      geometry: { type: 'LineString', coordinates: [[-80 + rnd(k) * 0.002, 35 + rnd(k + 50) * 0.002], [-80 + rnd(k + 100) * 0.002, 35 + rnd(k + 150) * 0.002]] },
    }))
    const ex = buildExclusions(ways, [])
    const segs = ways.map(w => polygonsOf({ type: 'Polygon', coordinates: [w.geometry.coordinates] })[0][0])
    const pad = 1.5 * MERCATOR_METRE
    const r = 6 * MERCATOR_METRE + pad
    const [x0, x1] = [segs.flat().reduce((m, p) => Math.min(m, p[0]), 1), segs.flat().reduce((m, p) => Math.max(m, p[0]), 0)]
    const [ya, yb] = [segs.flat().reduce((m, p) => Math.min(m, p[1]), 1), segs.flat().reduce((m, p) => Math.max(m, p[1]), 0)]
    const distance = (x: number, y: number, [a, b]: number[][]) => {
      const [dx, dy] = [b[0] - a[0], b[1] - a[1]]
      const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)))
      return Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y)
    }
    let mismatches = 0
    for (let row = 0; row < 20; row++) {
      const y = ya + ((yb - ya) * row) / 19
      const blocked = blockedAlong(ex, y, x0, x1, pad)
      for (let k = 0; k <= 400; k++) {
        const x = x0 + ((x1 - x0) * k) / 400
        const near = segs.map(s => distance(x, y, s)).filter(d => Math.abs(d - r) > r * 1e-3)
        if (near.length < segs.length) continue
        const expected = near.some(d => d < r)
        if (blocked.some(([a, b]) => x >= a && x <= b) !== expected) mismatches++
      }
    }
    expect(mismatches).toBe(0)
  })
})
