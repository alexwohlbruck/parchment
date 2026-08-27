#!/usr/bin/env node
/**
 * Builds the models the 3D object layer draws.
 *
 * Two kinds of input, one kind of output.
 *
 * Trees come from Kenney's Nature Kit (CC0, vendored under
 * `src/assets/models-src`), because a hand-modelled tree has a silhouette no
 * amount of procedural cylinder-stacking gets to. Street furniture is generated
 * here, because a bin is a cylinder and a bench is six boxes, and getting the
 * proportions right at 1.8m is worth more than getting the style right.
 *
 * Everything is put through the same normalisation, and that is the real job of
 * this script:
 *
 *   role      A primitive's material name becomes `bark`, `foliage`, `metal`,
 *             `wood` or `paint`. glTF has no field for "this is the leafy part",
 *             and the layer needs one so it can recolour per flavor — the
 *             source colours are a game palette (Kenney's leaves are turquoise)
 *             and would look wrong on a map either way.
 *   unit      Scaled and translated so the model is exactly 1 tall with its
 *             base at y=0 and centred on x/z, which is what lets the layer's
 *             only per-instance transform be a height in metres.
 *   smoothing Foliage normals are averaged across faces meeting under a crease
 *             angle, so a canopy reads as a canopy rather than as a stack of
 *             visible triangles. Bark and furniture keep their hard edges.
 *   LOD       A far variant is derived from the bounds of each role, an order
 *             of magnitude cheaper, for the objects too distant to resolve.
 *
 * Output is real GLB — a 12-byte header, a JSON chunk and a BIN chunk — so a
 * model can be opened in any viewer, and so adding an object later is a matter
 * of dropping a .glb in and naming its materials.
 *
 * Run with: bun run build:models
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseGlb } from '../src/lib/map-objects/glb.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const SRC = resolve(HERE, '../src/assets/models-src')
const OUT = resolve(HERE, '../public/models')
const MANIFEST = resolve(HERE, '../src/lib/map-objects/models.json')

/** Suffix on the cheap variant of every model. */
export const FAR_SUFFIX = '-far'

/**
 * Roles, and the default colour each is written with.
 *
 * The layer overrides these per flavor; they are what a viewer shows and what
 * draws if a palette is ever missing, so they are chosen to be plausible rather
 * than to be placeholders.
 */
const ROLE_COLOR = {
  bark: [0.35, 0.27, 0.22, 1],
  foliage: [0.31, 0.52, 0.27, 1],
  metal: [0.42, 0.45, 0.47, 1],
  wood: [0.55, 0.41, 0.28, 1],
  paint: [0.24, 0.42, 0.30, 1],
}

/** Kenney names its materials by what they are, which is most of the work. */
function roleOf(materialName) {
  const name = materialName.toLowerCase()
  if (name.includes('leaf') || name.includes('leafs') || name.includes('foliage')) return 'foliage'
  if (name.includes('wood') || name.includes('bark') || name.includes('trunk')) return 'bark'
  if (ROLE_COLOR[name]) return name
  // `_defaultMat` and friends: the odd extra part on a couple of the pines.
  return 'foliage'
}

/** How far apart two faces can lean and still share a smoothed normal. */
const CREASE_DEGREES = 78

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

function mesh() {
  return { position: [], normal: [], index: [] }
}

function face(m, a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
  const len = Math.hypot(...n) || 1
  const base = m.position.length / 3
  for (const p of [a, b, c]) {
    m.position.push(p[0], p[1], p[2])
    m.normal.push(n[0] / len, n[1] / len, n[2] / len)
  }
  m.index.push(base, base + 1, base + 2)
}

function quad(m, a, b, c, d) {
  face(m, a, b, c)
  face(m, a, c, d)
}

