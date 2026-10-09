#!/usr/bin/env node
/**
 * Builds the models the 3D object layer draws.
 *
 * Everything here is generated. Trees are built from lumpy ellipsoids and
 * jittered cone tiers, so a crown is round from every side — including straight
 * down, where a low-poly game asset reads as a hexagon. Street furniture is
 * built from boxes and cylinders, because a bin is a drum and a bench is a few
 * slats, and getting the proportions right at 1.8m is what carries recognition.
 *
 * Everything is put through the same normalisation, and that is the real job of
 * this script:
 *
 *   role      Every part is tagged `bark`, `foliage`, `metal`, `wood` or
 *             `paint` (and so on — see `ROLE_COLOR`), written as its material name, so the layer can colour
 *             it per flavor.
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
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, '../public/models')
const MANIFEST = resolve(HERE, '../src/lib/map-objects/models.json')

/** Suffix on the cheap variant of every model. */
export const FAR_SUFFIX = '-far'
/** Suffix on a tree's trunkless crown; see `crownOnly`. */
const CROWN_SUFFIX = '-crown'

/**
 * Roles, and the default colour each is written with.
 *
 * The layer overrides these per flavor; they are what a viewer shows and what
 * draws if a palette is ever missing, so they are chosen to be plausible rather
 * than to be placeholders.
 */
const ROLE_COLOR = {
  bark: [0.35, 0.27, 0.22, 1],
  'palm-bark': [0.47, 0.44, 0.4, 1],
  foliage: [0.31, 0.52, 0.27, 1],
  metal: [0.42, 0.45, 0.47, 1],
  wood: [0.55, 0.41, 0.28, 1],
  paint: [0.24, 0.42, 0.30, 1],
  interior: [0.16, 0.18, 0.17, 1],
  bench: [0.87, 0.78, 0.66, 1],
  bin: [0.34, 0.36, 0.38, 1],
  recycling: [0.2, 0.33, 0.52, 1],
  spray: [0.9, 0.95, 0.99, 1],
  stone: [0.74, 0.72, 0.68, 1],
  water: [0.45, 0.62, 0.72, 1],
  lamp: [1, 0.93, 0.76, 1],
  panel: [0.93, 0.92, 0.89, 1],
  net: [0.25, 0.27, 0.27, 1],
  tape: [0.95, 0.95, 0.93, 1],
  rim: [0.86, 0.4, 0.16, 1],
  frame: [0.95, 0.95, 0.94, 1],
  goalpost: [0.95, 0.8, 0.2, 1],
  wire: [0.2, 0.21, 0.22, 1],
  mesh: [0.68, 0.7, 0.7, 1],
  bloom: [0.86, 0.5, 0.66, 1],
  pv: [0.16, 0.22, 0.34, 1],
  lattice: [0.62, 0.64, 0.66, 1],
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

const ring = (sides, radius, y, phase = 0) =>
  Array.from({ length: sides }, (_, i) => {
    const a = ((i + phase) / sides) * Math.PI * 2
    return [Math.cos(a) * radius, y, Math.sin(a) * radius]
  })

/** A tapered cylinder, capped top and bottom. */
function cylinder(m, sides, bottomRadius, topRadius, base, height, phase = 0) {
  const lo = ring(sides, bottomRadius, base, phase)
  const hi = ring(sides, topRadius, base + height, phase)
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    quad(m, lo[i], lo[j], hi[j], hi[i])
    face(m, hi[i], hi[j], [0, base + height, 0])
    face(m, lo[j], lo[i], [0, base, 0])
  }
  return m
}

/** A lozenge fitted to a box — the far LOD's stand-in for a canopy. */
function lozenge(m, [x0, y0, z0], [x1, y1, z1], sides = 9, stacks = 3) {
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
function toUnit(parts, fit) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const part of parts)
    for (let i = 0; i < part.position.length; i += 3)
      for (let c = 0; c < 3; c++) {
        min[c] = Math.min(min[c], part.position[i + c])
        max[c] = Math.max(max[c], part.position[i + c])
      }

  // A model's own far variant reuses its transform, so the two line up exactly.
  const { scale, cx, cz, base } = fit ?? {
    scale: 1 / Math.max(max[1] - min[1], 1e-6),
    cx: (min[0] + max[0]) / 2,
    cz: (min[2] + max[2]) / 2,
    base: min[1],
  }
  for (const part of parts) {
    const out = new Float32Array(part.position.length)
    for (let i = 0; i < part.position.length; i += 3) {
      out[i] = (part.position[i] - cx) * scale
      out[i + 1] = (part.position[i + 1] - base) * scale
      out[i + 2] = (part.position[i + 2] - cz) * scale
    }
    part.position = out
  }
  return { scale, cx, cz, base }
}

/**
 * The bounds of the geometry a part actually draws.
 *
 * Walks the index rather than the position array, which is not a detail: glTF
 * lets several primitives share one vertex buffer and differ only by their
 * indices, and many exporters do exactly that. Every part of a tree
 * therefore *owns* a position array spanning the whole tree, and measuring it
 * directly gives the trunk the bounds of the canopy — which is what wrapped
 * every distant tree in a brown crate as tall and as wide as itself.
 */
function boundsOf(part) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const v of part.index)
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c], part.position[v * 3 + c])
      max[c] = Math.max(max[c], part.position[v * 3 + c])
    }
  return { min, max }
}

/**
 * How much of a trunk counts as "the bottom", for measuring its girth.
 *
 * A trunk's bounding box is not its width. A trunk with limbs carries them
 * as part of the trunk, so the box around one is as wide and as tall as the
 * whole tree — fitting a prism to it wrapped every distant tree in a brown
 * crate with the canopy poking out. Measuring across the bottom of the trunk,
 * below where it forks, gives the girth you actually want.
 */
const TRUNK_SAMPLE = 0.25

/** The radius of a part across its lowest slice, about its own axis. */
function baseRadius(part, min, max) {
  const cut = min[1] + (max[1] - min[1]) * TRUNK_SAMPLE
  let radius = 0
  for (const v of part.index) {
    if (part.position[v * 3 + 1] > cut) continue
    radius = Math.max(radius, Math.hypot(part.position[v * 3], part.position[v * 3 + 2]))
  }
  // Nothing down there to measure — fall back to the box, which is at least
  // never smaller than the thing it is standing in for.
  return radius > 1e-4 ? radius : Math.max((max[0] - min[0]) / 2, (max[2] - min[2]) / 2, 1e-4)
}

/** Welded vertex ids for one part, so a corner split for its normals is one point. */
function weldedFaces(part) {
  const ids = new Map()
  const idOf = v => {
    const key = `${part.position[v * 3].toFixed(5)},${part.position[v * 3 + 1].toFixed(5)},${part.position[v * 3 + 2].toFixed(5)}`
    if (!ids.has(key)) ids.set(key, ids.size)
    return ids.get(key)
  }
  const faces = []
  for (let i = 0; i < part.index.length; i += 3)
    faces.push([idOf(part.index[i]), idOf(part.index[i + 1]), idOf(part.index[i + 2])])
  return faces
}

/** How many triangles sit on each undirected edge. */
function edgeUse(part) {
  const uses = new Map()
  for (const [a, b, c] of weldedFaces(part))
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? `${u}_${v}` : `${v}_${u}`
      uses.set(key, (uses.get(key) ?? 0) + 1)
    }
  return uses
}

/** No edge carries more than two triangles — the condition for orienting one. */
function isManifold(part) {
  for (const n of edgeUse(part).values()) if (n > 2) return false
  return true
}

/**
 * Can this part be drawn with back faces culled?
 *
 * Culling a solid removes the half of it nobody can see. Culling anything else
 * removes geometry that was doing a job: an unpaired edge means a hole to see
 * through, and a triangle wound against its neighbours faces the wrong way and
 * disappears. Either shows up as exactly the shattering that culling is there
 * to prevent, so the models that fail this are drawn double-sided instead.
 */
function isSolid(part) {
  if (!isManifold(part)) return false
  for (const n of edgeUse(part).values()) if (n !== 2) return false
  const directed = new Set()
  for (const [a, b, c] of weldedFaces(part))
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = `${u}>${v}`
      if (directed.has(key)) return false
      directed.add(key)
    }
  return signedVolume(part) > 0
}

