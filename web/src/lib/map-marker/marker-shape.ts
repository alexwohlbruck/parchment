/**
 * The shapes a place marker can take.
 *
 * `disc`   — a round plate with the glyph on it. The default, and what "a place
 *            is here" looks like.
 * `square` — a rounded square plate. Mapbox's convention, and it earns its
 *            place: a disc says a place is here, a square says this is a
 *            station. Transit stops on the basemap already wear it.
 * `glyph`  — the glyph alone on a halo, no plate. Quieter, for when the map is
 *            already carrying a lot, and what MapTiler Streets v4 does.
 *
 * Its own module rather than part of `marker-metrics.mjs` because that one is
 * plain JavaScript — the sprite baker runs it under node — and a union type
 * cannot live there.
 */

export const MARKER_SHAPES = ['disc', 'square', 'glyph'] as const

export type MarkerShape = (typeof MARKER_SHAPES)[number]
