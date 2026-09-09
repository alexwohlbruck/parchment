/**
 * A minimal GLB reader, shared by the app and by `build-3d-objects.mjs`.
 *
 * Deliberately not a glTF library. It reads what a static, untextured,
 * flat-or-smooth-shaded model needs and nothing else: node transforms,
 * `POSITION` and `NORMAL` as float vec3, unsigned indices, and a material name
 * and base colour per primitive. Textures, skins, animation, sparse accessors,
 * Draco and morph targets are all out of scope — pulling in three.js to avoid
 * 150 lines would add more to the bundle than MapLibre's own renderer costs.
 *
 * Anything outside that throws rather than degrading, because a model that
 * loads wrong draws garbage rather than nothing.
 *
 * Node transforms matter because real exports have them: Kenney's kit wraps
 * every model in a parent node and offsets the mesh inside it, so a reader that
 * ignores the hierarchy places the model slightly underground.
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
}

const COMPONENTS_PER = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

/** Column-major 4x4, the order glTF and GL both use. */
function identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

function multiply(a, b) {
  const out = new Array(16).fill(0)
  for (let c = 0; c < 4; c++)
    for (let r = 0; r < 4; r++)
      for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return out
}

/** Translation, rotation (quaternion) and scale, or an explicit matrix. */
function nodeMatrix(node) {
  if (node.matrix) return node.matrix.slice()
  const m = identity()
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  const [tx, ty, tz] = node.translation ?? [0, 0, 0]
  const [x2, y2, z2] = [x + x, y + y, z + z]
  const [xx, xy, xz] = [x * x2, x * y2, x * z2]
  const [yy, yz, zz] = [y * y2, y * z2, z * z2]
  const [wx, wy, wz] = [w * x2, w * y2, w * z2]
  m[0] = (1 - (yy + zz)) * sx
  m[1] = (xy + wz) * sx
  m[2] = (xz - wy) * sx
  m[4] = (xy - wz) * sy
  m[5] = (1 - (xx + zz)) * sy
  m[6] = (yz + wx) * sy
  m[8] = (xz + wy) * sz
  m[9] = (yz - wx) * sz
  m[10] = (1 - (xx + yy)) * sz
  m[12] = tx
  m[13] = ty
  m[14] = tz
  return m
}

function transformPoint(m, x, y, z) {
  return [
    m[0] * x + m[4] * y + m[8] * z + m[12],
    m[1] * x + m[5] * y + m[9] * z + m[13],
    m[2] * x + m[6] * y + m[10] * z + m[14],
  ]
}

/** Normals ignore translation; uniform scale is all these models use. */
function transformDirection(m, x, y, z) {
  const v = [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ]
  const length = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / length, v[1] / length, v[2] / length]
}

export function parseGlb(buffer) {
  const head = new DataView(buffer)
  if (head.getUint32(0, true) !== MAGIC) throw new Error('not a GLB')
  if (head.getUint32(4, true) !== 2) throw new Error('GLB version must be 2')

  let json = null
  let bin = null
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

  const read = index => {
    const accessor = json.accessors[index]
    if (accessor.sparse) throw new Error('sparse accessors are not supported')
    const view = json.bufferViews[accessor.bufferView]
    const Type = COMPONENT[accessor.componentType]
    if (!Type) throw new Error(`unknown component type ${accessor.componentType}`)
    const per = COMPONENTS_PER[accessor.type]
    if (view.byteStride && view.byteStride !== Type.BYTES_PER_ELEMENT * per)
      throw new Error('interleaved accessors are not supported')
    const offset = bin.byteOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    return new Type(bin.buffer, offset, accessor.count * per)
  }

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const primitives = []

  /** Walk the scene so every mesh arrives in the model's own space. */
  const visit = (index, parent) => {
    const node = json.nodes[index]
    const world = multiply(parent, nodeMatrix(node))
    if (node.mesh !== undefined) {
      for (const primitive of json.meshes[node.mesh].primitives ?? []) {
        if (primitive.mode !== undefined && primitive.mode !== 4)
          throw new Error('only triangle primitives are supported')
        const positionIndex = primitive.attributes?.POSITION
        if (positionIndex === undefined) throw new Error('primitive has no POSITION')

        const rawPosition = read(positionIndex)
        const rawNormal = primitive.attributes?.NORMAL !== undefined
          ? read(primitive.attributes.NORMAL)
          : null

        const count = rawPosition.length / 3
        const position = new Float32Array(rawPosition.length)
        const normal = new Float32Array(rawPosition.length)
        for (let i = 0; i < count; i++) {
          const p = transformPoint(world, rawPosition[i * 3], rawPosition[i * 3 + 1], rawPosition[i * 3 + 2])
          position.set(p, i * 3)
          for (let c = 0; c < 3; c++) {
            min[c] = Math.min(min[c], p[c])
            max[c] = Math.max(max[c], p[c])
          }
          if (rawNormal) {
            normal.set(
              transformDirection(world, rawNormal[i * 3], rawNormal[i * 3 + 1], rawNormal[i * 3 + 2]),
              i * 3,
            )
          }
        }

        const material = json.materials?.[primitive.material]
        primitives.push({
          position,
          normal,
          index: read(primitive.indices).slice(),
          color: material?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1],
          // The name is how a role travels: glTF has no field for "this is
          // bark", so `build-3d-objects.mjs` writes the role as the material
          // name and the layer reads it back.
          material: material?.name ?? '',
        })
      }
    }
    for (const child of node.children ?? []) visit(child, world)
  }

  const scene = json.scenes?.[json.scene ?? 0]
  for (const root of scene?.nodes ?? json.nodes?.map((_, i) => i) ?? []) visit(root, identity())

  if (!primitives.length) throw new Error('GLB has no primitives')
  return { primitives, min, max }
}

export async function loadGlb(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  return parseGlb(await response.arrayBuffer())
}
