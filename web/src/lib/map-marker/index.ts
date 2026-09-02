/**
 * Place markers — one definition of what a marker is, for every surface that
 * draws one.
 *
 * `marker-metrics` holds the sizes (and is `.mjs`, so the sprite baker can read
 * them too), `marker-paint` the colours, `marker-css` the DOM form,
 * `marker-layers` the native form, and `marker-image` the baked plate that lets
 * a square or a bare glyph be drawn natively at all.
 */

export { MARKER_SHAPES, type MarkerShape } from './marker-shape'

export {
  MARKER_PLATE_SIZE,
  MARKER_GLYPH_RATIO,
  MARKER_SQUARE_CORNER,
  MARKER_RING_WIDTH,
  MARKER_BADGE_RING_WIDTH,
  MARKER_IMAGE_SIZE,
  MARKER_IMAGE_PIXEL_RATIO,
  markerGlyphSize,
  markerGlyphSizeForRadius,
} from './marker-metrics.mjs'

export { markerPaint, type MarkerPaint } from './marker-paint'
export { markerCss, type MarkerCss } from './marker-css'
export {
  markerLayers,
  MARKER_GLYPH_PLACEMENT,
  MARKER_PLATE_PLACEMENT,
  type MarkerLayer,
  type MarkerLayerOptions,
} from './marker-layers'
export {
  MARKER_IMAGE_PREFIX,
  markerImageId,
  parseMarkerImageId,
  composeMarkerImage,
  ensureMarkerImage,
  ensureMarkerImages,
  type MarkerImageSpec,
  type MarkerImageData,
  type MarkerImageHost,
} from './marker-image'
