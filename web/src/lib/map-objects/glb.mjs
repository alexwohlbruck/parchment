/**
 * A minimal GLB reader, shared by the app and by `build-3d-objects.mjs`.
 *
 * Deliberately not a glTF library. It reads what a static, flat-or-smooth-
 * shaded model needs and nothing else: node transforms, `POSITION` and
 * `NORMAL` as float vec3, indices, and a material name and base colour per
 * primitive. Skins, animation, sparse accessors, Draco and morph targets are
 * all out of scope — pulling in three.js to avoid 150 lines would add more to
 * the bundle than MapLibre's own renderer costs.
 *
 * One texture is read, for landmarks: a base-colour image with its
 * `TEXCOORD_0`, alpha mode and cutoff. That is what a lattice or a railing is
 * made of — a few quads with holes cut by the alpha — and it is the one thing
 * a stylised building cannot do without. The image is handed back as bytes;
 * decoding it is the renderer's business.
 *
 * Anything outside that throws rather than degrading, because a model that
 * loads wrong draws garbage rather than nothing.
 *
 * Node transforms matter because real exports have them: Kenney's kit wraps
 * every model in a parent node and offsets the mesh inside it, so a reader that
 * ignores the hierarchy places the model slightly underground.
 *
 * Animation is opt-in (`{ animation: true }`), for landmarks that move, such
 * as a turning Ferris wheel. Only rigid node motion is read: the first clip's
 * `translation`, `rotation` and `scale` channels, LINEAR or STEP. Static
 * nodes are still baked into the vertices. A primitive under a moving node is
 * left in that node's frame and tagged with it, and `poseGlb` gives the
 * node's matrix at a moment. A clip this cannot play (cubic splines, morph
 * weights) is dropped, and the model draws as it stands at rest, which
 * is the static model it would otherwise be.
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
  return trsMatrix(node.translation ?? [0, 0, 0], node.rotation ?? [0, 0, 0, 1], node.scale ?? [1, 1, 1])
}

function trsMatrix([tx, ty, tz], [x, y, z, w], [sx, sy, sz]) {
  const m = identity()
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

export function parseGlb(buffer, options = {}) {
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

  const animation = options.animation ? readAnimation(json, read) : null
  /** Rest pose: an animated node as its clip has it at t = 0. */
  const restMatrix = index => animation?.joints.has(index)
    ? localAt(animation, index, 0)
    : nodeMatrix(json.nodes[index])

  /** A texture's image as bytes and type, copied out of the BIN chunk. */
  const imageOf = ref => {
    if (!ref) return null
    const image = json.images?.[json.textures?.[ref.index]?.source]
    if (image?.bufferView === undefined) return null
    const view = json.bufferViews[image.bufferView]
    const start = bin.byteOffset + (view.byteOffset ?? 0)
    return { bytes: new Uint8Array(bin.buffer.slice(start, start + view.byteLength)), mimeType: image.mimeType }
  }

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const primitives = []

  /**
   * Walk the scene so every mesh arrives in the model's own space — or, under
   * a moving node (`joint`), in that node's space. `world` is always the rest
   * pose, which is what the bounds are taken from.
   */
  const visit = (index, parent, parentRelative, parentJoint) => {
    const node = json.nodes[index]
    const local = restMatrix(index)
    const world = multiply(parent, local)
    const moves = !!animation?.joints.has(index)
    const joint = moves ? index : parentJoint
    const relative = moves ? identity() : joint < 0 ? world : multiply(parentRelative, local)
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
          const p = transformPoint(relative, rawPosition[i * 3], rawPosition[i * 3 + 1], rawPosition[i * 3 + 2])
          position.set(p, i * 3)
          const rest = joint < 0 ? p : transformPoint(world, rawPosition[i * 3], rawPosition[i * 3 + 1], rawPosition[i * 3 + 2])
          for (let c = 0; c < 3; c++) {
            min[c] = Math.min(min[c], rest[c])
            max[c] = Math.max(max[c], rest[c])
          }
          if (rawNormal) {
            normal.set(
              transformDirection(relative, rawNormal[i * 3], rawNormal[i * 3 + 1], rawNormal[i * 3 + 2]),
              i * 3,
            )
          }
        }

        const material = json.materials?.[primitive.material]
        const uv = primitive.attributes?.TEXCOORD_0 !== undefined
          ? Float32Array.from(read(primitive.attributes.TEXCOORD_0))
          : null
        primitives.push({
          position,
          normal,
          // Unindexed triangles are legal glTF and what a flat-shaded export
          // often is; a sequential index keeps one draw path for both.
          index: primitive.indices !== undefined
            ? read(primitive.indices).slice()
            : (count > 65535 ? Uint32Array : Uint16Array).from({ length: count }, (_, i) => i),
          uv,
          image: imageOf(material?.pbrMetallicRoughness?.baseColorTexture),
          alphaMode: material?.alphaMode ?? 'OPAQUE',
          alphaCutoff: material?.alphaCutoff ?? 0.5,
          doubleSided: material?.doubleSided ?? false,
          color: material?.pbrMetallicRoughness?.baseColorFactor ?? [1, 1, 1, 1],
          // The name is how a role travels: glTF has no field for "this is
          // bark", so `build-3d-objects.mjs` writes the role as the material
          // name and the layer reads it back.
          material: material?.name ?? '',
          // The moving node this primitive is drawn with, or -1 for none.
          node: joint,
        })
      }
    }
    for (const child of node.children ?? []) visit(child, world, relative, joint)
  }

  const scene = json.scenes?.[json.scene ?? 0]
  for (const root of scene?.nodes ?? json.nodes?.map((_, i) => i) ?? []) visit(root, identity(), identity(), -1)

  if (!primitives.length) throw new Error('GLB has no primitives')
  return { primitives, min, max, animation }
}

