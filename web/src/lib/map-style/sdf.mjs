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
