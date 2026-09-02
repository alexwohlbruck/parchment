/**
 * The style layers that draw a set of place markers.
 *
 * Saved places and canvas pins were each building their own circle-plus-symbol
 * pair, and the second one was spreading the first one's `layout` object at a
 * distance to inherit the placement rules. Those rules are load-bearing and not
 * obvious — get one wrong and the glyph drifts off its dot only when the camera
 * tilts — so they belong in one place with the reasons attached.
 *
 * What varies between callers is the ramps: saved places shrink and fade with
 * zoom, a canvas pin holds its size. Those stay with the caller. What does not
 * vary is the structure and the placement, which is what this owns.
 */

import {
  markerGlyphSizeForRadius,
  MARKER_PLATE_SIZE,
  MARKER_RING_WIDTH,
} from './marker-metrics.mjs'
import type { MarkerShape } from './marker-shape'

/**
 * Placement for the glyph over a marker.
 *
 * Deliberately NOT `symbol-z-elevate`: that lifts a symbol to the elevation of
 * whatever is beneath it (terrain, buildings) while a circle layer stays on the
 * ground plane, so a tilted camera pulls the glyph off its dot. Right for
 * labels that should ride on top of buildings; wrong for a glyph that belongs
 * to a specific plate.
 *
 * Pinned to the viewport because the plate is: `map` alignment lays a circle
 * flat on the ground where pitch foreshortens it into an ellipse, and a symbol
 * layer is viewport-aligned by default — so leaving these as `map` made the
 * plate distort out from under a glyph that did not.
 *
 * Overlap is allowed because the glyph belongs to its plate, not to the label
 * collision system: letting it be culled would leave an empty plate behind.
 */
export const MARKER_GLYPH_PLACEMENT = {
  'icon-pitch-alignment': 'viewport',
  'icon-rotation-alignment': 'viewport',
  'icon-allow-overlap': true,
  'icon-ignore-placement': true,
} as const

/**
 * Placement for a circle plate, matching the glyph above it.
 *
 * `circle-emissive-strength` keeps the marker at full colour under a night
 * basemap — Mapbox dims the map after dark, which is right for buildings and
 * wrong for something the user put there.
 */
export const MARKER_PLATE_PLACEMENT = {
  'circle-pitch-alignment': 'viewport',
  'circle-pitch-scale': 'viewport',
  'circle-emissive-strength': 1,
} as const

export interface MarkerLayerOptions {
  /** How the marker draws. `disc` uses a circle plate; the others bake one. */
  shape: MarkerShape
  /** Id for the plate layer. The glyph layer takes `${id}-glyph`. */
  id: string
  source: string
  filter?: unknown
  minzoom?: number
  /**
   * `icon-image`, resolving to a registered image.
   *
   * For `disc` that is a bare glyph (`map-icon-images.ts`); for `square` and
   * `glyph` it is a composed marker (`marker-image.ts`) carrying its own plate,
   * which is why those shapes need no circle layer under them.
   */
  image: unknown
  /** Circle radius, in px. `disc` only. Number or a zoom expression. */
  radius?: unknown
  /** Ring width, in px. `disc` only. */
  strokeWidth?: unknown
  ringColor?: unknown
  plateColor?: unknown
  plateOpacity?: unknown
  /**
   * `icon-size`. Defaults to the ratio that holds the glyph at
   * `MARKER_GLYPH_RATIO` of a `MARKER_PLATE_SIZE` plate — pass a ramp to track
   * a plate that changes size with zoom.
   */
  iconSize?: unknown
  iconOpacity?: unknown
}

export interface MarkerLayer {
  id: string
  type: 'circle' | 'symbol'
  source: string
  filter?: unknown
  minzoom?: number
  layout?: Record<string, unknown>
  paint?: Record<string, unknown>
}

/**
 * The layers for one set of markers, bottom first.
 *
 * A `disc` comes back as two layers, a plate and its glyph. A `square` or a
 * `glyph` comes back as one, because the plate is baked into the image — two
 * symbol layers cannot be used for a plate and its glyph, since they only share
 * placement when their layout is identical, which pins them to the same image.
 */
export function markerLayers(options: MarkerLayerOptions): MarkerLayer[] {
  const {
    shape,
    id,
    source,
    filter,
    minzoom,
    image,
    radius = MARKER_PLATE_SIZE / 2,
    strokeWidth = MARKER_RING_WIDTH,
    ringColor,
    plateColor,
    plateOpacity,
    iconSize,
    iconOpacity,
  } = options

  const common = {
    source,
    ...(filter === undefined ? {} : { filter }),
    ...(minzoom === undefined ? {} : { minzoom }),
  }

  const glyph: MarkerLayer = {
    ...common,
    // A baked marker IS the plate, so it keeps the caller's id; a glyph drawn
    // over a circle plate is the second half of a pair and is named as such.
    id: shape === 'disc' ? `${id}-glyph` : id,
    type: 'symbol',
    layout: {
      ...MARKER_GLYPH_PLACEMENT,
      'icon-image': image,
      'icon-size':
        iconSize ??
        (shape === 'disc'
          ? markerGlyphSizeForRadius(
              typeof radius === 'number' ? radius : MARKER_PLATE_SIZE / 2,
            )
          : 1),
    },
    ...(iconOpacity === undefined ? {} : { paint: { 'icon-opacity': iconOpacity } }),
  }

  if (shape !== 'disc') return [glyph]

  const plate: MarkerLayer = {
    ...common,
    id,
    type: 'circle',
    layout: {},
    paint: {
      ...MARKER_PLATE_PLACEMENT,
      'circle-color': plateColor,
      'circle-radius': radius,
      'circle-stroke-width': strokeWidth,
      'circle-stroke-color': ringColor,
      ...(plateOpacity === undefined
        ? {}
        : {
            // The ring carries its own opacity: `circle-opacity` only covers
            // the fill, so without this the outline hangs around after the dot
            // has faded out.
            'circle-opacity': plateOpacity,
            'circle-stroke-opacity': plateOpacity,
          }),
    },
  }

  return [plate, glyph]
}
