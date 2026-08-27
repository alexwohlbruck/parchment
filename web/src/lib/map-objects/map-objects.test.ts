/**
 * The 3D object pipeline: the models the build script writes, the reader that
 * takes them apart again, and the rules that turn a feature into an instance.
 *
 * The GLB round-trip is the valuable half. Both ends are ours, so nothing else
 * would catch the two drifting apart — and a model read with the wrong stride
 * or the wrong component type does not fail, it draws a tangle.
 */
import { describe, test, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseGlb } from './glb.mjs'
import { treeFamily, treeInstance, walkLine, TREE_FAMILIES, TREE_MODELS, TREE_OBJECTS } from './trees'
import { bearingOf, headingToBearing, furnitureInstance, FURNITURE_MODELS } from './furniture'
import { CATALOGUE_MODELS, OBJECT_MODELS, OBJECT_PALETTE } from './index'
import { FAR_SUFFIX, project } from './object-layer'
import { MercatorCoordinate } from 'maplibre-gl'

const MODELS = resolve(__dirname, '../../../public/models')
const ALL = Object.keys({ ...TREE_MODELS, ...FURNITURE_MODELS })

function load(name: string) {
  const bytes = readFileSync(resolve(MODELS, `${name}.glb`))
  return parseGlb(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  )
}

const triangles = (model: ReturnType<typeof load>) =>
  model.primitives.reduce((n, p) => n + p.index.length / 3, 0)

