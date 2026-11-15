/**
 * How the sprite encodes a signed distance field, shared by the builder that
 * writes it and the app code that reads it back.
 *
 * `build-sprite.mjs` bakes every glyph as an SDF in the sheet's alpha channel;
 * `poi-badge.ts` decodes that field again at runtime to recolour a badge. The
 * two have to agree on these three numbers exactly — a mismatch does not fail,
 * it just draws the wrong thing — so they live here rather than in either.
 */

/** Transparent padding around each icon, so the distance field has room. */
export const SDF_BUFFER = 3

/** Distance, in pixels, that the field ramps over. */
export const SDF_RADIUS = 8

/** Where the 0.5 alpha boundary lands in the encoded range. */
export const SDF_CUTOFF = 0.25

/**
 * Signed distance from the shape edge, in sprite pixels, for one encoded byte.
 *
 * Negative inside the shape, positive outside — the sign convention the field
 * is built with. The encoding is `255 - 255 * (d / RADIUS + CUTOFF)`, so this
 * is that solved for `d`.
 */
export function sdfDistance(alpha) {
  return ((255 - alpha) / 255 - SDF_CUTOFF) * SDF_RADIUS
}

/**
 * How much of a pixel the shape covers, from its encoded distance.
 *
 * A pixel is fully covered a half-pixel inside the edge and empty a half-pixel
 * outside it, which is the same antialiasing MapLibre's own SDF shader applies.
 */
export function sdfCoverage(alpha) {
  const d = sdfDistance(alpha)
  return Math.min(1, Math.max(0, 0.5 - d))
}

// Exact Euclidean distance transform (Felzenszwalb & Huttenlocher).

const INF = 1e20

function edt1d(grid, offset, stride, length, f, v, z) {
  v[0] = 0
  z[0] = -INF
  z[1] = INF
  f[0] = grid[offset]

  for (let q = 1, k = 0, s = 0; q < length; q++) {
    f[q] = grid[offset + q * stride]
    const q2 = q * q
    do {
      const r = v[k]
      s = (f[q] - f[r] + q2 - r * r) / (q - r) / 2
    } while (s <= z[k] && --k > -1)
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }

  for (let q = 0, k = 0; q < length; q++) {
    while (z[k + 1] < q) k++
    const r = v[k]
    const qr = q - r
    grid[offset + q * stride] = f[r] + qr * qr
  }
}

function edt(grid, width, height, f, v, z) {
  for (let x = 0; x < width; x++) edt1d(grid, x, width, height, f, v, z)
  for (let y = 0; y < height; y++) edt1d(grid, y * width, 1, width, f, v, z)
}

/** Alpha channel → single-channel signed distance field, encoded as the sprite stores it. */
export function alphaToSdf(alpha, width, height) {
  const size = width * height
  const gridOuter = new Float64Array(size)
  const gridInner = new Float64Array(size)
  const scratch = Math.max(width, height)
  const f = new Float64Array(scratch)
  const v = new Int32Array(scratch)
  const z = new Float64Array(scratch + 1)

  for (let i = 0; i < size; i++) {
    const a = alpha[i] / 255
    if (a === 1) {
      gridOuter[i] = 0
      gridInner[i] = INF
    } else if (a === 0) {
      gridOuter[i] = INF
      gridInner[i] = 0
    } else {
      const d = Math.max(0, 0.5 - a)
      gridOuter[i] = d * d
      const e = Math.max(0, a - 0.5)
      gridInner[i] = e * e
    }
  }

  edt(gridOuter, width, height, f, v, z)
  edt(gridInner, width, height, f, v, z)

  const out = new Uint8Array(size)
  for (let i = 0; i < size; i++) {
    const d = Math.sqrt(gridOuter[i]) - Math.sqrt(gridInner[i])
    out[i] = Math.max(0, Math.min(255, Math.round(255 - 255 * (d / SDF_RADIUS + SDF_CUTOFF))))
  }
  return out
}
