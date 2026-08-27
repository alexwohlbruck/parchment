/**
 * The 3D object pipeline: the models the build script writes, the reader that
 * takes them apart again, and the rules that turn a tree feature into one.
 *
 * The GLB round-trip is the valuable half. Both ends are ours, so nothing else
 * would catch the two drifting apart — and a model read with the wrong stride
 * or the wrong component type does not fail, it draws a tangle.
 */
import { describe, test, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseGlb } from './glb'
import { treeInstance, TREE_MODELS, TREE_OBJECTS } from './trees'

const MODELS = resolve(__dirname, '../../../public/models')

function load(name: string) {
  const path = resolve(MODELS, `${name}.glb`)
  const bytes = readFileSync(path)
  return parseGlb(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer)
}

describe('generated models', () => {
  test('every model the tree layer names exists', () => {
    for (const url of Object.values(TREE_MODELS)) {
      expect(existsSync(resolve(MODELS, url.replace('/models/', ''))), url).toBe(true)
    }
  })

  test.each(Object.keys(TREE_MODELS))('%s parses back out of its GLB', name => {
    const model = load(name)
    expect(model.primitives.length).toBeGreaterThan(1)
    for (const p of model.primitives) {
      expect(p.position.length % 3).toBe(0)
      expect(p.normal.length).toBe(p.position.length)
      expect(p.index.length % 3).toBe(0)
      // Every index has to address a vertex that exists, or the draw reads
      // past the buffer and the GL drops the whole call.
      const vertices = p.position.length / 3
      for (const i of p.index) expect(i).toBeLessThan(vertices)
      // Opaque colours: the layer draws with blending off.
      expect(p.color[3]).toBe(1)
    }
  })

  /**
   * The layer's only per-instance transform is a height in metres and a
   * lateral scale, which is only correct if the model is exactly one unit tall
   * standing on its own origin.
   */
  test.each(Object.keys(TREE_MODELS))('%s is a unit tall, based at the origin', name => {
    const model = load(name)
    // glTF is Y-up; the layer swaps to Z-up on the way into the shader.
    expect(model.min[1]).toBeCloseTo(0, 5)
    expect(model.max[1]).toBeCloseTo(1, 2)
    // And no wider than it is tall, or a canopy would overhang its own tile.
    expect(Math.max(-model.min[0], model.max[0])).toBeLessThan(1)
  })

  test.each(Object.keys(TREE_MODELS))('%s has flat normals, not smooth ones', name => {
    const model = load(name)
    for (const p of model.primitives) {
      for (let i = 0; i < p.normal.length; i += 3) {
        const length = Math.hypot(p.normal[i], p.normal[i + 1], p.normal[i + 2])
        expect(length).toBeCloseTo(1, 3)
      }
    }
  })

  test('a buffer that is not a GLB is rejected rather than half-read', () => {
    expect(() => parseGlb(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer)).toThrow()
  })
})

describe('trees', () => {
  const at = (props: Record<string, unknown>) =>
    treeInstance({ properties: { id: 'node/1', ...props } }, -73.97, 40.76)!

  test('a tagged height is used as given', () => {
    expect(at({ height: '18' }).height).toBe(18)
  })

  test('an absurd height is ignored in favour of a plausible one', () => {
    // OSM heights include typos and units; a 400m tree is neither.
    const tall = at({ height: '400' })
    expect(tall.height).toBeLessThan(20)
    expect(at({ height: 'tall' }).height).toBeLessThan(20)
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

  test('needleleaved trees take the conifer model, and run narrower', () => {
    const conifer = at({ leaf_type: 'needleleaved' })
    const broadleaf = at({ leaf_type: 'broadleaved' })
    expect(conifer.model).toBe('tree-conifer')
    expect(broadleaf.model).toBe('tree-broadleaf')
    expect(conifer.spread).toBeLessThan(broadleaf.spread)
  })

  test('street trees are shorter than the ones with room', () => {
    // Sampled across ids rather than one, since both come from a range.
    const height = (props: Record<string, unknown>) =>
      Array.from({ length: 40 }, (_, i) =>
        treeInstance({ properties: { id: `node/${i}`, ...props } }, -73.97, 40.76)!.height,
      ).reduce((a, b) => a + b) / 40
    expect(height({ denotation: 'street' })).toBeLessThan(height({}))
  })

  test('the 3D form starts at the same zoom as the flat one', () => {
    // The two draw the same features; a zoom where one shows and the other
    // does not would read as trees appearing twice.
    expect(TREE_OBJECTS.minzoom).toBe(16)
  })
})