/** Twice the enclosed volume, positive when the faces face outwards. */
function signedVolume(part) {
  let volume = 0
  const at = v => [part.position[v * 3], part.position[v * 3 + 1], part.position[v * 3 + 2]]
  for (let i = 0; i < part.index.length; i += 3) {
    const [a, b, c] = [at(part.index[i]), at(part.index[i + 1]), at(part.index[i + 2])]
    volume +=
      (a[0] * (b[1] * c[2] - b[2] * c[1]) -
        a[1] * (b[0] * c[2] - b[2] * c[0]) +
        a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
  }
  return volume
}

/**
 * Wind every triangle the same way round, facing out.
 *
 * The layer culls back faces, so which way a triangle faces stops being a
 * detail and becomes the difference between drawing it and not. Two sources of
 * geometry meet here and neither could be trusted on its own: `cylinder` and
 * `lozenge` build their walls clockwise, so every far model came out inside
 * out, and imported models commonly carry triangles wound against
 * their neighbours — 186 of 190 in one case. Culled, those become holes, and a
 * hole in a crown looks exactly like the depth-fighting this was meant to cure.
 *
 * Two passes. First make each connected shell agree with itself, by walking
 * face to face across shared edges and flipping any neighbour that traverses
 * the shared edge the same way round rather than the opposite way. Then decide
 * which way *out* is: a closed shell encloses a positive volume when its faces
 * face outwards, so a negative one gets turned inside out wholesale. A shell
 * with a boundary has no volume to measure, so it is pointed away from the
 * model's own centre instead, which is right for a palm frond and harmless for
 * anything else.
 *
 * Normals follow the geometry — a flipped face takes negated normals — so the
 * source's smooth shading survives the trip.
 */
function orientFaces(part) {
  // Only where "the same way round" means anything. An edge with three or four
  // triangles on it has no consistent answer, and walking one anyway does not
  // fail quietly: run over a non-manifold conifer it flipped a skirt and left the
  // model with seventy-two edges bounding nothing, which is a hole.
  if (!isManifold(part)) return false

  const ids = new Map()
  const idOf = v => {
    const key = `${part.position[v * 3].toFixed(5)},${part.position[v * 3 + 1].toFixed(5)},${part.position[v * 3 + 2].toFixed(5)}`
    if (!ids.has(key)) ids.set(key, ids.size)
    return ids.get(key)
  }
  const faces = []
  for (let i = 0; i < part.index.length; i += 3)
    faces.push({
      corners: [part.index[i], part.index[i + 1], part.index[i + 2]],
      welded: [idOf(part.index[i]), idOf(part.index[i + 1]), idOf(part.index[i + 2])],
      flipped: false,
    })

  const edges = new Map()
  faces.forEach((face, f) => {
    const [a, b, c] = face.welded
    for (const [u, v] of [[a, b], [b, c], [c, a]]) {
      const key = u < v ? `${u}_${v}` : `${v}_${u}`
      const list = edges.get(key)
      if (list) list.push(f)
      else edges.set(key, [f])
    }
  })

  /** Does this face traverse the edge u→v, given how it has been flipped? */
  const traverses = (face, u, v) => {
    const [a, b, c] = face.flipped ? [face.welded[0], face.welded[2], face.welded[1]] : face.welded
    return (a === u && b === v) || (b === u && c === v) || (c === u && a === v)
  }

  const at = v => [0, 1, 2].map(c => part.position[v * 3 + c])
  const seen = new Array(faces.length).fill(false)
  let changed = false

  for (let seed = 0; seed < faces.length; seed++) {
    if (seen[seed]) continue
    const shell = []
    const queue = [seed]
    seen[seed] = true
    while (queue.length) {
      const f = queue.pop()
      shell.push(f)
      const [a, b, c] = faces[f].flipped
        ? [faces[f].welded[0], faces[f].welded[2], faces[f].welded[1]]
        : faces[f].welded
      for (const [u, v] of [[a, b], [b, c], [c, a]]) {
        const key = u < v ? `${u}_${v}` : `${v}_${u}`
        for (const g of edges.get(key) ?? []) {
          if (g === f || seen[g]) continue
          seen[g] = true
          // Agreeing neighbours traverse a shared edge in opposite
          // directions. One that traverses it the same way is inside out.
          if (traverses(faces[g], u, v)) {
            faces[g].flipped = true
            changed = true
          }
          queue.push(g)
        }
      }
    }

    // Which way is out? Enclosed volume where there is one, otherwise the
    // direction away from the model's own middle.
    let volume = 0
    let outward = 0
    const centre = [0, 0, 0]
    for (const f of shell)
      for (const corner of faces[f].corners) {
        const p = at(corner)
        for (let c = 0; c < 3; c++) centre[c] += p[c] / (shell.length * 3)
      }
    for (const f of shell) {
      const [x, y, z] = faces[f].flipped
        ? [faces[f].corners[0], faces[f].corners[2], faces[f].corners[1]]
        : faces[f].corners
      const [a, b, c] = [at(x), at(y), at(z)]
      volume +=
        (a[0] * (b[1] * c[2] - b[2] * c[1]) -
          a[1] * (b[0] * c[2] - b[2] * c[0]) +
          a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
      const mid = [0, 1, 2].map(i => (a[i] + b[i] + c[i]) / 3 - centre[i])
      outward += n[0] * mid[0] + n[1] * mid[1] + n[2] * mid[2]
    }
    const inside = Math.abs(volume) > 1e-9 ? volume < 0 : outward < 0
    if (inside) {
      for (const f of shell) faces[f].flipped = !faces[f].flipped
      changed = true
    }
  }

  if (!changed) return false

  // Rebuilt unindexed so a corner shared by a flipped and an unflipped face
  // can carry a different normal for each. `weld` re-indexes at write time.
  const position = []
  const normal = []
  const index = []
  for (const face of faces) {
    const corners = face.flipped
      ? [face.corners[0], face.corners[2], face.corners[1]]
      : face.corners
    for (const corner of corners) {
      const base = position.length / 3
      index.push(base)
      for (let c = 0; c < 3; c++) {
        position.push(part.position[corner * 3 + c])
        normal.push(face.flipped ? -part.normal[corner * 3 + c] : part.normal[corner * 3 + c])
      }
    }
  }
  part.position = new Float32Array(position)
  part.normal = new Float32Array(normal)
  part.index = index
  return true
}

/**
 * Close every hole in a part, so back-face culling is safe.
 *
 * The layer culls back faces, which it has to: in the plan view the depth
 * buffer cannot separate the front of a crown from its back, and a back face
 * winning a fragment shades it by the opposite normal — the crown breaks into
 * light and dark wedges that crawl as the camera moves. Culling settles it, but
 * only for a mesh with an inside: cull an open shell and you see straight
 * through it. A conifer built from open skirts is open underneath, and culling
 * them punched a white hole through the bottom of every tree.
 *
 * So the holes are filled here rather than worked around at draw time. A
 * boundary edge is one used by a single triangle; chained head to tail those
 * edges form loops, and a fan from each loop's centroid caps it. The caps face
 * away from the surface they close — traversed in the opposite direction to the
 * boundary, which is what the neighbouring triangle would have done — and end
 * up underneath the tree where nobody sees them. They exist to be culled.
 */
function capHoles(part) {
  // Same restriction as `orientFaces`: an edge with three triangles on it is a
  // junction, not a rim, and chaining rims through one caps across the model.
  if (!isManifold(part)) return 0

  // Welded by position: a corner split for its normals is one point here, or
  // every seam would read as a hole.
  const ids = new Map()
  const key = i => {
    const k = `${part.position[i * 3].toFixed(5)},${part.position[i * 3 + 1].toFixed(5)},${part.position[i * 3 + 2].toFixed(5)}`
    if (!ids.has(k)) ids.set(k, { id: ids.size, vertex: i })
    return ids.get(k).id
  }
  const point = []
  const welded = []
  for (let i = 0; i < part.index.length; i++) welded.push(key(part.index[i]))
  for (const { id, vertex } of ids.values()) point[id] = vertex

  const directed = new Set()
  for (let i = 0; i < welded.length; i += 3) {
    const [a, b, c] = [welded[i], welded[i + 1], welded[i + 2]]
    for (const [u, v] of [[a, b], [b, c], [c, a]]) directed.add(`${u}>${v}`)
  }
  // A boundary edge has no twin running the other way.
  const next = new Map()
  for (const edge of directed) {
    const [u, v] = edge.split('>').map(Number)
    if (!directed.has(`${v}>${u}`)) next.set(u, v)
  }
  if (!next.size) return 0

  const at = id => [0, 1, 2].map(c => part.position[point[id] * 3 + c])
  const position = Array.from(part.position)
  const normal = Array.from(part.normal)
  const index = Array.from(part.index)
  let capped = 0

  const unvisited = new Set(next.keys())
  while (unvisited.size) {
    const start = unvisited.values().next().value
    const loop = []
    let at_ = start
    // Bounded: a malformed loop must not spin forever, and a hole nobody can
    // chain is better left open than left hanging.
    while (unvisited.has(at_) && loop.length <= next.size) {
      unvisited.delete(at_)
      loop.push(at_)
      at_ = next.get(at_)
    }
    if (at_ !== start || loop.length < 3) continue

    const centre = [0, 0, 0]
    for (const id of loop) {
      const p = at(id)
      for (let c = 0; c < 3; c++) centre[c] += p[c] / loop.length
    }
    const base = position.length / 3
    // One fan per loop, flat shaded from each triangle's own geometry.
    for (let i = 0; i < loop.length; i++) {
      const a = at(loop[(i + 1) % loop.length])
      const b = at(loop[i])
      const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const v = [centre[0] - a[0], centre[1] - a[1], centre[2] - a[2]]
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
      const len = Math.hypot(...n) || 1
      const first = position.length / 3
      for (const p of [a, b, centre]) {
        position.push(p[0], p[1], p[2])
        normal.push(n[0] / len, n[1] / len, n[2] / len)
      }
      index.push(first, first + 1, first + 2)
    }
    if (position.length / 3 > base) capped++
  }

  part.position = new Float32Array(position)
  part.normal = new Float32Array(normal)
  part.index = index
  return capped
}

/**
 * How thick a trunk may be, as a fraction of the crown's radius.
 *
 * A ceiling on the widest point of the trunk, which on most of these models is
 * the flare where it meets the ground. That matters for reading the number:
 * the shaft above the flare comes out around half of it, so this is roughly
 * twice as generous as it sounds.
 *
 * Game-kit trees are modelled to read at arm's length, where a chunky
 * trunk is part of the style — theirs run from 15% of the crown up to 68%, and
 * one is very nearly as wide as the tree. Seen from above that is a brown post
 * with a bush balanced on it. But a real street tree is nearer 5%, and cutting
 * to anywhere near that turns the trunk into a wire and leaves the crown
 * looking like it is floating on a stick — which is what 14% did.
 *
 * So: enough to bring the worst offenders down by half or more, and little
 * enough to leave the already-reasonable ones alone entirely.
 */
const TRUNK_RATIO = 0.3

/**
 * Slim every trunk to `TRUNK_RATIO` of its own crown.
 *
 * Scaled about the model's axis rather than set to a fixed width, so a tree
 * whose trunk leans, forks or splits into two legs keeps its shape — only its
 * girth changes. Branches inside the crown are scaled too, which is invisible:
 * they are behind the foliage they hold up.
 *
 * Trunks already this slim are left alone. Nothing here is scaled *up*.
 */
function slimTrunks(parts) {
  const bark = parts.filter(p => p.role === 'bark')
  const foliage = parts.filter(p => p.role === 'foliage' || p.role === 'spray')
  if (!bark.length || !foliage.length) return

  const spread = (list, below = Infinity) => {
    let radius = 0
    for (const part of list)
      for (const v of part.index) {
        if (part.position[v * 3 + 1] > below) continue
        radius = Math.max(radius, Math.hypot(part.position[v * 3], part.position[v * 3 + 2]))
      }
    return radius
  }

  // Measured below the crown, since that is the length of trunk anyone sees.
  let crownBottom = Infinity
  for (const part of foliage)
    for (const v of part.index) crownBottom = Math.min(crownBottom, part.position[v * 3 + 1])

  const trunk = spread(bark, crownBottom)
  const crown = spread(foliage)
  if (trunk < 1e-4 || crown < 1e-4) return
  const scale = Math.min(1, (TRUNK_RATIO * crown) / trunk)
  if (scale > 0.999) return

  for (const part of bark) {
    const out = new Float32Array(part.position.length)
    for (let i = 0; i < part.position.length; i += 3) {
      out[i] = part.position[i] * scale
      out[i + 1] = part.position[i + 1]
      out[i + 2] = part.position[i + 2] * scale
    }
    part.position = out
  }
  return scale
}

/**
 * The far LOD: each role replaced by a solid fitted to its own silhouette.
 *
 * Nothing as clever as mesh decimation, and it does not need to be — past the
 * distance this kicks in, a tree is a dozen pixels and only its outline and its
 * colour survive. Foliage becomes a lozenge; a trunk becomes a tapered post as
 * thick as the real trunk is at the ground, not as thick as its branches reach.
 */
function farLod(parts) {
  const out = []
  for (const part of parts) {
    const { min, max } = boundsOf(part)
    const m = mesh()
    if (part.role === 'foliage') {
      lozenge(m, min, max)
    } else {
      const radius = baseRadius(part, min, max)
      // Five sides rather than four: a square post reads as a crate at any
      // distance close enough to make out an edge.
      cylinder(m, 5, radius, radius * 0.8, min[1], max[1] - min[1])
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
/**
 * A box with rounded vertical edges, capped top and bottom. `r` is the corner
 * radius; `seg` the arc segments per corner (0 for a plain box outline).
 */
function roundedBox(m, [x0, y0, z0], [x1, y1, z1], r, seg = 3) {
  const corners = [[x1 - r, z1 - r, 0], [x0 + r, z1 - r, 1], [x0 + r, z0 + r, 2], [x1 - r, z0 + r, 3]]
  const ring = []
  for (const [cx, cz, q] of corners)
    for (let i = 0; i <= seg; i++) {
      const a = (q + i / Math.max(seg, 1)) * Math.PI / 2
      ring.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r])
    }
  const lo = ring.map(([x, z]) => [x, y0, z])
  const hi = ring.map(([x, z]) => [x, y1, z])
  const cLo = [(x0 + x1) / 2, y0, (z0 + z1) / 2]
  const cHi = [(x0 + x1) / 2, y1, (z0 + z1) / 2]
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length
    quad(m, lo[i], lo[j], hi[j], hi[i])
    face(m, hi[i], hi[j], cHi)
    face(m, lo[j], lo[i], cLo)
  }
  return m
}

/**
 * A convex profile in the side plane (z forward-back, y up), extruded across x.
 * The bench is drawn in profile, so its frames, slats and armrests can lean.
 */
function prism(m, profile, x0, x1) {
  const n = profile.length
  const a = profile.map(([z, y]) => [x0, y, z])
  const b = profile.map(([z, y]) => [x1, y, z])
  const cz = profile.reduce((t, p) => t + p[0], 0) / n
  const cy = profile.reduce((t, p) => t + p[1], 0) / n
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    quad(m, a[i], a[j], b[j], b[i])
    face(m, b[i], b[j], [x1, cy, cz])
    face(m, a[j], a[i], [x0, cy, cz])
  }
  return m
}

/** Triangulate a simple polygon (counter-clockwise) by ear clipping. */
function earClip(pts) {
  const idx = pts.map((_, i) => i)
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
  const inside = (p, a, b, c) => cross(a, b, p) > 0 && cross(b, c, p) > 0 && cross(c, a, p) > 0
  const tris = []
  let guard = 0
  while (idx.length > 3 && guard++ < 10000) {
    for (let k = 0; k < idx.length; k++) {
      const [i0, i1, i2] = [idx[(k + idx.length - 1) % idx.length], idx[k], idx[(k + 1) % idx.length]]
      const [a, b, c] = [pts[i0], pts[i1], pts[i2]]
      if (cross(a, b, c) <= 0) continue
      if (idx.some(j => j !== i0 && j !== i1 && j !== i2 && inside(pts[j], a, b, c))) continue
      tris.push([i0, i1, i2])
      idx.splice(k, 1)
      break
    }
  }
  tris.push([idx[0], idx[1], idx[2]])
  return tris
}

/** Any simple outline in the side plane (z, y), extruded across x. */
function extrude(m, outline, x0, x1) {
  const area = outline.reduce((t, p, i) => t + p[0] * outline[(i + 1) % outline.length][1] - outline[(i + 1) % outline.length][0] * p[1], 0)
  const pts = area < 0 ? [...outline].reverse() : outline
  const a = pts.map(([z, y]) => [x0, y, z])
  const b = pts.map(([z, y]) => [x1, y, z])
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    quad(m, a[j], a[i], b[i], b[j])
  }
  for (const [i, j, k] of earClip(pts)) {
    face(m, b[i], b[j], b[k])
    face(m, a[k], a[j], a[i])
  }
  return m
}