const PATHS = { translation: 3, rotation: 4, scale: 3 }

/** Normalised integer keyframes (allowed for rotation) back to floats. */
function toFloat(values, accessor) {
  if (values instanceof Float32Array) return Float32Array.from(values)
  if (!accessor.normalized) throw new Error('animation keyframes must be float or normalised')
  const divisor = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535 }[accessor.componentType]
  return Float32Array.from(values, v => Math.max(v / divisor, -1))
}

/**
 * The first clip, as what `poseGlb` needs: every node's rest TRS and parent,
 * and per channel its keyframes. Null when there is none, or none this can
 * play.
 */
function readAnimation(json, read) {
  const clip = json.animations?.[0]
  if (!clip?.channels?.length) return null
  const nodes = (json.nodes ?? []).map(node => ({
    parent: -1,
    matrix: node.matrix ? node.matrix.slice() : null,
    translation: node.translation ?? [0, 0, 0],
    rotation: node.rotation ?? [0, 0, 0, 1],
    scale: node.scale ?? [1, 1, 1],
  }))
  ;(json.nodes ?? []).forEach((node, i) => { for (const child of node.children ?? []) nodes[child].parent = i })

  const channels = []
  for (const channel of clip.channels) {
    const node = channel.target?.node
    const path = channel.target?.path
    const sampler = clip.samplers?.[channel.sampler]
    const interpolation = sampler?.interpolation ?? 'LINEAR'
    if (!PATHS[path] || (interpolation !== 'LINEAR' && interpolation !== 'STEP')) return null
    // A node given as a matrix cannot be animated (the spec forbids it).
    if (!nodes[node] || nodes[node].matrix) continue
    const times = toFloat(read(sampler.input), json.accessors[sampler.input])
    const values = toFloat(read(sampler.output), json.accessors[sampler.output])
    if (!times.length || values.length !== times.length * PATHS[path]) return null
    channels.push({ node, path, step: interpolation === 'STEP', times, values })
  }
  if (!channels.length) return null
  const duration = Math.max(...channels.map(c => c.times[c.times.length - 1]))
  return { duration, nodes, channels, joints: new Set(channels.map(c => c.node)) }
}

/** Index of the keyframe at or before `t`; `times` ascend. */
function keyBefore(times, t) {
  let lo = 0
  let hi = times.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (times[mid] <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

function slerp(a, b, f) {
  let dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]
  // The short way round: q and -q are the same turn.
  const sign = dot < 0 ? -1 : 1
  dot *= sign
  let ka = 1 - f
  let kb = f * sign
  if (dot < 0.9995) {
    const theta = Math.acos(dot)
    const s = Math.sin(theta)
    ka = Math.sin((1 - f) * theta) / s
    kb = (Math.sin(f * theta) / s) * sign
  }
  const q = [0, 1, 2, 3].map(i => a[i] * ka + b[i] * kb)
  const length = Math.hypot(q[0], q[1], q[2], q[3]) || 1
  return q.map(v => v / length)
}

/** One channel's value at `t` seconds, clamped to its first and last keys. */
export function sampleChannel(channel, t) {
  const { times, values, path, step } = channel
  const n = PATHS[path]
  const at = k => Array.from(values.subarray(k * n, k * n + n))
  const last = times.length - 1
  if (t <= times[0]) return at(0)
  if (t >= times[last]) return at(last)
  const k = keyBefore(times, t)
  if (step) return at(k)
  const f = (t - times[k]) / (times[k + 1] - times[k])
  const a = at(k)
  const b = at(k + 1)
  return path === 'rotation' ? slerp(a, b, f) : a.map((v, i) => v + (b[i] - v) * f)
}

/** A node's local matrix at `t`: its own TRS, with whatever the clip moves. */
function localAt(animation, index, t) {
  const node = animation.nodes[index]
  if (node.matrix) return node.matrix.slice()
  const trs = { translation: node.translation, rotation: node.rotation, scale: node.scale }
  for (const channel of animation.channels) if (channel.node === index) trs[channel.path] = sampleChannel(channel, t)
  return trsMatrix(trs.translation, trs.rotation, trs.scale)
}

/**
 * Where every moving node is `seconds` into the clip, looped: its matrix to
 * the model's own space, by node index. A primitive tagged with that node is
 * drawn through it. Null for a model with nothing that moves.
 */
export function poseGlb(model, seconds) {
  const animation = model.animation
  if (!animation) return null
  const d = animation.duration
  const t = d > 0 ? ((seconds % d) + d) % d : 0
  const world = new Map()
  const worldOf = index => {
    let m = world.get(index)
    if (m) return m
    const node = animation.nodes[index]
    const local = localAt(animation, index, t)
    m = node.parent < 0 ? local : multiply(worldOf(node.parent), local)
    world.set(index, m)
    return m
  }
  const pose = new Map()
  for (const joint of animation.joints) pose.set(joint, Float32Array.from(worldOf(joint)))
  return pose
}

export async function loadGlb(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url}: ${response.status}`)
  return parseGlb(await response.arrayBuffer())
}
