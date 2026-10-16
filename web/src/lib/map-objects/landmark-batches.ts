import type { GlbPrimitive } from './glb.mjs'

/** Materials one batch can carry; the draw shader indexes a uniform array this long. */
export const MAX_BATCH_MATERIALS = 16

/** Primitives drawn together: one vertex array, each vertex tagged with its source primitive. */
export type PrimitiveBatch = {
  /** The source primitives, in the order `a_material` indexes them. */
  primitives: GlbPrimitive[]
  position: Float32Array
  normal: Float32Array
  uv: Float32Array | null
  index: Uint16Array | Uint32Array
  material: Float32Array
}

/**
 * Merge a model's untextured primitives into as few draws as their state
 * allows. A draw can only change its colour per vertex, so primitives that
 * move with different nodes, cull differently or sample a texture stay apart.
 */
export function batchPrimitives(primitives: GlbPrimitive[]): PrimitiveBatch[] {
  const groups = new Map<string, GlbPrimitive[][]>()
  const alone: GlbPrimitive[][] = []
  for (const p of primitives) {
    if (p.image && p.uv) {
      alone.push([p])
      continue
    }
    const key = `${p.node}:${p.doubleSided}`
    const runs = groups.get(key) ?? []
    const last = runs.at(-1)
    if (last && last.length < MAX_BATCH_MATERIALS) last.push(p)
    else runs.push([p])
    groups.set(key, runs)
  }
  return [...[...groups.values()].flat(), ...alone].map(merge)
}

function merge(primitives: GlbPrimitive[]): PrimitiveBatch {
  const vertices = primitives.reduce((n, p) => n + p.position.length / 3, 0)
  const indices = primitives.reduce((n, p) => n + p.index.length, 0)
  const position = new Float32Array(vertices * 3)
  const normal = new Float32Array(vertices * 3)
  const material = new Float32Array(vertices)
  const index = vertices > 0xffff ? new Uint32Array(indices) : new Uint16Array(indices)
  let v = 0
  let i = 0
  primitives.forEach((p, m) => {
    const count = p.position.length / 3
    position.set(p.position, v * 3)
    normal.set(p.normal, v * 3)
    material.fill(m, v, v + count)
    for (let k = 0; k < p.index.length; k++) index[i + k] = p.index[k] + v
    v += count
    i += p.index.length
  })
  const uv = primitives.length === 1 ? primitives[0].uv : null
  return { primitives, position, normal, uv, index, material }
}