/** A rounded rectangle cross-section of a slat, `w` deep by `t` thick, tilted. */
function slat(z, y, w, t, tilt, seg, round = 0.012) {
  const [c, s] = [Math.cos(tilt), Math.sin(tilt)]
  const r = Math.min(t / 2 - 0.001, round)
  const pts = []
  const corners = [[w / 2 - r, t / 2 - r, 0], [-w / 2 + r, t / 2 - r, 1], [-w / 2 + r, -t / 2 + r, 2], [w / 2 - r, -t / 2 + r, 3]]
  for (const [cx, cy, q] of corners)
    for (let i = 0; i <= seg; i++) {
      const ang = (q + i / Math.max(seg, 1)) * Math.PI / 2
      const [px, py] = [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]
      pts.push([z + px * c - py * s, y + px * s + py * c])
    }
  return pts
}

/**
 * A closed profile `[r, y, jag?]` spun about the y axis. `jag` pushes alternate
 * vertices of that ring out and down by its amount, for a ragged edge.
 */
function lathe(m, sides, profile) {
  const rings = profile.map(([r, y, jag = 0]) =>
    Array.from({ length: sides }, (_, i) => {
      const a = (i / sides) * Math.PI * 2
      const k = i % 2 ? jag : -jag
      return [Math.cos(a) * (r + k), y - k, Math.sin(a) * (r + k)]
    }))
  for (let k = 0; k < profile.length; k++) {
    const [lo, hi] = [rings[k], rings[(k + 1) % profile.length]]
    if (profile[k][0] === 0 && profile[(k + 1) % profile.length][0] === 0) continue
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides
      if (profile[k][0] === 0) face(m, lo[i], hi[j], hi[i])
      else if (profile[(k + 1) % profile.length][0] === 0) face(m, lo[i], lo[j], hi[i])
      else quad(m, lo[i], lo[j], hi[j], hi[i])
    }
  }
  return m
}

/** A thick straight bar between two points in the side plane. */
function bar([z0, y0], [z1, y1], w) {
  const [dz, dy] = [z1 - z0, y1 - y0]
  const l = Math.hypot(dz, dy) || 1
  const [nz, ny] = [(-dy / l) * w / 2, (dz / l) * w / 2]
  return [[z0 + nz, y0 + ny], [z1 + nz, y1 + ny], [z1 - nz, y1 - ny], [z0 - nz, y0 - ny]].reverse()
}

/** Detail per level for furniture: arc segments, drum sides, slat count, ribs. */
const FURN_NEAR = { seg: 2, sides: 24, slats: 4, ribs: 16 }
const FURN_FAR = { seg: 0, sides: 6, slats: 1, ribs: 0 }
const furnLod = make => Object.assign(() => make(FURN_NEAR), { far: () => make(FURN_FAR) })
const half = q => Math.max(6, q.sides / 2)