/** An axis-aligned box, corner to corner. */
function box(m, [x0, y0, z0], [x1, y1, z1]) {
  const p = (x, y, z) => [x ? x1 : x0, y ? y1 : y0, z ? z1 : z0]
  quad(m, p(0, 0, 1), p(1, 0, 1), p(1, 1, 1), p(0, 1, 1))
  quad(m, p(1, 0, 0), p(0, 0, 0), p(0, 1, 0), p(1, 1, 0))
  quad(m, p(1, 0, 1), p(1, 0, 0), p(1, 1, 0), p(1, 1, 1))
  quad(m, p(0, 0, 0), p(0, 0, 1), p(0, 1, 1), p(0, 1, 0))
  quad(m, p(0, 1, 1), p(1, 1, 1), p(1, 1, 0), p(0, 1, 0))
  quad(m, p(0, 0, 0), p(1, 0, 0), p(1, 0, 1), p(0, 0, 1))
  return m
}

const ring = (sides, radius, y) =>
  Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2
    return [Math.cos(a) * radius, y, Math.sin(a) * radius]
  })

/** A tapered cylinder, capped top and bottom. */
function cylinder(m, sides, bottomRadius, topRadius, base, height) {
  const lo = ring(sides, bottomRadius, base)
  const hi = ring(sides, topRadius, base + height)
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    quad(m, lo[i], lo[j], hi[j], hi[i])
    face(m, hi[i], hi[j], [0, base + height, 0])
    face(m, lo[j], lo[i], [0, base, 0])
  }
  return m
}

/** A lozenge fitted to a box — the far LOD's stand-in for a canopy. */
function lozenge(m, [x0, y0, z0], [x1, y1, z1], sides = 6, stacks = 3) {
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  const rx = (x1 - x0) / 2
  const rz = (z1 - z0) / 2
  const at = t => {
    // A half-sine profile: widest in the middle, closed at both ends.
    const y = y0 + (y1 - y0) * t
    const r = Math.sin(Math.PI * t) ** 0.65
    return Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2
      return [cx + Math.cos(a) * rx * r, y, cz + Math.sin(a) * rz * r]
    })
  }
  const rings = Array.from({ length: stacks + 1 }, (_, k) => at((k + 0.5) / (stacks + 2)))
  for (let k = 0; k < rings.length - 1; k++)
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides
      quad(m, rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i])
    }
  const bottom = [cx, y0, cz]
  const top = [cx, y1, cz]
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    face(m, rings[0][j], rings[0][i], bottom)
    face(m, rings[rings.length - 1][i], rings[rings.length - 1][j], top)
  }
  return m
}

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * Average normals across faces that meet under the crease angle.
 *
 * Vertices are matched by position, quantised so a float that differs in its
 * last bit still counts as the same corner. The angle limit is what keeps this
 * from rounding off a trunk: a canopy's facets lean gently into each other and
 * get merged, where the sharp edge between a trunk and its cap does not.
 */
function smoothNormals(parts, creaseDegrees) {
  const cosCrease = Math.cos((creaseDegrees * Math.PI) / 180)
  const key = (x, y, z) =>
    `${Math.round(x * 4096)},${Math.round(y * 4096)},${Math.round(z * 4096)}`

  const shared = new Map()
  for (const part of parts) {
    for (let i = 0; i < part.position.length; i += 3) {
      const k = key(part.position[i], part.position[i + 1], part.position[i + 2])
      const list = shared.get(k)
      const entry = { part, i }
      if (list) list.push(entry)
      else shared.set(k, [entry])
    }
  }

  for (const part of parts) {
    const out = new Float32Array(part.normal.length)
    for (let i = 0; i < part.position.length; i += 3) {
      const own = [part.normal[i], part.normal[i + 1], part.normal[i + 2]]
      const group = shared.get(key(part.position[i], part.position[i + 1], part.position[i + 2]))
      let [x, y, z] = [0, 0, 0]
      for (const { part: other, i: j } of group) {
        const n = [other.normal[j], other.normal[j + 1], other.normal[j + 2]]
        if (own[0] * n[0] + own[1] * n[1] + own[2] * n[2] < cosCrease) continue
        x += n[0]
        y += n[1]
        z += n[2]
      }
      const length = Math.hypot(x, y, z) || 1
      out[i] = x / length
      out[i + 1] = y / length
      out[i + 2] = z / length
    }
    part.normal = out
  }
}

