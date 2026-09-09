/**
 * The measurements every place marker in the app is drawn from.
 *
 * A place shows up as a mark in five places — the basemap's own POIs, a search
 * result, a saved place, a pin on a canvas, a stop on the timeline — and they
 * are the same mark for the same kind of thing, so they have to be the same
 * size and proportion. They were not: the plate was 19px in the sprite baker,
 * 22px in CSS and a 9.5px circle radius in the layer paint, and the glyph was
 * `0.57` in one place and `1.14r / 24` in another. Three spellings of the same
 * number drift the moment one of them is tuned.
 *
 * So the numbers live here once, and each drawing mechanism derives what it
 * needs from them rather than restating it. `plateSize` is the plate across its
 * widest point; everything else is a ratio of it, so changing the size alone
 * scales a marker without reshaping it.
 *
 * `.mjs` rather than `.ts` because `scripts/build-sprite.mjs` runs under plain
 * node and bakes the sprite art from these same numbers — the same reason
 * `sdf.mjs` and `transit-poi.mjs` are. Numbers only for that reason: the shape
 * vocabulary is a union type, so it lives in `marker-shape.ts` next door.
 */

/** The plate across its widest point, in CSS pixels. */
export const MARKER_PLATE_SIZE = 19

/**
 * The plate for a live marker — a friend, a tracked vehicle — in CSS pixels.
 *
 * Bigger than a place marker on purpose, and the one place a marker is allowed
 * to be. A POI is part of the map and is drawn at the density the map is drawn
 * at; a live marker is a thing that is somewhere right now, sits on top of all
 * of it, and is usually the reason the map is open. It also has to hold a face
 * at a size a face is recognisable at.
 */
export const MARKER_LIVE_PLATE_SIZE = 28

/**
 * The glyph, as a fraction of the plate.
 *
 * 0.57 is the ratio the basemap's own POI sprites use, and holding every other
 * marker to it is what stops a search result reading as a different kind of
 * mark from the POI underneath it.
 */
export const MARKER_GLYPH_RATIO = 0.57

/** Corner radius of a `square` plate, as a fraction of its side. */
export const MARKER_SQUARE_CORNER = 0.28

/**
 * The outline around a plate, in CSS pixels.
 *
 * Two values on purpose, and the difference is not drift. A marker the app
 * draws — in the DOM or as a circle layer — sits on top of the map with a
 * shadow under it, and 1.5 is enough to separate it from the ground. A badge
 * composited into the basemap has no shadow to help it and is carrying the
 * mark's whole edge, so it takes a shade more. Changing either is a decision
 * about that surface, which is why they are named apart rather than shared and
 * then quietly overridden.
 */
export const MARKER_RING_WIDTH = 1.5
export const MARKER_BADGE_RING_WIDTH = 1.9

/**
 * Glyph images are registered at this size, so `icon-size` is a ratio of it.
 *
 * `map-icon-images.ts` rasterizes lucide and maki SVGs into a square of this
 * many logical pixels; a symbol layer then scales from here rather than from
 * the glyph's natural size, which varies by pack.
 */
export const MARKER_IMAGE_SIZE = 24

/** Rasterize at 2x, so a glyph stays crisp on retina and when scaled up. */
export const MARKER_IMAGE_PIXEL_RATIO = 2

/**
 * The glyph size for a plate of `size`, as a symbol layer's `icon-size`.
 *
 * A registered image is `MARKER_IMAGE_SIZE` across, so the ratio that fills
 * `MARKER_GLYPH_RATIO` of the plate is that fraction of the plate over the
 * image size. Rounded to three places because both engines re-serialize the
 * number and a long tail of float noise makes style diffs unreadable.
 */
export function markerGlyphSize(size = MARKER_PLATE_SIZE) {
  return Math.round(((size * MARKER_GLYPH_RATIO) / MARKER_IMAGE_SIZE) * 1000) / 1000
}

/**
 * The glyph size for a circle-layer marker of a given radius.
 *
 * Saved places and canvas pins size their plate by `circle-radius` rather than
 * by a plate width, so this is the same conversion from the other end. Kept as
 * its own function so neither caller has to remember to double the radius.
 */
export function markerGlyphSizeForRadius(radius) {
  return markerGlyphSize(radius * 2)
}
