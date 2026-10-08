import { describe, test, expect } from 'vitest'
import { buildExclusions, forestTree, plantForest, polygonsOf, spansAt, woodFamily, CROWN_SUFFIX, FOREST_SPACING, type WoodTags } from './forest'
import { TREE_FAMILIES } from './trees'

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

  test('interior trees draw only their crowns; sparse ones stay whole and grow wider', () => {
    const edge = forestTree(0, 0, 4, 7)
    expect(edge.model.endsWith(CROWN_SUFFIX)).toBe(false)
    expect(forestTree(0, 0, 4, 7, { interior: true }).model).toBe(`${edge.model}${CROWN_SUFFIX}`)
    const sparse = forestTree(0, 0, 4, 7, { interior: true, sparse: true })
    expect(sparse.model).toBe(edge.model)
    expect(sparse.spread).toBeGreaterThan(edge.spread)
  })

  describe('what the wood says grows in it', () => {
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
      expect(woodFamily({ genus: 'Pinus', leaf_type: 'mixed' }, 1, 2)).toBe('conifer')
      expect(woodFamily({ genus: 'Phoenix' }, 1, 2)).toBe('palm')
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
      expect(TREE_FAMILIES.palm).toContain(tree.model)
    })
  })
})