/**
 * Generated rather than sourced, because these are simple solids whose
 * *proportions* carry the recognition. Modelled at real size in metres;
 * `toUnit` rescales and the layer scales them evenly back. Parts never share
 * an exact face or corner, so each stays a solid.
 */
const FURNITURE = {
  // Bins are one shape in two colours, so a glance tells rubbish from
  // recycling: a rounded drum, a fat rim and a dark opening.
  'waste-basket': furnLod(q => {
    const body = mesh()
    cylinder(body, q.sides, 0.25, 0.28, 0.05, 0.78)
    const rim = mesh()
    cylinder(rim, q.sides, 0.31, 0.31, 0.8, 0.09)
    const opening = mesh()
    cylinder(opening, q.sides, 0.25, 0.25, 0.82, 0.08)
    const foot = mesh()
    cylinder(foot, q.sides, 0.22, 0.23, 0, 0.07)
    return [
      { role: 'bin', ...body },
      { role: 'bin', ...rim },
      { role: 'bin', ...foot },
      { role: 'interior', ...opening },
    ]
  }),
  recycling: furnLod(q => {
    const body = mesh()
    cylinder(body, q.sides, 0.25, 0.28, 0.05, 0.78)
    const rim = mesh()
    cylinder(rim, q.sides, 0.31, 0.31, 0.8, 0.09)
    const opening = mesh()
    cylinder(opening, q.sides, 0.25, 0.25, 0.82, 0.08)
    const foot = mesh()
    cylinder(foot, q.sides, 0.22, 0.23, 0, 0.07)
    return [
      { role: 'recycling', ...body },
      { role: 'recycling', ...rim },
      { role: 'recycling', ...foot },
      { role: 'interior', ...opening },
    ]
  }),
  // A park bench after 2GIS's: two flat end panels in a seat-and-back
  // silhouette, one thick seat plank and one wide back plank, all one colour.
  bench: furnLod(q => {
    const L = 0.86
    const parts = mesh()
    // The end panel's outline (z forward-back, y up). The model faces -z, so
    // the back is at +z. Splayed legs, a seat shelf, a tall back with a head.
    const panel = q.slats > 1
      ? [[-0.34, 0], [-0.22, 0], [-0.17, 0.26], [-0.09, 0.36], [0.11, 0.37], [0.25, 0.3],
         [0.32, 0.07], [0.33, 0], [0.46, 0.01], [0.38, 0.45], [0.43, 1.01], [0.52, 1.03],
         [0.52, 1.12], [0.43, 1.16], [0.33, 1.15], [0.27, 1.08], [0.14, 0.68], [-0.04, 0.6],
         [-0.2, 0.61], [-0.32, 0.55], [-0.34, 0.48]]
      : [[-0.34, 0], [-0.2, 0], [-0.2, 0.36], [0.28, 0.36], [0.28, 0], [0.42, 0],
         [0.46, 1.12], [0.3, 1.12], [-0.34, 0.6]]
    for (const x of [-L - 0.03, L + 0.03]) extrude(parts, panel, x - 0.03, x + 0.03)
    // Seat: one thick plank resting on the panels' shelf.
    extrude(parts, [[-0.33, 0.47], [0.24, 0.47], [0.26, 0.56], [-0.31, 0.58]], -L, L)
    // Back: a wide plank following the panels' lean.
    extrude(parts, [[0.2, 0.66], [0.28, 0.65], [0.43, 1.06], [0.35, 1.08]], -L + 0.001, L - 0.001)
    return [{ role: 'bench', ...parts }]
  }),
  // Long axis across x like the bench, so a table facing its path sits along it.
  'picnic-table': furnLod(q => {
    const L = 0.9
    const wood = mesh()
    extrude(wood, [[-0.38, 0.72], [0.38, 0.72], [0.38, 0.77], [-0.38, 0.77]], -L, L)
    for (const z of [-0.62, 0.62])
      extrude(wood, [[z - 0.14, 0.42], [z + 0.14, 0.42], [z + 0.14, 0.46], [z - 0.14, 0.46]], -L, L)
    for (const x of [-L + 0.2, L - 0.2]) {
      if (!q.seg) {
        box(wood, [x - 0.05, 0, -0.5], [x + 0.05, 0.71, 0.5])
        continue
      }
      extrude(wood, bar([-0.6, 0], [0.02, 0.71], 0.08), x - 0.04, x + 0.04)
      extrude(wood, bar([0.6, 0], [-0.02, 0.71], 0.08), x - 0.04, x + 0.04)
      extrude(wood, [[-0.76, 0.36], [0.76, 0.36], [0.76, 0.41], [-0.76, 0.41]], x - 0.04, x + 0.04)
    }
    return [{ role: 'wood', ...wood }]
  }),
  // Sheffield stands, each hoop square to the kerb so bikes park across it.
  'bike-rack': furnLod(q => {
    const metal = mesh()
    const hoop = q.seg
      ? [bar([-0.35, 0], [-0.35, 0.72], 0.05), bar([-0.37, 0.7], [-0.25, 0.83], 0.05),
         bar([-0.27, 0.82], [0.27, 0.82], 0.05), bar([0.25, 0.83], [0.37, 0.7], 0.05),
         bar([0.35, 0.72], [0.35, 0], 0.05)]
      : [[[-0.38, 0], [-0.32, 0], [-0.32, 0.79], [0.32, 0.79], [0.32, 0], [0.38, 0], [0.38, 0.85], [-0.38, 0.85]]]
    for (const x of [-0.8, 0, 0.8])
      for (const profile of hoop) extrude(metal, profile, x - 0.025, x + 0.025)
    return [{ role: 'metal', ...metal }]
  }),
  'drinking-water': furnLod(q => {
    const body = mesh()
    cylinder(body, q.sides, 0.16, 0.13, 0, 0.82)
    cylinder(body, q.sides, 0.2, 0.26, 0.82, 0.12)
    box(body, [-0.025, 0.94, -0.24], [0.025, 1.0, -0.12])
    const basin = mesh()
    cylinder(basin, q.sides, 0.2, 0.2, 0.9, 0.05)
    return [{ role: 'paint', ...body }, { role: 'water', ...basin }]
  }),
  fountain: furnLod(q => {
    const stone = mesh()
    const water = mesh()
    const sides = q.seg ? q.sides * 2 : 8
    cylinder(stone, sides, 1.9, 1.9, 0, 0.45)
    cylinder(water, sides, 1.75, 1.75, 0.38, 0.1)
    cylinder(stone, half(q), 0.22, 0.18, 0.45, 1.05)
    if (q.seg) {
      cylinder(stone, q.sides, 0.35, 0.65, 1.5, 0.18)
      cylinder(stone, q.sides, 0.08, 0.06, 1.68, 0.4)
      cylinder(water, q.sides, 0.58, 0.58, 1.62, 0.08)
    }
    return [{ role: 'stone', ...stone }, { role: 'water', ...water }]
  }),
  // An aerating jet in a pond: a tall slim column of water rising out of a
  // mound of mist at its foot, and a thin ring of splash on the water.
  'fountain-jet': furnLod(q => {
    const column = lathe(mesh(), 6, q.seg
      ? [[0, 0], [0.55, 0.3], [0.28, 2], [0.22, 6.2], [0.32, 8.6], [0.3, 9.5], [0.14, 9.95], [0, 10]]
      : [[0, 0], [0.5, 0.3], [0.26, 8.6], [0.2, 9.8], [0, 10]])
    const fan = lathe(mesh(), q.seg ? 9 : 6, q.seg
      ? [[0, 0.1], [1.5, 0.15, 0.2], [1.2, 0.9], [0.75, 2.0], [0.42, 3.2], [0, 3.4]]
      : [[0, 0.1], [1.4, 0.15], [1.2, 0.6], [0.4, 3.2], [0, 3.3]])
    if (!q.seg) return [column, fan].map(m => ({ role: 'spray', ...m }))
    const splash = lathe(mesh(), 10, [[1.3, 0], [2.0, 0.12, 0.15], [2.7, 0]])
    return [column, fan, splash].map(m => ({ role: 'spray', ...m }))
  }),
  // A classic post-top lantern: fluted base, banded pole, four glass panes
  // under a pyramid roof. Square, so a direction lines its panes up with the street.
  'street-lamp': furnLod(q => {
    const metal = mesh()
    const glass = mesh()
    const round = q.seg ? 8 : 6
    const square = (m, r0, r1, base, height) => cylinder(m, 4, r0 * Math.SQRT2, r1 * Math.SQRT2, base, height, 0.5)
    cylinder(metal, round, 0.2, 0.11, 0, 0.42)
    cylinder(metal, round, 0.075, 0.06, 0.42, q.seg ? 2.98 : 3.08)
    if (q.seg) {
      cylinder(metal, round, 0.13, 0.13, 0.4, 0.06)
      for (const y of [1.3, 2.4]) cylinder(metal, round, 0.085, 0.085, y, 0.06)
      cylinder(metal, round, 0.06, 0.12, 3.25, 0.15)
    }
    square(glass, 0.16, 0.22, 3.5, 0.48)
    square(metal, 0.27, 0.06, 4.02, 0.24)
    if (q.seg) {
      square(metal, 0.11, 0.17, 3.4, 0.1)
      square(metal, 0.29, 0.29, 3.98, 0.04)
    }
    if (q.seg) {
      cylinder(metal, round, 0.025, 0.025, 4.26, 0.08)
      cylinder(metal, round, 0.045, 0.015, 4.34, 0.08)
    }
    return [{ role: 'metal', ...metal }, { role: 'lamp', ...glass }]
  }),
  bollard: furnLod(q => {
    const metal = mesh()
    cylinder(metal, half(q), 0.1, 0.1, 0, 0.85)
    cylinder(metal, half(q), 0.095, 0.05, 0.85, 0.07)
    return [{ role: 'metal', ...metal }]
  }),
  // A monopole billboard whose face looks out at the road (-z).
  billboard: furnLod(q => {
    const metal = mesh()
    cylinder(metal, half(q), 0.32, 0.26, 0, 6.2)
    box(metal, [-4.6, 5.9, 0.12], [4.6, 9.1, 0.42])
    const face = mesh()
    box(face, [-4.5, 6.0, -0.02], [4.5, 9.0, 0.14])
    return [{ role: 'metal', ...metal }, { role: 'panel', ...face }]
  }),
}

