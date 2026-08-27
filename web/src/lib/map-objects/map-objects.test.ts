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
import { bearingOf, furnitureInstance, FURNITURE_MODELS } from './furniture'
import { CATALOGUE_MODELS, OBJECT_MODELS, OBJECT_PALETTE, OBJECT_SHADOW } from './index'
import { FAR_SUFFIX } from './object-layer'

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
    // Bearings run clockwise from north; the model's heading runs the other
    // way, so the two are negatives of each other.
    expect(bearingOf('90')).toBeCloseTo(-Math.PI / 2, 6)
    expect(bearingOf('E')).toBeCloseTo(-Math.PI / 2, 6)
    expect(bearingOf('NW')).toBeCloseTo((-315 * Math.PI) / 180, 6)
    expect(bearingOf('')).toBeNull()
    expect(bearingOf('forward')).toBeNull()
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

  test('the shadow all but disappears at night', () => {
    expect(OBJECT_SHADOW.dark[3]).toBeLessThan(OBJECT_SHADOW.light[3])
    expect(OBJECT_SHADOW.dark[3]).toBeGreaterThan(0)
  })
})
