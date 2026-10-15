import { describe, expect, it } from 'vitest'
import { batchPrimitives, MAX_BATCH_MATERIALS } from './landmark-batches'
import type { GlbPrimitive } from './glb.mjs'

const triangle = (over: Partial<GlbPrimitive> = {}): GlbPrimitive => ({
  position: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
  normal: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
  index: new Uint16Array([0, 1, 2]),
  color: [1, 1, 1, 1],
  material: 'wall',
  uv: null,
  image: null,
  alphaMode: 'OPAQUE',
  alphaCutoff: 0.5,
  doubleSided: false,
  node: -1,
  ...over,
})

describe('batchPrimitives', () => {
  it('merges untextured primitives into one draw, tagging each vertex with its primitive', () => {
    const [batch, ...rest] = batchPrimitives([triangle(), triangle({ material: 'roof' })])

    expect(rest).toEqual([])
    expect(batch.primitives.map(p => p.material)).toEqual(['wall', 'roof'])
    expect([...batch.index]).toEqual([0, 1, 2, 3, 4, 5])
    expect([...batch.material]).toEqual([0, 0, 0, 1, 1, 1])
    expect(batch.position.length).toBe(18)
  })

  it('keeps apart primitives on another node, culled differently, or textured', () => {
    const textured = triangle({ uv: new Float32Array(6), image: { bytes: new Uint8Array(), mimeType: 'image/png' } })
    const batches = batchPrimitives([triangle(), triangle({ node: 2 }), triangle({ doubleSided: true }), textured])

    expect(batches.map(b => b.primitives.length)).toEqual([1, 1, 1, 1])
    expect(batches.at(-1)!.uv).toBe(textured.uv)
  })

  it('splits a run longer than the material table', () => {
    const batches = batchPrimitives(Array.from({ length: MAX_BATCH_MATERIALS + 1 }, () => triangle()))

    expect(batches.map(b => b.primitives.length)).toEqual([MAX_BATCH_MATERIALS, 1])
  })

  it('widens the index once the vertices outgrow 16 bits', () => {
    const big = triangle({ position: new Float32Array(0x10000 * 3), normal: new Float32Array(0x10000 * 3) })
    const [batch] = batchPrimitives([big, triangle()])

    expect(batch.index).toBeInstanceOf(Uint32Array)
    expect(batch.index[3]).toBe(0x10000)
  })
})