/** Scale and shift so the model is one unit tall, based at the origin, centred. */
function toUnit(parts) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const part of parts)
    for (let i = 0; i < part.position.length; i += 3)
      for (let c = 0; c < 3; c++) {
        min[c] = Math.min(min[c], part.position[i + c])
        max[c] = Math.max(max[c], part.position[i + c])
      }

  const scale = 1 / Math.max(max[1] - min[1], 1e-6)
  const cx = (min[0] + max[0]) / 2
  const cz = (min[2] + max[2]) / 2
  for (const part of parts) {
    const out = new Float32Array(part.position.length)
    for (let i = 0; i < part.position.length; i += 3) {
      out[i] = (part.position[i] - cx) * scale
      out[i + 1] = (part.position[i + 1] - min[1]) * scale
      out[i + 2] = (part.position[i + 2] - cz) * scale
    }
    part.position = out
  }
}

function boundsOf(part) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < part.position.length; i += 3)
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c], part.position[i + c])
      max[c] = Math.max(max[c], part.position[i + c])
    }
  return { min, max }
}

/**
 * The far LOD: each role replaced by a solid fitted to its own bounds.
 *
 * Nothing as clever as mesh decimation, and it does not need to be — past the
 * distance this kicks in, a tree is a dozen pixels and only its silhouette and
 * its colour survive. Foliage becomes a lozenge, everything else a prism.
 */
function farLod(parts) {
  const out = []
  for (const part of parts) {
    const { min, max } = boundsOf(part)
    const m = mesh()
    if (part.role === 'foliage') {
      lozenge(m, min, max)
    } else {
      const rx = Math.max((max[0] - min[0]) / 2, 1e-4)
      const rz = Math.max((max[2] - min[2]) / 2, 1e-4)
      cylinder(m, 4, Math.max(rx, rz), Math.max(rx, rz) * 0.85, min[1], max[1] - min[1])
    }
    out.push({ role: part.role, ...m })
  }
  return out
}

// ---------------------------------------------------------------------------
// glTF writing
// ---------------------------------------------------------------------------

const FLOAT = 5126
const USHORT = 5123
const ARRAY_BUFFER = 34962
const ELEMENT_ARRAY_BUFFER = 34963

const align4 = n => (4 - (n % 4)) % 4

/**
 * Merge vertices that agree on both position and normal.
 *
 * Every face is built standalone, so a cube arrives with 36 vertices rather
 * than 24 and a smoothed canopy with one per corner per face rather than one
 * per corner. Welding after smoothing is what makes it worth doing: before it,
 * almost nothing matches; after it, most of a canopy does.
 */
function weld(part) {
  const source = { position: part.position, normal: part.normal }
  const position = []
  const normal = []
  const index = []
  const seen = new Map()
  const q = v => Math.round(v * 8192)
  for (const i of part.index) {
    const [px, py, pz] = [source.position[i * 3], source.position[i * 3 + 1], source.position[i * 3 + 2]]
    const [nx, ny, nz] = [source.normal[i * 3], source.normal[i * 3 + 1], source.normal[i * 3 + 2]]
    const key = `${q(px)},${q(py)},${q(pz)},${q(nx)},${q(ny)},${q(nz)}`
    let at = seen.get(key)
    if (at === undefined) {
      at = position.length / 3
      seen.set(key, at)
      position.push(px, py, pz)
      normal.push(nx, ny, nz)
    }
    index.push(at)
  }
  return {
    position: new Float32Array(position),
    normal: new Float32Array(normal),
    index: new Uint16Array(index),
  }
}