// ---------------------------------------------------------------------------
// Sports equipment
// ---------------------------------------------------------------------------

/** Moves a freshly built part, so a cylinder can stand somewhere but the origin. */
function shift(m, [dx, dy, dz]) {
  for (let i = 0; i < m.position.length; i += 3) {
    m.position[i] += dx
    m.position[i + 1] += dy
    m.position[i + 2] += dz
  }
  return m
}

/** A net strung across x between two posts, its tape along the top. */
function courtNet(q, span, bottom, top, post) {
  const sides = half(q)
  return [
    { role: 'metal', ...shift(cylinder(mesh(), sides, 0.04, 0.035, 0, post), [-span, 0, 0]) },
    { role: 'metal', ...shift(cylinder(mesh(), sides, 0.04, 0.035, 0, post), [span, 0, 0]) },
    { role: 'net', ...box(mesh(), [-span + 0.05, bottom, -0.01], [span - 0.05, top, 0.01]) },
    { role: 'tape', ...box(mesh(), [-span + 0.05, top, -0.015], [span - 0.05, top + 0.06, 0.015]) },
  ]
}

/**
 * Nets, hoops and goals for the courts and fields barrelman lays out. Each faces
 * -z like the furniture: a net's span runs across x, and a hoop or a goal looks
 * out over the court in front of it.
 */
const SPORTS = {
  'tennis-net': furnLod(q => courtNet(q, 6.4, 0.06, 0.9, 1.07)),
  'pickleball-net': furnLod(q => courtNet(q, 3.35, 0.06, 0.86, 0.91)),
  'volleyball-net': furnLod(q => courtNet(q, 5, 1.43, 2.37, 2.55)),
  'basketball-hoop': furnLod(q => {
    const rim = mesh()
    if (q.seg) {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2
        const [x, z] = [Math.cos(a) * 0.23, -0.38 + Math.sin(a) * 0.23]
        box(rim, [x - 0.02, 3.04, z - 0.02], [x + 0.02, 3.06, z + 0.02])
      }
      box(rim, [-0.06, 3.03, -0.16], [0.06, 3.07, -0.03])
    } else {
      box(rim, [-0.23, 3.04, -0.61], [0.23, 3.06, -0.15])
    }
    return [
      { role: 'metal', ...shift(cylinder(mesh(), half(q), 0.08, 0.07, 0, 3.3), [0, 0, 1]) },
      { role: 'metal', ...(q.seg ? box(mesh(), [-0.05, 3.0, 0.04], [0.05, 3.12, 0.96]) : mesh()) },
      { role: 'panel', ...box(mesh(), [-0.9, 2.9, -0.03], [0.9, 3.95, 0.03]) },
      { role: 'rim', ...rim },
    ]
  }),
  'soccer-goal': furnLod(q => {
    const frame = mesh()
    box(frame, [-3.78, 2.38, -0.06], [3.78, 2.5, 0.06])
    box(frame, [-3.7, 0, 1.77], [3.7, 0.05, 1.83])
    for (const x of [-3.72, 3.72]) {
      if (q.seg) box(frame, [x - 0.03, 0, 0.07], [x + 0.03, 0.05, 1.76])
      extrude(frame, bar([0.08, 2.38], [1.78, 0.06], 0.05), x - 0.025, x + 0.025)
    }
    return [
      { role: 'frame', ...shift(cylinder(mesh(), half(q), 0.06, 0.06, 0, 2.37), [-3.72, 0, 0]) },
      { role: 'frame', ...shift(cylinder(mesh(), half(q), 0.06, 0.06, 0, 2.37), [3.72, 0, 0]) },
      { role: 'frame', ...frame },
    ]
  }),
  'football-goalpost': furnLod(q => [
    { role: 'goalpost', ...shift(cylinder(mesh(), half(q), 0.1, 0.09, 0, 2.94), [0, 0, 1.5]) },
    { role: 'goalpost', ...box(mesh(), [-0.08, 2.95, 0.1], [0.08, 3.15, 1.45]) },
    { role: 'goalpost', ...box(mesh(), [-2.88, 2.95, -0.1], [2.88, 3.15, 0.09]) },
    { role: 'goalpost', ...shift(cylinder(mesh(), half(q), 0.05, 0.04, 3.16, 9.04), [-2.82, 0, 0]) },
    { role: 'goalpost', ...shift(cylinder(mesh(), half(q), 0.05, 0.04, 3.16, 9.04), [2.82, 0, 0]) },
  ]),
}

// ---------------------------------------------------------------------------
// Lines: barriers, power lines and catenary
// ---------------------------------------------------------------------------

/** A thin square strut between two points, for lattices and wires. */
function strut(m, a, b, r, capped = true) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const len = Math.hypot(...d) || 1
  const u = d.map(v => v / len)
  const ref = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const cross = (p, q) => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]]
  const norm = v => { const l = Math.hypot(...v) || 1; return v.map(c => c / l) }
  const s1 = norm(cross(u, ref)).map(v => v * r)
  const s2 = norm(cross(u, s1)).map(v => v * r)
  const corner = (p, i, j) => [p[0] + i * s1[0] + j * s2[0], p[1] + i * s1[1] + j * s2[1], p[2] + i * s1[2] + j * s2[2]]
  const ring = p => [corner(p, 1, 1), corner(p, -1, 1), corner(p, -1, -1), corner(p, 1, -1)]
  const lo = ring(a)
  const hi = ring(b)
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4
    quad(m, lo[i], lo[j], hi[j], hi[i])
  }
  if (capped) {
    quad(m, hi[0], hi[1], hi[2], hi[3])
    quad(m, lo[3], lo[2], lo[1], lo[0])
  }
  return m
}

/**
 * Wires along x over one unit of span, each sagging by `sag` at mid-span. The
 * cross-section stays square to x, so stretching a span to length leaves the
 * wire as thin as it was built.
 */
function wires(m, attach, sag, r, pieces) {
  const ring = ([x, y, z]) => [[x, y + r, z + r], [x, y - r, z + r], [x, y - r, z - r], [x, y + r, z - r]]
  for (const [y, z] of attach)
    for (let k = 0; k < pieces; k++) {
      const at = t => [t - 0.5, y - sag * (1 - (2 * t - 1) ** 2), z]
      const lo = ring(at(k / pieces))
      const hi = ring(at((k + 1) / pieces))
      for (let i = 0; i < 4; i++) quad(m, lo[i], lo[(i + 1) % 4], hi[(i + 1) % 4], hi[i])
    }
  return m
}

/**
 * Keep a model's own height above the ground: for spans that hang in the air.
 * Drawn double-sided, since a stretched wire has no top to cull against.
 */
const standing = (make, height) => Object.assign(make, { fit: { scale: 1 / height, cx: 0, cz: 0, base: 0 }, open: true })

/** Conductor attachment points on a lattice tower, in metres: [height, side]. */
const TOWER_PHASES = [[23, -6.5], [23, 6.5], [28, -4], [28, 4], [29.8, 0]]
const POLE_PHASES = [[10.4, -1.05], [10.4, 1.05], [11.1, 0]]

/**
 * Lines stood up as objects. A span runs one unit along x, so the layer can
 * stretch it to any segment; a tower or pole carries its crossarms across z,
 * square to the line it holds.
 */
