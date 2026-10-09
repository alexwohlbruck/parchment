import { describe, test, expect } from 'vitest'
import { blockedAlong, buildExclusions, falloff, keeps, latticeLevel, plant, plantingCamera, plantingLevel, polygonsOf, screenSpacing, spansAt, MERCATOR_METRE, type PlantedPoint } from './planting'
import { forestTree, levelGrowth, woodFamily, CROWN_SUFFIX, FOREST_GRID, type WoodTags } from './forest'
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

  test('thinned trees grow by level: the sparse scale at one level, gentler past it, capped', () => {
    expect(levelGrowth(0)).toEqual({ height: 1, spread: 1 })
    const [one, two, far] = [levelGrowth(1), levelGrowth(2), levelGrowth(9)]
    expect(forestTree(0, 0, 4, 7, { level: 1 }).height).toBeCloseTo(forestTree(0, 0, 4, 7, { sparse: true }).height)
    expect(two.height / one.height).toBeLessThan(one.height)
    expect(far).toEqual(levelGrowth(3))
  })

  test('a strided planting is the full planting on the coarser lattice', () => {
    const ex = buildExclusions([], [])
    const key = (t: PlantedPoint) => `${t[2]},${t[3]}`
    const full = plantForest(wood, everywhere, ex).filter(t => t[2] % 4 === 0 && t[3] % 4 === 0).map(key)
    expect(plant(wood, everywhere, ex, FOREST_GRID, 4).map(key)).toEqual(full)
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

describe('planting falloff', () => {
  const cell = FOREST_SPACING
  const camera = { x: 0, y: 0, altitude: 30 * cell, focal: 1266, spacing: 8 }
  const levelAt = (dx: number, dy: number) => falloff(screenSpacing(camera, dx * cell, dy * cell, cell), camera.spacing)

  test('full density while cells are wide apart on screen, one level per halving after', () => {
    expect(falloff(32, 8)).toBe(0)
    expect(falloff(8, 8)).toBeCloseTo(1)
    expect(falloff(2, 8)).toBeCloseTo(3)
    expect(falloff(32, 8, 1)).toBe(1)
  })

  test('cells closer to the camera are never thinner than those beyond them', () => {
    for (let d = 1; d < 2000; d *= 1.5) expect(levelAt(d * 1.5, 0)).toBeGreaterThanOrEqual(levelAt(d, 0))
    expect(levelAt(10, 0)).toBe(0)
  })

  test('full density out to the reach of the centre however far the camera, two levels per doubling past it', () => {
    const far = { ...camera, altitude: 400 * cell, focal: 900, spacing: 12 }
    const reach = 56 * cell
    expect(plantingLevel(far, [0, 0], reach, cell, reach * 0.99, 0)).toBe(0)
    expect(plantingLevel(far, [0, 0], reach, cell, reach * 2, 0)).toBeCloseTo(2)
    expect(plantingLevel(far, [0, 0], reach, cell, reach * 0.5, 0, 1)).toBe(1)
  })

  test('lattice level counts shared halvings', () => {
    expect(latticeLevel(3, 8)).toBe(0)
    expect(latticeLevel(4, 8)).toBe(2)
    expect(latticeLevel(0, 0)).toBe(16)
  })

  test('a wood running to the horizon costs a bounded number of trees', () => {
    const shownWithin = (radius: number) => {
      let n = 0
      for (let i = -radius; i <= radius; i++)
        for (let j = 0; j <= radius; j++)
          if (Math.hypot(i, j) < radius && keeps(i + 8192, j + 8192, levelAt(i + 0.5, j + 0.5))) n++
      return n
    }
    expect(shownWithin(1600)).toBeLessThan(shownWithin(400) * 1.3)
  })

  test('levels blend over a band rather than meeting at a ring, and never go below the floor', () => {
    const kept = (level: number, floor = 0) => {
      let n = 0, total = 0
      for (let i = 0; i < 4096; i += 2) for (let j = 1; j < 64; j += 2) { total++; if (keeps(i, j, level, floor)) n++ }
      return n / total
    }
    expect(kept(0.6)).toBe(1)
    expect(kept(1.1)).toBeGreaterThan(0.05)
    expect(kept(1.1)).toBeLessThan(0.95)
    expect(kept(1.4)).toBe(0)
    expect(kept(1, 1)).toBe(0)
  })

  test('the camera stands behind the centre, by the pitch, facing the bearing', () => {
    const map = {
      getCenter: () => ({ lng: 0, lat: 0 }), getZoom: () => 18, getPitch: () => 60, getBearing: () => 0,
      getCanvas: () => ({ clientWidth: 390, clientHeight: 844 }), transform: { cameraToCenterDistance: 1266 },
    }
    const cam = plantingCamera(map)
    expect(cam.y).toBeGreaterThan(0.5)
    expect(cam.x).toBeCloseTo(0.5)
    expect(cam.altitude).toBeCloseTo((cam.y - 0.5) / Math.tan(Math.PI / 3))
    expect(cam.spacing).toBeGreaterThan(5)
  })
})