describe('models', () => {
  test('every file the manifest lists exists, and vice versa', () => {
    // The manifest is what the app fetches. A name in it with no file is a 404
    // that takes the whole layer down; a file missing from it is dead weight.
    for (const [name, url] of Object.entries(OBJECT_MODELS)) {
      expect(existsSync(resolve(MODELS, url.replace('/models/', ''))), name).toBe(true)
    }
    for (const name of ALL) expect(Object.keys(OBJECT_MODELS), name).toContain(name)
  })

  test('every model a catalogue entry names is in the manifest', () => {
    for (const name of Object.keys(CATALOGUE_MODELS))
      expect(Object.keys(OBJECT_MODELS), name).toContain(name)
  })

  test.each(ALL)('%s parses back out of its GLB', name => {
    const model = load(name)
    expect(model.primitives.length).toBeGreaterThan(0)
    for (const p of model.primitives) {
      expect(p.position.length % 3).toBe(0)
      expect(p.normal.length).toBe(p.position.length)
      expect(p.index.length % 3).toBe(0)
      // Every index has to address a vertex that exists, or the draw reads
      // past the buffer and the GL drops the whole call.
      const vertices = p.position.length / 3
      for (const i of p.index) expect(i).toBeLessThan(vertices)
    }
  })

  /**
   * A trunk is a trunk, not a plinth.
   *
   * The vendored models are drawn to read at arm's length in a game, where a
   * chunky trunk is part of the look — one of them is nearly as wide as its own
   * crown. Seen from above on a map that is a brown post with a bush balanced
   * on it, so the build script slims every one to a fraction of its crown. This
   * holds it there: re-vendoring a model, or a change to the normalisation that
   * ran before the slimming, would otherwise quietly bring the plinths back.
   */
  test.each(Object.keys(TREE_MODELS))('%s stands on a trunk, not a plinth', name => {
    const model = load(name)
    const reach = (role: string, below = Infinity) => {
      let radius = 0
      for (const p of model.primitives) {
        if (p.material !== role) continue
        for (const v of p.index) {
          if (p.position[v * 3 + 1] > below) continue
          radius = Math.max(radius, Math.hypot(p.position[v * 3], p.position[v * 3 + 2]))
        }
      }
      return radius
    }
    let crownBottom = Infinity
    for (const p of model.primitives) {
      if (p.material !== 'foliage') continue
      for (const v of p.index) crownBottom = Math.min(crownBottom, p.position[v * 3 + 1])
    }
    const crown = reach('foliage')
    // Only the length of trunk anyone can see; branches inside the crown are
    // behind the foliage they hold up.
    const trunk = reach('bark', crownBottom)
    expect(crown).toBeGreaterThan(0)
    expect(trunk / crown, `${name} trunk is ${((trunk / crown) * 100).toFixed(0)}% of its crown`)
      .toBeLessThanOrEqual(0.16)
  })

  /**
   * Nothing may be see-through, because the layer culls back faces.
   *
   * It has to: in the plan view the depth buffer cannot separate the front of a
   * crown from its back, and letting a back face win a fragment shades it by
   * the opposite normal — the tree breaks into light and dark wedges that crawl
   * as the camera moves. Culling settles that, but only for a solid. Cull an
   * open shell and you look straight through it, which is what happened to the
   * conifers: their skirts were open underneath and every one grew a hole.
   *
   * An edge used by exactly one triangle is a hole's rim. The build script caps
   * them (`capHoles`), and this is what says it has to. Edges used by three or
   * four triangles are left alone — those are junctions where surfaces meet,
   * not openings, and there is nothing to see through.
   */
  test.each(ALL)('%s is solid, so culling cannot open a hole in it', name => {
    for (const primitive of load(name).primitives) {
      // Welded by position: a corner split for its normals is one point here,
      // or every shading seam would read as a hole.
      const ids = new Map<string, number>()
      const id = (v: number) => {
        const key = [0, 1, 2].map(c => primitive.position[v * 3 + c].toFixed(5)).join(',')
        if (!ids.has(key)) ids.set(key, ids.size)
        return ids.get(key)!
      }
      const uses = new Map<string, number>()
      for (let i = 0; i < primitive.index.length; i += 3) {
        const [a, b, c] = [id(primitive.index[i]), id(primitive.index[i + 1]), id(primitive.index[i + 2])]
        for (const [u, v] of [[a, b], [b, c], [c, a]]) {
          const key = u < v ? `${u}_${v}` : `${v}_${u}`
          uses.set(key, (uses.get(key) ?? 0) + 1)
        }
      }
      const rims = [...uses.values()].filter(n => n === 1).length
      expect(rims, `${name} has ${rims} unpaired edge(s)`).toBe(0)
    }
  })

  /**
   * The layer's only per-instance transform is a height in metres and a
   * lateral scale, which is only correct if the model is exactly one unit tall
   * standing on its own origin. The vendored source models are not — Kenney
   * wraps each in a parent node and offsets the mesh inside it — so this is
   * really a test that the build script's normalisation ran.
   */
  test.each(ALL)('%s is a unit tall, based at the origin', name => {
    const model = load(name)
    // glTF is Y-up; the layer swaps to Z-up on the way into the shader.
    expect(model.min[1]).toBeCloseTo(0, 4)
    expect(model.max[1]).toBeCloseTo(1, 3)
    // Centred, so a heading rotates it about itself rather than swinging it.
    expect(Math.abs(model.min[0] + model.max[0])).toBeLessThan(0.02)
    expect(Math.abs(model.min[2] + model.max[2])).toBeLessThan(0.02)
  })

  test.each(ALL)('%s carries roles rather than baked colours', name => {
    // The role is what lets the layer retint per flavor. Written as the
    // material name, since glTF has no field for it.
    for (const p of load(name).primitives) {
      expect(Object.keys(OBJECT_PALETTE.light), `${name}: ${p.material}`).toContain(p.material)
    }
  })

  /**
   * A far variant only exists where it is actually cheaper. The fitted proxies
   * have a fixed tessellation, so a 24-triangle bin comes out heavier as a
   * proxy than as itself — the build skips those, and the layer keeps drawing
   * the near model at every distance.
   */
  test.each(ALL)('%s is never stood in for by something more expensive', name => {
    const near = triangles(load(name))
    const present = `${name}${FAR_SUFFIX}` in OBJECT_MODELS
    if (!present) {
      expect(near).toBeLessThanOrEqual(96)
      return
    }
    const far = triangles(load(`${name}${FAR_SUFFIX}`))
    expect(far).toBeLessThan(near)
    expect(far).toBeLessThanOrEqual(96)
  })

  /**
   * A stand-in may not be bigger than the thing it stands in for.
   *
   * glTF lets several primitives share one vertex buffer and differ only by
   * their indices, which is what Kenney's exporter does — so a part's position
   * array spans the whole model, and measuring it directly gave every trunk the
   * bounds of its own canopy. Distant trees came out wrapped in a brown crate
   * as tall and as wide as the tree.
   */
  test.each(ALL)('%s: the far model fits inside the near one', name => {
    if (!(`${name}${FAR_SUFFIX}` in OBJECT_MODELS)) return
    const near = load(name)
    const far = load(`${name}${FAR_SUFFIX}`)

    const extent = (model: ReturnType<typeof load>, role: string) => {
      const part = model.primitives.find(p => p.material === role)
      if (!part) return null
      let radius = 0
      let top = -Infinity
      let bottom = Infinity
      for (let i = 0; i < part.position.length; i += 3) {
        radius = Math.max(radius, Math.hypot(part.position[i], part.position[i + 2]))
        top = Math.max(top, part.position[i + 1])
        bottom = Math.min(bottom, part.position[i + 1])
      }
      return { radius, top, bottom }
    }

    for (const role of new Set(far.primitives.map(p => p.material))) {
      const a = extent(near, role)!
      const b = extent(far, role)!
      // A hair of tolerance for the proxy's own faceting, and no more.
      expect(b.radius, `${name} ${role} radius`).toBeLessThanOrEqual(a.radius * 1.05 + 0.01)
      expect(b.top, `${name} ${role} top`).toBeLessThanOrEqual(a.top + 0.01)
      expect(b.bottom, `${name} ${role} bottom`).toBeGreaterThanOrEqual(a.bottom - 0.01)
    }
  })

  test.each(ALL)('%s has unit-length normals', name => {
    // Smoothing averages normals across faces, and an un-normalised average
    // shades as if the surface were darker rather than as if it were curved.
    for (const p of load(name).primitives)
      for (let i = 0; i < p.normal.length; i += 3)
        expect(Math.hypot(p.normal[i], p.normal[i + 1], p.normal[i + 2])).toBeCloseTo(1, 3)
  })

  /** Foliage is smoothed and bark is not; that is the whole point of roles. */
  test('canopies are smooth-shaded where trunks stay faceted', () => {
    const model = load(TREE_FAMILIES.broadleaf[0])
    const distinct = (role: string) => {
      const part = model.primitives.find(p => p.material === role)!
      const seen = new Set<string>()
      for (let i = 0; i < part.normal.length; i += 3)
        seen.add(`${part.normal[i].toFixed(2)},${part.normal[i + 1].toFixed(2)}`)
      return seen.size / (part.normal.length / 3)
    }
    // A flat-shaded mesh repeats one normal per face across its three corners;
    // a smoothed one gives almost every vertex its own.
    expect(distinct('foliage')).toBeGreaterThan(distinct('bark'))
  })

  test('a buffer that is not a GLB is rejected rather than half-read', () => {
    expect(() => parseGlb(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toThrow()
  })
})

describe('trees', () => {
  const at = (props: Record<string, unknown>) =>
    treeInstance({ properties: { id: 'node/1', ...props } }, -73.97, 40.76)!

  test('measured tags beat estimates beat girth beats a guess', () => {
    expect(at({ height: '18', est_height: '9' }).height).toBe(18)
    expect(at({ est_height: '9' }).height).toBe(9)
    // Girth in metres times the allometric ratio, when nothing else is given.
    expect(at({ circumference: '1.2' }).height).toBeCloseTo(13.2, 5)
    expect(at({}).height).toBeGreaterThan(0)
  })

  test('a measured crown sets the spread directly', () => {
    expect(at({ diameter_crown: '11' }).spread).toBe(11)
  })

  test('an absurd height is ignored in favour of a plausible one', () => {
    // OSM heights include typos and units; a 400m tree is neither.
    expect(at({ height: '400' }).height).toBeLessThan(25)
    expect(at({ height: 'tall' }).height).toBeLessThan(25)
  })

  test('an untagged tree is shaped from its id, so it is stable', () => {
    const first = treeInstance({ properties: { id: 'node/12345' } }, -73.97, 40.76)!
    const again = treeInstance({ properties: { id: 'node/12345' } }, -73.97, 40.76)!
    expect(again).toEqual(first)
    // And two trees differ, or a street would be a row of clones.
    const other = treeInstance({ properties: { id: 'node/12346' } }, -73.97, 40.76)!
    expect(other.height).not.toBe(first.height)
    expect(other.heading).not.toBe(first.heading)
  })

  test('family comes from the taxon first, then the leaf type', () => {
    expect(treeFamily({ genus: 'Pinus' })).toBe('conifer')
    expect(treeFamily({ genus: 'Washingtonia' })).toBe('palm')
    expect(treeFamily({ species: 'Phoenix dactylifera' })).toBe('palm')
    expect(treeFamily({ leaf_type: 'needleleaved' })).toBe('conifer')
    expect(treeFamily({ leaf_type: 'broadleaved' })).toBe('broadleaf')
    // A genus that names a conifer wins over a leaf type that disagrees.
    expect(treeFamily({ genus: 'Picea', leaf_type: 'broadleaved' })).toBe('conifer')
    expect(treeFamily({})).toBe('broadleaf')
  })

  test('a family only ever draws its own models', () => {
    for (const [family, models] of Object.entries(TREE_FAMILIES)) {
      const drawn = new Set(
        Array.from({ length: 60 }, (_, i) =>
          treeInstance(
            { properties: { id: `node/${i}`, genus: family === 'palm' ? 'Phoenix' : family === 'conifer' ? 'Pinus' : '' } },
            -73.97,
            40.76,
          )!.model,
        ),
      )
      for (const model of drawn) expect(models, family).toContain(model)
      // And uses more than one of them, or the variety is theoretical.
      expect(drawn.size, family).toBeGreaterThan(1)
    }
  })

  test('street trees are shorter than the ones with room', () => {
    const height = (props: Record<string, unknown>) =>
      Array.from({ length: 40 }, (_, i) =>
        treeInstance({ properties: { id: `node/${i}`, ...props } }, -73.97, 40.76)!.height,
      ).reduce((a, b) => a + b) / 40
    expect(height({ denotation: 'street' })).toBeLessThan(height({}))
  })

  test('the 3D form starts at the same zoom as the flat one', () => {
    expect(TREE_OBJECTS.minzoom).toBe(16)
  })
})

describe('tree rows', () => {
  /** Roughly a hundred metres due east, at this latitude. */
  const line: Array<[number, number]> = [
    [-73.97, 40.76],
    [-73.9688, 40.76],
  ]

  test('a line is planted at an even spacing', () => {
    const points = walkLine(line, 10)
    // ~101m of line at 10m spacing, plus the start.
    expect(points.length).toBeGreaterThan(8)
    expect(points.length).toBeLessThan(13)
    expect(points[0]).toEqual(line[0])
  })

  test('spacing is metres on the ground, not degrees', () => {
    // Longitude degrees are shorter away from the equator, so the same span
    // must plant the same number of trees whatever the latitude.
    const far: Array<[number, number]> = [
      [-73.97, 40.76],
      [-73.97, 40.7609],
    ]
    const east = walkLine(line, 10).length
    const north = walkLine(far, 10).length
    expect(Math.abs(east - north)).toBeLessThanOrEqual(1)
  })

  test('a long row cannot swallow the whole instance budget', () => {
    const long: Array<[number, number]> = [
      [-73.97, 40.76],
      [-72.0, 40.76],
    ]
    expect(walkLine(long, 9).length).toBeLessThanOrEqual(400)
  })

  test('each tree along a row is drawn differently', () => {
    const feature = { properties: { id: 'way/1' } }
    const a = treeInstance(feature, -73.97, 40.76, 0)!
    const b = treeInstance(feature, -73.97, 40.76, 1)!
    expect(a.heading).not.toBe(b.heading)
    expect(a.height).not.toBe(b.height)
  })

  test('an empty geometry plants nothing', () => {
    expect(walkLine([])).toEqual([])
  })
})

describe('street furniture', () => {
  const at = (props: Record<string, unknown>) =>
    furnitureInstance({ properties: { id: 'node/1', ...props } }, -73.97, 40.76)

  test('reads a bearing in degrees or as a compass point', () => {
    expect(bearingOf('')).toBeNull()
    expect(bearingOf('forward')).toBeNull()
    expect(bearingOf('E')).toEqual(bearingOf('90'))
    expect(bearingOf('NW')).toEqual(bearingOf('315'))
  })

  /**
   * The one that matters, and the one that was wrong: a bench tagged 130° has
   * to end up facing 130°. The first version negated the bearing, which faces
   * it at `180 - bearing` — right at 90°, wrong everywhere else, and 43°
   * instead of 130° for the bench that caught it.
   */
  test.each([0, 45, 90, 130, 180, 270, 315])('a bench tagged %i faces %i', degrees => {
    expect(headingToBearing(bearingOf(String(degrees))!)).toBeCloseTo(degrees % 360, 6)
  })

  test('every compass point round-trips to its own bearing', () => {
    for (const [point, degrees] of Object.entries({ N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 })) {
      expect(headingToBearing(bearingOf(point)!), point).toBeCloseTo(degrees, 6)
    }
  })

  /**
   * A bench pointed the wrong way reads as a mistake in a way a wrong tree does
   * not — it is furniture, and furniture faces something.
   */
  test('a bench without a direction is skipped', () => {
    expect(at({ kind: 'bench' })).toBeNull()
    expect(at({ kind: 'bench', direction: '180' })!.model).toBe('bench')
  })

  test('bins take a hashed angle, since a drum has no front', () => {
    const bin = at({ kind: 'waste_basket' })!
    expect(bin.model).toBe('waste-basket')
    expect(bin.heading).toBeGreaterThanOrEqual(0)
  })

  test('waste disposal shares the recycling model', () => {
    expect(at({ kind: 'waste_disposal' })!.model).toBe('recycling')
    expect(at({ kind: 'recycling' })!.model).toBe('recycling')
  })

  test('an amenity with no model is skipped rather than guessed at', () => {
    expect(at({ kind: 'drinking_water' })).toBeNull()
  })

  test('furniture is drawn at its real size', () => {
    const bench = at({ kind: 'bench', direction: 'N' })!
    expect(bench.spread).toBeCloseTo(1.8, 2)
    expect(bench.height).toBeLessThan(1)
  })
})

/**
 * The layer projects objects itself rather than through `MercatorCoordinate`,
 * to avoid two allocations and a round trip through `latFromMercatorY` for
 * every tree on screen — see `project`. That is a copy of somebody else's
 * formula, so it is held to the original here: a drift would not throw, it
 * would move every tree a few metres and only show as objects sitting beside
 * the ground they belong to.
 */
describe('projection', () => {
  const places: Array<[string, number, number, number]> = [
    ['null island', 0, 0, 0],
    ['Charlotte', -80.8394, 35.216, 0],
    ['Manhattan', -73.9903, 40.734, 12],
    ['Quito', -78.4678, -0.1807, 2850],
    ['Tromso', 18.9553, 69.6492, 40],
    ['Wellington', 174.7762, -41.2865, 5],
    ['dateline', 179.9, -8.5, 0],
  ]

  test.each(places)('%s matches MercatorCoordinate', (_name, lng, lat, elevation) => {
    const out = { instance: null as any, x: 0, y: 0, z: 0, perMetre: 0 }
    project(lng, lat, elevation, out)
    const reference = MercatorCoordinate.fromLngLat([lng, lat], elevation)
    expect(out.x).toBeCloseTo(reference.x, 12)
    expect(out.y).toBeCloseTo(reference.y, 12)
    expect(out.z).toBeCloseTo(reference.z, 12)
    expect(out.perMetre).toBeCloseTo(reference.meterInMercatorCoordinateUnits(), 12)
  })
})

describe('flavors', () => {
  test('both flavors colour every role', () => {
    expect(Object.keys(OBJECT_PALETTE.dark).sort()).toEqual(Object.keys(OBJECT_PALETTE.light).sort())
  })

  /** An object has to belong to the ground it stands on. */
  test('night objects are darker than day ones, role for role', () => {
    for (const role of Object.keys(OBJECT_PALETTE.light)) {
      const sum = (c: [number, number, number]) => c[0] + c[1] + c[2]
      expect(sum(OBJECT_PALETTE.dark[role]), role).toBeLessThan(sum(OBJECT_PALETTE.light[role]))
    }
  })
})
