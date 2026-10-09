import { describe, test, expect } from 'vitest'
import { buildExclusions, falloff, forestCamera, forestLevel, forestTree, FULL_REACH, keeps, latticeLevel, plantForest, polygonsOf, screenSpacing, spansAt, CROWN_SUFFIX, FOREST_SPACING, type ForestPoint } from './forest'

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

  test('interior trees draw only their crowns; thinned ones stay whole and grow larger', () => {
    const edge = forestTree(0, 0, 4, 7)
    expect(edge.model.endsWith(CROWN_SUFFIX)).toBe(false)
    expect(forestTree(0, 0, 4, 7, { interior: true }).model).toBe(`${edge.model}${CROWN_SUFFIX}`)
    const thinned = forestTree(0, 0, 4, 7, { interior: true, level: 1 })
    expect(thinned.model).toBe(edge.model)
    expect(thinned.spread).toBeGreaterThan(edge.spread)
    expect(thinned.height).toBeGreaterThan(edge.height)
  })

  test('a strided planting is the full planting on the coarser lattice', () => {
    const ex = buildExclusions([], [])
    const key = (t: ForestPoint) => `${t[2]},${t[3]}`
    const full = plantForest(wood, everywhere, ex).filter(t => t[2] % 4 === 0 && t[3] % 4 === 0).map(key)
    expect(plantForest(wood, everywhere, ex, 4).map(key)).toEqual(full)
  })
})

describe('forest falloff', () => {
  const camera = { x: 0, y: 0, altitude: 30, focal: 1266, spacing: 8 }
  const levelAt = (dx: number, dy: number) => falloff(screenSpacing(camera, dx, dy), camera.spacing)

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

  test('full density out to FULL_REACH of the centre however far the camera, thinning gently past it', () => {
    const far = { ...camera, altitude: 400, focal: 900, spacing: 12 }
    const centre: [number, number] = [0, 0]
    expect(forestLevel(far, centre, FULL_REACH * 0.99, 0)).toBe(0)
    expect(forestLevel(far, centre, FULL_REACH * 2, 0)).toBeCloseTo(2)
    expect(forestLevel(far, centre, FULL_REACH * 0.5, 0, 1)).toBe(1)
  })

  test('lattice level counts shared halvings', () => {
    expect(latticeLevel(3, 8)).toBe(0)
    expect(latticeLevel(4, 8)).toBe(2)
    expect(latticeLevel(0, 0)).toBe(16)
  })

  const shownWithin = (radius: number) => {
    let n = 0
    for (let i = -radius; i <= radius; i++)
      for (let j = 0; j <= radius; j++)
        if (Math.hypot(i, j) < radius && keeps(i + 8192, j + 8192, levelAt(i + 0.5, j + 0.5))) n++
    return n
  }

  test('a wood running to the horizon costs a bounded number of trees', () => {
    const near = shownWithin(400)
    const far = shownWithin(1600)
    expect(far).toBeLessThan(near * 1.3)
  })

  test('levels blend over a band rather than meeting at a ring', () => {
    const kept = (level: number) => {
      let n = 0, total = 0
      for (let i = 0; i < 4096; i += 2) for (let j = 1; j < 64; j += 2) { total++; if (keeps(i, j, level)) n++ }
      return n / total
    }
    expect(kept(0.6)).toBe(1)
    expect(kept(1.1)).toBeGreaterThan(0.05)
    expect(kept(1.1)).toBeLessThan(0.95)
    expect(kept(1.4)).toBe(0)
  })

  test('the camera stands behind the centre, by the pitch, facing the bearing', () => {
    const map = {
      getCenter: () => ({ lng: 0, lat: 0 }), getZoom: () => 18, getPitch: () => 60, getBearing: () => 0,
      getCanvas: () => ({ clientWidth: 390, clientHeight: 844 }), transform: { cameraToCenterDistance: 1266 },
    }
    const cam = forestCamera(map)
    const centreY = 0.5 / FOREST_SPACING
    expect(cam.y).toBeGreaterThan(centreY)
    expect(cam.x).toBeCloseTo(0.5 / FOREST_SPACING)
    expect(cam.altitude).toBeCloseTo((cam.y - centreY) / Math.tan(Math.PI / 3))
    expect(cam.spacing).toBeGreaterThan(5)
  })
})
