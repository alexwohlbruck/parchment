/**
 * A minimal GLB reader.
 *
 * Deliberately not a glTF library. The models this loads are ours — see
 * `scripts/build-3d-objects.mjs` — so the whole of glTF's surface (textures,
 * skins, animation, sparse accessors, Draco, node hierarchies, external
 * buffers) is out of scope, and pulling in three.js to avoid 120 lines would
 * add more to the bundle than MapLibre's own renderer costs.
 *
 * What it does support is exactly what a static, flat-shaded, untextured model
 * needs: one mesh, any number of primitives, `POSITION` and `NORMAL` as float
 * vec3, unsigned indices, and a base colour factor per material.
 *
 * Anything outside that throws rather than degrading, because a model that
 * loads wrong draws garbage rather than nothing.
 */

const MAGIC = 0x46546c67 // "glTF"
const CHUNK_JSON = 0x4e4f534a
const CHUNK_BIN = 0x004e4942

const COMPONENT = {
  5120: Int8Array,
  5121: Uint8Array,
  5122: Int16Array,
  5123: Uint16Array,
  5125: Uint32Array,
  5126: Float32Array,
} as const

const COMPONENTS_PER = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 } as const

export type GlbPrimitive = {
  position: Float32Array
  normal: Float32Array
  index: Uint16Array | Uint32Array
  /** Linear RGBA from the material's base colour factor. */
  color: [number, number, number, number]
}

export type GlbModel = {
  primitives: GlbPrimitive[]
  /** Axis-aligned bounds, in the model's own units. */
  min: [number, number, number]
  max: [number, number, number]
}

export function parseGlb(buffer: ArrayBuffer): GlbModel {
  const head = new DataView(buffer)
  if (head.getUint32(0, true) !== MAGIC) throw new Error('not a GLB')
  if (head.getUint32(4, true) !== 2) throw new Error('GLB version must be 2')

  let json: any = null
  let bin: Uint8Array | null = null
  let at = 12
  while (at + 8 <= buffer.byteLength) {
    const length = head.getUint32(at, true)
    const type = head.getUint32(at + 4, true)
    const body = new Uint8Array(buffer, at + 8, length)
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(body))
    else if (type === CHUNK_BIN) bin = body
    at += 8 + length + ((4 - (length % 4)) % 4)
  }
  if (!json || !bin) throw new Error('GLB is missing its JSON or BIN chunk')

  /** Read one accessor as a typed array over the BIN chunk, in place. */
  const read = (index: number) => {
    const accessor = json.accessors[index]
    if (accessor.sparse) throw new Error('sparse accessors are not supported')
    const view = json.bufferViews[accessor.bufferView]
    const Type = COMPONENT[accessor.componentType as keyof typeof COMPONENT]
    if (!Type) throw new Error(`unknown component type ${accessor.componentType}`)
    const count = accessor.count * COMPONENTS_PER[accessor.type as keyof typeof COMPONENTS_PER]
    const offset = bin!.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    // The generator writes tightly packed views, so a strided read is a bug
    // rather than a case to handle.
    if (view.byteStride && view.byteStride !== Type.BYTES_PER_ELEMENT * COMPONENTS_PER[accessor.type as keyof typeof COMPONENTS_PER])
      throw new Error('interleaved accessors are not supported')
    return new Type(bin!.buffer as ArrayBuffer, offset, count)
  }

  const min: [number, number, number] = [Infinity, Infinity, Infinity]
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  const primitives: GlbPrimitive[] = []

  for (const primitive of json.meshes?.[0]?.primitives ?? []) {
    if (primitive.mode !== undefined && primitive.mode !== 4)
      throw new Error('only triangle primitives are supported')
    const positionIndex = primitive.attributes?.POSITION
    if (positionIndex === undefined) throw new Error('primitive has no POSITION')
    const position = read(positionIndex) as Float32Array
    const normal = (primitive.attributes?.NORMAL !== undefined
      ? read(primitive.attributes.NORMAL)
      : new Float32Array(position.length)) as Float32Array
    const index = read(primitive.indices) as Uint16Array | Uint32Array

    const bounds = json.accessors[positionIndex]
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c], bounds.min?.[c] ?? 0)
      max[c] = Math.max(max[c], bounds.max?.[c] ?? 0)
    }

    const factor = json.materials?.[primitive.material]?.pbrMetallicRoughness?.baseColorFactor
    primitives.push({
      position,
      normal,
      index,
      color: (factor ?? [1, 1, 1, 1]) as [number, number, number, number],
    })
  }

  if (!primitives.length) throw new Error('GLB has no primitives')
  return { primitives, min, max }
}

export async function loadGlb(url: string): Promise<GlbModel> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  return parseGlb(await response.arrayBuffer())
}