/** One glTF per model, one primitive per role. */
function toGlb(name, parts) {
  const json = {
    asset: { version: '2.0', generator: 'parchment build-3d-objects' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name }],
    meshes: [{ name, primitives: [] }],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  }

  const chunks = []
  let offset = 0
  const view = (data, target) => {
    const bytes = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    const pad = align4(bytes.length)
    chunks.push(bytes, Buffer.alloc(pad))
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: bytes.length, target })
    offset += bytes.length + pad
    return json.bufferViews.length - 1
  }
  const accessor = (bufferView, componentType, count, type, min, max) => {
    json.accessors.push({ bufferView, componentType, count, type, ...(min ? { min, max } : {}) })
    return json.accessors.length - 1
  }

  for (const part of parts) {
    const { position, normal, index } = weld(part)
    if (position.length / 3 > 65535) throw new Error(`${name}: too many vertices for 16-bit indices`)

    const count = position.length / 3
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < count; i++)
      for (let c = 0; c < 3; c++) {
        min[c] = Math.min(min[c], position[i * 3 + c])
        max[c] = Math.max(max[c], position[i * 3 + c])
      }

    const pos = accessor(view(position, ARRAY_BUFFER), FLOAT, count, 'VEC3', min, max)
    const nrm = accessor(view(normal, ARRAY_BUFFER), FLOAT, count, 'VEC3')
    const idx = accessor(view(index, ELEMENT_ARRAY_BUFFER), USHORT, index.length, 'SCALAR')
    json.materials.push({
      // The role, which is the whole reason this script exists.
      name: part.role,
      pbrMetallicRoughness: {
        baseColorFactor: ROLE_COLOR[part.role] ?? ROLE_COLOR.foliage,
        metallicFactor: 0,
        roughnessFactor: 0.9,
      },
    })
    json.meshes[0].primitives.push({
      attributes: { POSITION: pos, NORMAL: nrm },
      indices: idx,
      material: json.materials.length - 1,
    })
  }

  const bin = Buffer.concat(chunks)
  json.buffers.push({ byteLength: bin.length })

  const jsonText = Buffer.from(JSON.stringify(json), 'utf8')
  const jsonChunk = Buffer.concat([jsonText, Buffer.alloc(align4(jsonText.length), 0x20)])

  const header = Buffer.alloc(12)
  header.writeUInt32LE(0x46546c67, 0) // "glTF"
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonChunk.length + 8 + bin.length, 8)

  const chunkHeader = (length, type) => {
    const b = Buffer.alloc(8)
    b.writeUInt32LE(length, 0)
    b.writeUInt32LE(type, 4)
    return b
  }

  return Buffer.concat([
    header,
    chunkHeader(jsonChunk.length, 0x4e4f534a),
    jsonChunk,
    chunkHeader(bin.length, 0x004e4942),
    bin,
  ])
}

// ---------------------------------------------------------------------------
// Street furniture
// ---------------------------------------------------------------------------

/**
 * Generated rather than sourced, because these are simple solids whose
 * *proportions* carry the recognition — a bin is a 0.9m drum, a bench is 1.8m
 * long and 0.45m to the seat — and a game-kit prop would have to be
 * re-proportioned anyway. Modelled at real size in metres; `toUnit` rescales.
 */