const LINES = {
  'fence-span': furnLod(q => [
    { role: 'metal', ...box(mesh(), [-0.5, 1.12, -0.02], [0.5, 1.17, 0.02]) },
    { role: 'metal', ...(q.seg ? box(mesh(), [-0.5, 0.06, -0.02], [0.5, 0.1, 0.02]) : mesh()) },
    { role: 'mesh', ...box(mesh(), [-0.5, 0.1, -0.008], [0.5, 1.12, 0.008]) },
  ]),
  'fence-post': furnLod(q => [{ role: 'metal', ...cylinder(mesh(), half(q), 0.035, 0.03, 0, 1.2) }]),
  'wall-span': furnLod(() => [{ role: 'stone', ...box(mesh(), [-0.5, 0, -0.15], [0.5, 1, 0.15]) }]),
  'hedge-span': furnLod(q => [{ role: 'foliage', ...roundedBox(mesh(), [-0.5, 0, -0.4], [0.5, 1, 0.4], 0.2, q.seg ? 2 : 0) }]),
  'guard-rail-span': standing(furnLod(() => [
    { role: 'metal', ...box(mesh(), [-0.5, 0.55, -0.05], [0.5, 0.8, 0.05]) },
  ]), 0.8),
  'power-tower': furnLod(q => {
    const steel = mesh()
    const r = q.seg ? 0.12 : 0.2
    const leg = (sx, sz) => strut(steel, [sx * 4, 0, sz * 4], [sx * 1, 30, sz * 1], r)
    for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) leg(sx, sz)
    const at = (y, sx, sz) => { const w = 4 - (3 * y) / 30; return [sx * w, y, sz * w] }
    if (q.seg)
      for (const y of [6, 12, 18, 23, 28])
        for (const [a, b] of [[[1, 1], [-1, 1]], [[-1, 1], [-1, -1]], [[-1, -1], [1, -1]], [[1, -1], [1, 1]]])
          strut(steel, at(y, ...a), at(y, ...b), r * 0.7)
    for (const [y, span] of [[23, 7], [28, 4.5]]) strut(steel, [0, y, -span], [0, y, span], r * 1.3)
    return [{ role: 'lattice', ...steel }]
  }),
  'power-wires': standing(furnLod(q => [{ role: 'wire', ...wires(mesh(), TOWER_PHASES, 2.5, 0.12, q.seg ? 6 : 2) }]), 30),
  'power-pole': furnLod(q => [
    { role: 'wood', ...cylinder(mesh(), half(q), 0.15, 0.11, 0, 11.2) },
    { role: 'wood', ...box(mesh(), [-0.06, 10.2, -1.25], [0.06, 10.32, 1.25]) },
  ]),
  'pole-wires': standing(furnLod(q => [{ role: 'wire', ...wires(mesh(), POLE_PHASES, 0.6, 0.05, q.seg ? 6 : 2) }]), 11.2),
  'catenary-mast': furnLod(q => [
    { role: 'metal', ...shift(cylinder(mesh(), half(q), 0.12, 0.1, 0, 7.4), [0, 0, 2.6]) },
    { role: 'metal', ...box(mesh(), [-0.04, 6.7, -0.1], [0.04, 6.8, 2.55]) },
    { role: 'metal', ...box(mesh(), [-0.03, 5.62, -0.05], [0.03, 6.7, 0.05]) },
  ]),
  'catenary-wires': standing(furnLod(q => [
    { role: 'wire', ...wires(mesh(), [[5.6, 0]], 0, 0.04, 1) },
    { role: 'wire', ...wires(mesh(), [[6.65, 0]], 0.5, 0.04, q.seg ? 6 : 2) },
  ]), 7.4),
}

// ---------------------------------------------------------------------------
// Trees
// ---------------------------------------------------------------------------

/** A seeded PRNG, so a regenerated model is byte-identical to the last one. */
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A unit icosphere: round from every side, which a canopy has to be. */
function icosphere(subdivisions) {
  const t = (1 + Math.sqrt(5)) / 2
  let verts = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t],
    [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(v => { const l = Math.hypot(...v); return v.map(c => c / l) })
  let faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4],
    [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8],
    [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ]
  for (let i = 0; i < subdivisions; i++) {
    const cache = new Map()
    const mid = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      if (!cache.has(key)) {
        const m = verts[a].map((c, k) => c + verts[b][k])
        const l = Math.hypot(...m)
        verts.push(m.map(c => c / l))
        cache.set(key, verts.length - 1)
      }
      return cache.get(key)
    }
    faces = faces.flatMap(([a, b, c]) => {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a)
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]]
    })
  }
  return { verts, faces }
}

/**
 * One lump of foliage: a lumpy ellipsoid with a flattened underside.
 *
 * The lumps are a few low-frequency waves over the sphere's directions, seeded,
 * so neighbouring blobs differ and the outline breaks up the way a real crown's
 * does. The underside is pulled up because leaves hang off branches — a canopy
 * is a dome on a flatter base, not a ball.
 */
function blob(m, [cx, cy, cz], [rx, ry, rz], { seed = 1, lump = 0.12, subdivisions = 2, flat = 0.55, taper = 0, ripple = 0 } = {}) {
  const r = rng(seed)
  const waves = Array.from({ length: 4 }, () => {
    const d = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]
    const l = Math.hypot(...d) || 1
    return { d: d.map(c => c / l), f: 2 + r() * 3, p: r() * Math.PI * 2, a: 0.5 + r() * 0.5 }
  })
  // Finer waves for the soft bumps along a crown's edge — the clumps of leaves
  // a canopy is made of, without the hard seams of separate shapes.
  const ripples = Array.from({ length: 6 }, () => {
    const d = [r() * 2 - 1, r() * 2 - 1, r() * 2 - 1]
    const l = Math.hypot(...d) || 1
    return { d: d.map(c => c / l), f: 7 + r() * 4, p: r() * Math.PI * 2 }
  })
  const { verts, faces } = icosphere(subdivisions)
  const placed = verts.map(([x, y, z]) => {
    let k = 0
    for (const w of waves) k += w.a * Math.sin((x * w.d[0] + y * w.d[1] + z * w.d[2]) * w.f + w.p)
    let q = 0
    for (const w of ripples) q += Math.sin((x * w.d[0] + y * w.d[1] + z * w.d[2]) * w.f + w.p)
    const s = 1 + (lump * k) / waves.length + (ripple * q) / ripples.length
    const yy = y < 0 ? y * flat : y
    // Narrower towards the top: an egg at a little taper, a flame at a lot.
    const w = 1 - taper * (y + 1) / 2
    return [cx + x * rx * s * w, cy + yy * ry * s, cz + z * rz * s * w]
  })
  for (const [a, b, c] of faces) face(m, placed[a], placed[b], placed[c])
  return m
}

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * A palm frond: a narrow blade along an arching spine.
 *
 * The spine leaves the crown climbing at `rise` and bends over until it is
 * heading down at `fall`, so a crown of them is a fountain from the side and a
 * star from above — the two views a palm is recognised by. `stations` are the
 * fractions along it that get a cross-section; the base and tip are points.
 *
 * The cross-section is a shallow roof, its edges hanging `droop` of the half-
 * width below the midrib the way a pinnate frond's leaflets do, closed by a
 * keel underneath. A blade with a keel is a solid, which keeps the whole crown
 * cullable: a flat ribbon would be open, and an open frond is lit from the
 * wrong side whenever its back is turned to the camera. `keel: false` closes
 * it straight across instead, a triangle rather than a diamond, for the far LOD.
 */
function frond(m, base, { length, yaw, rise, fall, width, droop, stations, keel = true }) {
  const STEPS = 48
  const angle = s => rise + (fall - rise) * s ** 1.6
  // The spine, integrated from its angle so a station lands on the same curve
  // whatever the level of detail.
  const spine = [[0, 0]]
  for (let i = 0; i < STEPS; i++) {
    const a = angle((i + 0.5) / STEPS)
    const [u, v] = spine[i]
    spine.push([u + (Math.cos(a) * length) / STEPS, v + (Math.sin(a) * length) / STEPS])
  }
  const out = [Math.cos(yaw), 0, Math.sin(yaw)]
  const side = [-Math.sin(yaw), 0, Math.cos(yaw)]
  const point = (s, across, lift) => {
    const k = Math.min(STEPS, Math.round(s * STEPS))
    const [u, v] = spine[k]
    const a = angle(s)
    // The blade's own up: square to the spine, in the plane it arches in.
    const n = [-Math.sin(a) * out[0], Math.cos(a), -Math.sin(a) * out[2]]
    return [0, 1, 2].map(c => base[c] + out[c] * u + (c === 1 ? v : 0) + side[c] * across + n[c] * lift)
  }
  const rings = stations.map(s => {
    const w = width(s) * length
    const top = point(s, 0, 0.1 * w)
    const right = point(s, w, -droop * w)
    const left = point(s, -w, -droop * w)
    return keel ? [top, right, point(s, 0, -(droop + 0.08) * w - 0.01), left] : [top, right, left]
  })
  const start = point(0, 0, 0)
  const tip = point(1, 0, 0)
  const sides = rings[0].length
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides
    face(m, start, rings[0][j], rings[0][i])
    for (let k = 0; k < rings.length - 1; k++) quad(m, rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i])
    face(m, rings[rings.length - 1][i], rings[rings.length - 1][j], tip)
  }
}

/** How much wider a far frond is than the near one at the same point; see `palm`. */
const FAR_FROND_WIDTH = 1.35

/** How wide a frond is along its length, as a fraction of that length. */
const FROND_WIDTH = {
  // Pinnate: a bare stalk, then leaflets that run most of its length and taper
  // to the tip.
  feather: s => 0.11 * (0.2 + 0.8 * smoothstep(0.05, 0.4, s)) * (1 - 0.8 * smoothstep(0.45, 1, s)),
  // Palmate: a long bare stalk, then a fan as wide as it is long.
  fan: s => 0.4 * (0.05 + 0.95 * smoothstep(0.25, 0.7, s)),
}

/**
 * A palm trunk: a tube that tapers from a slight flare at the ground and
 * curves over by `lean`, as many palms do once they are tall.
 *
 * Built as one tube rather than stacked cylinders, so it has the same outline
 * at any number of rings and the far LOD can simply take fewer of them.
 */
