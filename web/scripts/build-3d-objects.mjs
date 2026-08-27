#!/usr/bin/env node
/**
 * Generates the glTF models the 3D object layer draws.
 *
 * Written rather than sourced, for two reasons. Licensing: a map ships to
 * users, and a CC-BY tree model would put an attribution obligation on the
 * whole app for something this small. And control: these are drawn thousands at
 * a time by `map-objects/object-layer.ts`, so the budget is a few hundred
 * triangles each, every vertex has to be flat-shaded from a hard normal, and
 * the model has to be exactly one unit tall with its origin at the base — which
 * is what lets the layer scale one by a tree's height in metres.
 *
 * Output is real GLB: a 12-byte header, a JSON chunk and a BIN chunk. Valid
 * enough to open in any glTF viewer, which is the point — adding a bench later
 * means dropping a .glb in `public/models`, not extending this script.
 *
 * Run with: bun run build:models
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../public/models')

// glTF is Y-up. The layer swaps to Z-up on load; keeping the asset in the
// standard orientation is what makes it openable anywhere else.
const UP = 'y'

// --- geometry ---------------------------------------------------------------

/**
 * A mesh being accumulated. Positions and normals are per-vertex and never
 * shared between faces: these are flat-shaded, and a shared vertex would
 * average the two faces' normals into a smooth one.
 */
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

const ring = (sides, radius, y) =>
  Array.from({ length: sides }, (_, i) => {
    const a = (i / sides) * Math.PI * 2
    return [Math.cos(a) * radius, y, Math.sin(a) * radius]
  })

/** A tapered cylinder, capped at the top only — the base is never seen. */
function trunk(sides, bottomRadius, topRadius, height) {
  const m = mesh()
  const lo = ring(sides, bottomRadius, 0)
  const hi = ring(sides, topRadius, height)
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    face(m, lo[i], lo[j], hi[j])
    face(m, lo[i], hi[j], hi[i])
  }
  const top = [0, height, 0]
  for (let i = 0; i < sides; i++) face(m, hi[i], hi[(i + 1) % sides], top)
  return m
}

/** A cone, for the conifer's canopy. */
function cone(sides, radius, base, height) {
  const m = mesh()
  const lo = ring(sides, radius, base)
  const apex = [0, base + height, 0]
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    face(m, lo[i], lo[j], apex)
    face(m, lo[j], lo[i], [0, base, 0])
  }
  return m
}

/**
 * A canopy: stacked rings from a wide waist to a rounded crown, faceted rather
 * than smooth. Cheaper than a sphere and it reads better at map scale — a
 * broadleaf canopy is lumpy, not spherical.
 */
function canopy(sides, radius, base, height) {
  const m = mesh()
  const profile = [
    [0.62, 0.0],
    [1.0, 0.28],
    [0.94, 0.62],
    [0.58, 0.87],
  ]
  const rings = profile.map(([r, t]) => ring(sides, radius * r, base + height * t))
  for (let k = 0; k < rings.length - 1; k++) {
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides
      face(m, rings[k][i], rings[k][j], rings[k + 1][j])
      face(m, rings[k][i], rings[k + 1][j], rings[k + 1][i])
    }
  }
  const apex = [0, base + height, 0]
  const bottom = [0, base, 0]
  const last = rings[rings.length - 1]
  for (let i = 0; i < sides; i++) {
    face(m, last[i], last[(i + 1) % sides], apex)
    face(m, rings[0][(i + 1) % sides], rings[0][i], bottom)
  }
  return m
}

// --- glTF assembly ----------------------------------------------------------

const FLOAT = 5126
const USHORT = 5123
const ARRAY_BUFFER = 34962
const ELEMENT_ARRAY_BUFFER = 34963

function align4(n) {
  return (4 - (n % 4)) % 4
}

/**
 * One glTF per model, with one primitive per material — the trunk and the
 * canopy, so the layer can colour them separately without a texture.
 */
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

  for (const { geometry, color } of parts) {
    const position = new Float32Array(geometry.position)
    const normal = new Float32Array(geometry.normal)
    const index = new Uint16Array(geometry.index)
    const count = position.length / 3
    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < count; i++) {
      for (let c = 0; c < 3; c++) {
        min[c] = Math.min(min[c], position[i * 3 + c])
        max[c] = Math.max(max[c], position[i * 3 + c])
      }
    }
    const pos = accessor(view(position, ARRAY_BUFFER), FLOAT, count, 'VEC3', min, max)
    const nrm = accessor(view(normal, ARRAY_BUFFER), FLOAT, count, 'VEC3')
    const idx = accessor(view(index, ELEMENT_ARRAY_BUFFER), USHORT, index.length, 'SCALAR')
    json.materials.push({
      pbrMetallicRoughness: { baseColorFactor: color, metallicFactor: 0, roughnessFactor: 0.9 },
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
  const jsonPad = Buffer.alloc(align4(jsonText.length), 0x20) // spaces, per spec
  const jsonChunk = Buffer.concat([jsonText, jsonPad])

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
    chunkHeader(jsonChunk.length, 0x4e4f534a), // JSON
    jsonChunk,
    chunkHeader(bin.length, 0x004e4942), // BIN
    bin,
  ])
}

// --- models -----------------------------------------------------------------

/**
 * Both are one unit tall with their origin at the base, so the layer's only
 * per-instance transform is a height in metres, a heading and a lateral scale.
 */
const MODELS = {
  'tree-broadleaf': [
    { geometry: trunk(6, 0.05, 0.035, 0.42), color: [0.36, 0.28, 0.22, 1] },
    { geometry: canopy(8, 0.34, 0.3, 0.7), color: [0.33, 0.55, 0.28, 1] },
  ],
  'tree-conifer': [
    { geometry: trunk(6, 0.045, 0.03, 0.24), color: [0.34, 0.26, 0.21, 1] },
    { geometry: cone(8, 0.26, 0.18, 0.82), color: [0.22, 0.42, 0.28, 1] },
  ],
}

async function main() {
  await mkdir(OUT, { recursive: true })
  for (const [name, parts] of Object.entries(MODELS)) {
    const glb = toGlb(name, parts)
    await writeFile(join(OUT, `${name}.glb`), glb)
    const tris = parts.reduce((n, p) => n + p.geometry.index.length / 3, 0)
    console.log(`${name}.glb: ${tris} triangles, ${(glb.length / 1024).toFixed(1)} KB, ${UP}-up`)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