const FURNITURE = {
  'waste-basket': () => {
    const drum = mesh()
    cylinder(drum, 10, 0.21, 0.25, 0.12, 0.78)
    const post = mesh()
    cylinder(post, 6, 0.05, 0.05, 0, 0.16)
    return [
      { role: 'metal', ...drum },
      { role: 'metal', ...post },
    ]
  },
  recycling: () => {
    const body = mesh()
    box(body, [-0.38, 0, -0.32], [0.38, 1.0, 0.32])
    const lid = mesh()
    box(lid, [-0.41, 1.0, -0.35], [0.41, 1.1, 0.35])
    return [
      { role: 'paint', ...body },
      { role: 'metal', ...lid },
    ]
  },
  bench: () => {
    const seat = mesh()
    // Slats, so a bench reads as a bench from above rather than as a plank.
    for (let i = 0; i < 3; i++) {
      const z = -0.24 + i * 0.18
      box(seat, [-0.9, 0.42, z], [0.9, 0.47, z + 0.13])
    }
    const back = mesh()
    for (let i = 0; i < 2; i++) {
      const y = 0.62 + i * 0.17
      box(back, [-0.9, y, 0.24], [0.9, y + 0.12, 0.3])
    }
    const legs = mesh()
    for (const x of [-0.78, 0.78]) {
      box(legs, [x - 0.04, 0, -0.28], [x + 0.04, 0.44, -0.2])
      box(legs, [x - 0.04, 0, 0.22], [x + 0.04, 0.82, 0.3])
    }
    return [
      { role: 'wood', ...seat },
      { role: 'wood', ...back },
      { role: 'metal', ...legs },
    ]
  },
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

/**
 * Which vendored model each named tree uses.
 *
 * Several per species on purpose: `trees.ts` picks between them from the
 * feature's id, so a street is a row of different trees rather than one tree
 * repeated, which is the single biggest thing separating this from a diagram.
 */
const TREES = {
  'tree-broadleaf-a': 'tree_default',
  'tree-broadleaf-b': 'tree_oak',
  'tree-broadleaf-c': 'tree_fat',
  'tree-broadleaf-d': 'tree_detailed',
  'tree-conifer-a': 'tree_pineRoundA',
  'tree-conifer-b': 'tree_pineRoundC',
  'tree-conifer-c': 'tree_pineTallA',
  'tree-conifer-d': 'tree_cone',
  'tree-palm-a': 'tree_palm',
  'tree-palm-b': 'tree_palmTall',
  'tree-palm-c': 'tree_palmShort',
}

async function loadSource(file) {
  const bytes = await readFile(join(SRC, `${file}.glb`))
  const model = parseGlb(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  )
  // Merge the source's primitives by role, so a model that splits its canopy
  // across two materials still comes out as one foliage primitive.
  const byRole = new Map()
  for (const primitive of model.primitives) {
    const role = roleOf(primitive.material)
    const existing = byRole.get(role)
    if (!existing) {
      byRole.set(role, {
        role,
        position: Array.from(primitive.position),
        normal: Array.from(primitive.normal),
        index: Array.from(primitive.index),
      })
      continue
    }
    const base = existing.position.length / 3
    existing.position.push(...primitive.position)
    existing.normal.push(...primitive.normal)
    for (const i of primitive.index) existing.index.push(i + base)
  }
  return [...byRole.values()].map(part => ({
    role: part.role,
    position: new Float32Array(part.position),
    normal: new Float32Array(part.normal),
    index: part.index,
  }))
}

// ---------------------------------------------------------------------------

async function main() {
  await mkdir(OUT, { recursive: true })
  const written = []
  const manifest = []

  const emit = async (name, parts) => {
    toUnit(parts)
    // Only the leafy parts. Smoothing bark rounds off the trunk's cap edge,
    // and smoothing a bench turns its slats into a ramp.
    const foliage = parts.filter(p => p.role === 'foliage')
    if (foliage.length) smoothNormals(foliage, CREASE_DEGREES)

    const near = toGlb(name, parts)
    await writeFile(join(OUT, `${name}.glb`), near)
    manifest.push(name)

    const tris = n => n.reduce((t, p) => t + p.index.length / 3, 0)
    const far = farLod(parts)
    toUnit(far)

    // A model can already be cheaper than its own proxy — the fitted solids
    // have a fixed tessellation, and a 24-triangle bin does not need standing
    // in for. Writing one anyway would make the far draw the expensive one, so
    // it is skipped and the layer keeps using the near model at every distance.
    const worthIt = tris(far) < tris(parts)
    let farNote = 'far n/a (already cheap)'
    if (worthIt) {
      const farGlb = toGlb(`${name}${FAR_SUFFIX}`, far)
      await writeFile(join(OUT, `${name}${FAR_SUFFIX}.glb`), farGlb)
      manifest.push(`${name}${FAR_SUFFIX}`)
      farNote = `far ${String(tris(far)).padStart(3)} tris ${(farGlb.length / 1024).toFixed(1)} KB`
    }

    written.push(
      `${name.padEnd(20)} ${String(tris(parts)).padStart(4)} tris ` +
        `${(near.length / 1024).toFixed(1).padStart(5)} KB   ${farNote}`,
    )
  }

  const available = new Set((await readdir(SRC)).map(f => f.replace(/\.glb$/, '')))
  for (const [name, source] of Object.entries(TREES)) {
    if (!available.has(source)) throw new Error(`missing vendored model: ${source}.glb`)
    await emit(name, await loadSource(source))
  }
  for (const [name, build] of Object.entries(FURNITURE)) await emit(name, build())

  // What was actually written, so the app asks for exactly that. Not every
  // model earns a far variant, and a request for one that was skipped is a 404
  // that takes the whole layer down with it.
  await writeFile(MANIFEST, `${JSON.stringify(manifest.sort(), null, 2)}\n`)

  for (const line of written) console.log(line)
  console.log(`${written.length} models, ${manifest.length} files`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