function palmTrunk(m, { height, lean, from = 0, to = height, base, top, sides, rings }) {
  const bend = y => (y / height) ** 2 * height * lean
  const radius = t => top + (base - top) * (1 - t) ** 1.6
  const at = Array.from({ length: rings }, (_, k) => {
    const t = k / (rings - 1)
    const y = from + t * (to - from)
    return ring(sides, radius(t), y).map(([x, yy, z]) => [x + bend(y), yy, z])
  })
  for (let k = 0; k < rings - 1; k++)
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides
      quad(m, at[k][i], at[k][j], at[k + 1][j], at[k + 1][i])
    }
  // Capped with a fan from one corner: the caps are a trunk's ends, where
  // nobody looks, and a centre vertex would only cost triangles.
  const [lo, hi] = [at[0], at[rings - 1]]
  for (let i = 1; i < sides - 1; i++) {
    face(m, lo[0], lo[i + 1], lo[i])
    face(m, hi[0], hi[i], hi[i + 1])
  }
  return m
}

/**
 * Palms, at either level of detail, from one description — so the far model
 * is the near one with fewer fronds and fewer joints, standing on the same
 * trunk and arching the same way, rather than a fitted proxy. A fitted proxy
 * is a lozenge, and a lozenge on a post is a lollipop.
 *
 * `fronds` are drawn in order and the far model keeps every `farEvery`th one,
 * spread round the crown by the golden angle so any subset is still a star.
 * Keep `farEvery` coprime with the number of ages in the crown's `arch`, or
 * the far model keeps only some ages — every climbing frond and no hanging one.
 */
function palm({ height, lean, base, top, kind, fronds, farEvery, farStations, crownshaft, hub }, far) {
  const crown = [height * lean, height, 0]
  // Under a crownshaft the trunk stops where the shaft takes over, on the same
  // curve — at both levels of detail, so the far trunk is no taller than the near.
  const shaftFrom = crownshaft ? height - crownshaft.length : height
  const sides = far ? 5 : 8
  const bark = palmTrunk(mesh(), { height, lean, to: shaftFrom, base, top, sides, rings: far ? 3 : 7 })
  const leaves = mesh()
  const stations = far ? farStations : [1, 2, 3, 4, 5].map(k => k / 6)
  fronds.forEach((spec, i) => {
    if (far && i % farEvery) return
    // A far blade has one joint, so it is a kite: widest at that joint and
    // tapering both ways, it covers about half the near blade's area. Widened
    // to make up for it, or the distant crown reads as a few pencil strokes.
    const width = far ? s => FROND_WIDTH[kind](s) * FAR_FROND_WIDTH : FROND_WIDTH[kind]
    frond(leaves, crown, { ...spec, width, stations, keel: !far })
  })
  if (shaftFrom < height) {
    const shaft = palmTrunk(mesh(), { height, lean, from: shaftFrom, base: crownshaft.radius, top: crownshaft.radius * 0.85, sides, rings: far ? 2 : 3 })
    merge(leaves, shaft)
  }
  if (!far && hub) merge(leaves, blob(mesh(), crown, hub, { seed: 7, subdivisions: 1 }))
  return [{ role: 'palm-bark', ...bark }, { role: 'foliage', ...leaves }]
}

/** Append one mesh's triangles to another's. */
function merge(into, from) {
  const offset = into.position.length / 3
  into.position.push(...from.position)
  into.normal.push(...from.normal)
  into.index.push(...from.index.map(i => i + offset))
  return into
}

/**
 * A crown of fronds. Each is placed by the golden angle, so neighbours never
 * line up, and takes its arch from where it is in the crown's life: the
 * youngest climb, the oldest hang below the horizontal.
 */
function crownOf(count, seed, { length, lengthVariety = 0.15, arch }) {
  const r = rng(seed)
  return Array.from({ length: count }, (_, i) => {
    const age = arch[i % arch.length]
    return {
      length: length * (1 - lengthVariety / 2 + r() * lengthVariety),
      yaw: i * 2.39996 + r() * 0.25,
      rise: age.rise + (r() - 0.5) * 0.15,
      fall: age.fall + (r() - 0.5) * 0.15,
      droop: age.droop,
    }
  })
}

/**
 * The trees, generated. Modelled in metres; `toUnit` rescales each to one unit
 * tall, and the layer scales height and spread per instance.
 *
 * Several per family on purpose: `trees.ts` picks between them from the
 * feature's id, so a street is a row of different trees rather than one tree
 * repeated.
 */
/** Detail per level: crown subdivisions for broadleaf and conifer, and trunk sides. */
const NEAR = { crown: 3, cone: 2, sides: 7 }
const FAR = { crown: 1, cone: 1, sides: 4 }

/**
 * A tree whose far variant is itself at lower detail, rather than a fitted
 * proxy — so a distant tree keeps its own silhouette and swapping is invisible.
 */
const CROWN = { crown: 2, cone: 2, sides: 3 }

/**
 * A tree's crown alone, for the inside of a wood where no trunk shows. Built at
 * a step less detail and fitted with the whole tree, so it sits where its crown would.
 */
const crownOnly = (make, q) => () => make(q).filter(p => p.role === 'foliage')

const palmLod = spec => Object.assign(() => palm(spec, false), { far: () => palm(spec, true) })

const lod = make =>
  Object.assign(() => make(NEAR), { far: () => make(FAR), crown: crownOnly(make, CROWN), crownFar: crownOnly(make, FAR) })

const TREES = {
  // Each crown is one smooth, softly undulating solid rather than a cluster of
  // puffs: read from map distance a crown is a single mass, and the light
  // gradient across it carries the form better than its outline does.
  // Ovoid: the common street tree, taller than wide.
  'tree-broadleaf-a': lod(q => [
    { role: 'bark', ...cylinder(mesh(), q.sides, 0.32, 0.22, 0, 4.4) },
    { role: 'foliage', ...blob(mesh(), [0, 6.4, 0], [2.8, 4.1, 2.8], { subdivisions: q.crown, seed: 11, lump: 0.05, ripple: 0.07, flat: 0.8, taper: 0.16 }) },
  ]),
  // Round: a full, broad crown.
  'tree-broadleaf-b': lod(q => [
    { role: 'bark', ...cylinder(mesh(), q.sides, 0.42, 0.28, 0, 4.2) },
    { role: 'foliage', ...blob(mesh(), [0, 5.6, 0], [3.5, 3.4, 3.5], { subdivisions: q.crown, seed: 23, lump: 0.06, ripple: 0.07, flat: 0.75, taper: 0.1 }) },
  ]),
  // Columnar: narrow and tall.
  'tree-broadleaf-c': lod(q => [
    { role: 'bark', ...cylinder(mesh(), q.sides, 0.22, 0.15, 0, 3.8) },
    { role: 'foliage', ...blob(mesh(), [0, 6.8, 0], [2.2, 4.9, 2.2], { subdivisions: q.crown, seed: 37, lump: 0.05, ripple: 0.06, flat: 0.85, taper: 0.2 }) },
  ]),
  // Irregular: a gently lopsided crown, the odd one out in a row.
  'tree-broadleaf-d': lod(q => [
    { role: 'bark', ...cylinder(mesh(), q.sides, 0.34, 0.23, 0, 4.4) },
    { role: 'foliage', ...blob(mesh(), [0, 6, 0], [3.1, 3.7, 2.7], { subdivisions: q.crown, seed: 54, lump: 0.1, ripple: 0.08, flat: 0.75, taper: 0.12 }) },
  ]),
  // Spruce: a smooth cone, widest low down.
  'tree-conifer-a': lod(q => [
    { role: 'bark', ...cylinder(mesh(), q.sides, 0.22, 0.12, 0, 5.2) },
    { role: 'foliage', ...blob(mesh(), [0, 6.6, 0], [2.7, 5.4, 2.7], { subdivisions: q.cone, seed: 70, lump: 0.04, flat: 0.45, taper: 0.85 }) },
  ]),
  // Pine: a soft, slightly tapered column.
  'tree-conifer-b': lod(q => [
    { role: 'bark', ...cylinder(mesh(), q.sides, 0.22, 0.14, 0, 6.2) },
    { role: 'foliage', ...blob(mesh(), [0, 8, 0], [2.2, 4.2, 2.2], { subdivisions: q.cone, seed: 80, lump: 0.07, flat: 0.7, taper: 0.4 }) },
  ]),
  // Fir: tall and narrow, coming to a point.
  'tree-conifer-c': lod(q => [
    { role: 'bark', ...cylinder(mesh(), q.sides, 0.2, 0.1, 0, 5.6) },
    { role: 'foliage', ...blob(mesh(), [0, 7, 0], [2, 6.2, 2], { subdivisions: q.cone, seed: 90, lump: 0.04, flat: 0.4, taper: 0.9 }) },
  ]),
  // Cypress: a slim flame.
  'tree-conifer-d': lod(q => [
    { role: 'bark', ...cylinder(mesh(), q.sides, 0.18, 0.12, 0, 3) },
    { role: 'foliage', ...blob(mesh(), [0, 5.6, 0], [1.75, 4.6, 1.75], { subdivisions: q.cone, seed: 100, lump: 0.05, flat: 0.8, taper: 0.55 }) },
  ]),
  // Palms. Two feather palms after the royal and coconut palms — a crownshaft,
  // long arching fronds — and a fan palm after Washingtonia and Sabal: a
  // straighter trunk under a tighter, rounder crown of fans on stalks.
  // `trees.ts` picks between them by id, since the family carries no subtype.
  //
  // Each frond's arch is set by its age, oldest last: climbing, spreading,
  // hanging. The far LOD keeps a spread of them and three joints instead of seven.
  'tree-palm-a': palmLod({
    height: 12, lean: 0.05, base: 0.58, top: 0.34, kind: 'feather',
    crownshaft: { length: 1.6, radius: 0.4 },
    fronds: crownOf(15, 110, {
      length: 5,
      arch: [{ rise: 0.75, fall: -0.65, droop: 0.75 }, { rise: 0.35, fall: -1.2, droop: 0.8 }, { rise: 0.05, fall: -1.45, droop: 0.85 }],
    }),
    farEvery: 2, farStations: [0.4],
  }),
  'tree-palm-b': palmLod({
    height: 13, lean: 0.015, base: 0.56, top: 0.4, kind: 'fan',
    hub: [0.45, 0.5, 0.45],
    fronds: crownOf(24, 120, {
      length: 2.75,
      arch: [
        { rise: 1.15, fall: 0.75, droop: 0.3 }, { rise: 0.7, fall: 0.25, droop: 0.3 }, { rise: 0.25, fall: -0.25, droop: 0.3 },
        { rise: -0.2, fall: -0.7, droop: 0.3 }, { rise: -0.65, fall: -1.1, droop: 0.3 },
      ],
    }),
    farEvery: 3, farStations: [0.7],
  }),
  'tree-palm-c': palmLod({
    height: 8, lean: 0.12, base: 0.46, top: 0.3, kind: 'feather',
    crownshaft: { length: 1.1, radius: 0.36 },
    fronds: crownOf(13, 130, {
      length: 4.2,
      arch: [{ rise: 0.65, fall: -0.7, droop: 0.75 }, { rise: 0.3, fall: -1.25, droop: 0.8 }, { rise: 0, fall: -1.55, droop: 0.85 }],
    }),
    farEvery: 2, farStations: [0.4],
  }),
}

// ---------------------------------------------------------------------------
// Plantings and arrays
// ---------------------------------------------------------------------------

/** What scrub, flower beds and solar fields are planted with; see `areas.ts`. */
const AREAS = {
  'shrub-a': lod(q => [{ role: 'foliage', ...blob(mesh(), [0, 0.5, 0], [0.62, 0.5, 0.55], { seed: 41, lump: 0.22, subdivisions: q.crown > 1 ? 2 : 0, flat: 0.8 }) }]),
  'shrub-b': lod(q => [
    { role: 'foliage', ...blob(mesh(), [-0.18, 0.42, 0.05], [0.5, 0.42, 0.48], { seed: 43, lump: 0.25, subdivisions: q.crown > 1 ? 2 : 0, flat: 0.8 }) },
    { role: 'foliage', ...blob(mesh(), [0.28, 0.36, -0.1], [0.38, 0.36, 0.36], { seed: 47, lump: 0.25, subdivisions: q.crown > 1 ? 1 : 0, flat: 0.8 }) },
  ]),
  // A clipped shrub: square-cut sides and a flat top, set close in a planting.
  'shrub-box': furnLod(q => [{ role: 'foliage', ...roundedBox(mesh(), [-0.5, 0, -0.5], [0.5, 1, 0.5], 0.14, q.seg) }]),
  // A clump of bedding plants: a low green mound studded with blooms.
  flowers: lod(q => {
    const blooms = mesh()
    const r = rng(53)
    for (let k = 0; k < (q.crown > 1 ? 5 : 3); k++) {
      const a = r() * Math.PI * 2
      const d = 0.15 + r() * 0.25
      blob(blooms, [Math.cos(a) * d, 0.32 + r() * 0.06, Math.sin(a) * d], [0.1, 0.07, 0.1], { seed: 60 + k, lump: 0.1, subdivisions: 0 })
    }
    return [
      { role: 'foliage', ...blob(mesh(), [0, 0.15, 0], [0.48, 0.18, 0.48], { seed: 51, lump: 0.2, subdivisions: q.crown > 1 ? 1 : 0, flat: 0.9 }) },
      { role: 'bloom', ...blooms },
    ]
  }),
  // A 24 m length of panel row, 3 m up the slope and tilted 25° toward the
  // south (-z), with no posts; the layer stretches it along its row. Fitted
  // from the ground rather than the slab, so it keeps its clearance and size.
  'solar-row': Object.assign(() => {
    const tilt = (25 * Math.PI) / 180
    const half = 1.5 * Math.cos(tilt)
    const [low, high] = [0.6, 0.6 + 3 * Math.sin(tilt)]
    return [{ role: 'pv', ...extrude(mesh(), [[-half, low], [half, high], [half, high + 0.06], [-half, low + 0.06]], -12, 12) }]
  }, { fit: { scale: 1 / 2, cx: 0, cz: 0, base: 0 } }),
}

// ---------------------------------------------------------------------------

async function main() {
  await mkdir(OUT, { recursive: true })
  const written = []
  const manifest = {}

  const emit = async (name, parts, ownFar, fixed, open = false) => {
    // A level of detail can leave a part out entirely; an empty part has no volume.
    parts = parts.filter(p => p.index.length)
    ownFar = ownFar?.filter(p => p.index.length)
    const fit = toUnit(parts, fixed)
    // Before the far LOD is fitted, so its proxy post is fitted to the slimmed
    // trunk rather than to the one nobody will see.
    const slimmed = slimTrunks(parts)
    // Orientation first: capping finds a hole by looking for an edge with only
    // one triangle on it, and against inconsistent winding that test reports
    // every disagreeing seam as a hole and caps straight across the model.
    const turned = parts.filter(part => orientFaces(part)).length
    // Before smoothing, so a cap's own hard edge is one of the creases the
    // smoothing pass considers rather than a normal it never sees.
    const holes = open ? 0 : parts.reduce((n, part) => n + capHoles(part), 0)
    // Only the leafy parts. Smoothing bark rounds off the trunk's cap edge,
    // and smoothing a bench turns its slats into a ramp.
    const foliage = parts.filter(p => p.role === 'foliage' || p.role === 'spray')
    if (foliage.length) smoothNormals(foliage, CREASE_DEGREES)

    const near = toGlb(name, parts)
    await writeFile(join(OUT, `${name}.glb`), near)
    const solid = parts.every(isSolid)
    manifest[name] = solid

    const tris = n => n.reduce((t, p) => t + p.index.length / 3, 0)
    // Not re-normalised: it is built from parts that already are, and running
    // `toUnit` over it re-centres on its own bounding box — which for a
    // five-sided prism is not its axis, so every proxy came out shifted off
    // centre and about 8% wide.
    let far = farLod(parts)
    if (ownFar) {
      toUnit(ownFar, fit)
      far = ownFar
      // Shaded as the near model is, or the switch between them is a pop
      // from soft to faceted even where the outline holds.
      const leaves = far.filter(p => p.role === 'foliage')
      if (leaves.length) smoothNormals(leaves, CREASE_DEGREES)
    }
    // Oriented in its own right: these solids are built here rather than
    // vendored, and `cylinder` and `lozenge` wind their walls the wrong way
    // round — so every proxy was inside out until this ran over it too.
    far.forEach(orientFaces)

    // A model can already be cheaper than its own proxy — the fitted solids
    // have a fixed tessellation, and a 24-triangle bin does not need standing
    // in for. Writing one anyway would make the far draw the expensive one, so
    // it is skipped and the layer keeps using the near model at every distance.
    const worthIt = tris(far) < tris(parts)
    let farNote = 'far n/a (already cheap)'
    if (worthIt) {
      const farGlb = toGlb(`${name}${FAR_SUFFIX}`, far)
      await writeFile(join(OUT, `${name}${FAR_SUFFIX}.glb`), farGlb)
      manifest[`${name}${FAR_SUFFIX}`] = far.every(isSolid)
      farNote = `far ${String(tris(far)).padStart(3)} tris ${(farGlb.length / 1024).toFixed(1)} KB`
    }

    written.push(
      `${name.padEnd(20)} ${String(tris(parts)).padStart(4)} tris ` +
        `${(near.length / 1024).toFixed(1).padStart(5)} KB   ${farNote}` +
        (slimmed ? `   trunk x${slimmed.toFixed(2)}` : '') +
        (turned ? `   turned ${turned}` : '') +
        (holes ? `   capped ${holes}` : '') +
        (solid ? '' : '   NOT SOLID (drawn double-sided)'),
    )
    return fit
  }

  for (const [name, build] of Object.entries(TREES)) {
    const fit = await emit(name, build(), build.far?.())
    if (build.crown) await emit(`${name}${CROWN_SUFFIX}`, build.crown(), build.crownFar(), fit)
  }
  for (const [name, build] of Object.entries(FURNITURE)) await emit(name, build(), build.far?.())
  for (const [name, build] of Object.entries(SPORTS)) await emit(name, build(), build.far?.())
  for (const [name, build] of Object.entries(LINES)) await emit(name, build(), build.far?.(), build.fit, build.open)
  for (const [name, build] of Object.entries(AREAS)) await emit(name, build(), build.far?.(), build.fit)

  // What was actually written, so the app asks for exactly that. Not every
  // model earns a far variant, and a request for one that was skipped is a 404
  // that takes the whole layer down with it.
  //
  // The value says whether the model is a solid, which is the layer's licence
  // to cull its back faces — see `isSolid`.
  const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)))
  await writeFile(MANIFEST, `${JSON.stringify(sorted, null, 2)}\n`)

  for (const line of written) console.log(line)
  const loose = Object.values(manifest).filter(s => !s).length
  console.log(
    `${written.length} models, ${Object.keys(manifest).length} files` +
      (loose ? `, ${loose} drawn double-sided` : ''),
  )
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
