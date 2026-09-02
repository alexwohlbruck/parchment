/**
 * A place marker as inline CSS, for the ones drawn in the DOM.
 *
 * Search results and timeline stops are Vue markers rather than style layers,
 * so they cannot share a layer spec with saved places — but they must not be a
 * second opinion about how big a marker is or how round its corners are. They
 * get the same numbers, converted to CSS here.
 *
 * Returns a plain style object rather than Tailwind classes: the sizes are
 * derived from `marker-metrics`, and a class string would mean restating them
 * in a form the metrics can no longer reach.
 */

import {
  MARKER_GLYPH_RATIO,
  MARKER_PLATE_SIZE,
  MARKER_RING_WIDTH,
  MARKER_SQUARE_CORNER,
} from './marker-metrics.mjs'
import type { MarkerShape } from './marker-shape'
import type { MarkerPaint } from './marker-paint'

export interface MarkerCss {
  /** The plate, ring and layout — everything but the glyph. */
  plate: Record<string, string>
  /** The glyph inside it, sized as a share of the plate. */
  glyph: Record<string, string>
}

/**
 * The plate is drawn at its full width plus its ring, the way a border box
 * grows outward — so a `MARKER_PLATE_SIZE` plate with a 1.5px ring occupies
 * 22px, which is what the native circle layer's radius-plus-stroke comes to.
 * Getting that wrong is how a DOM marker ends up a different size from the
 * layer-drawn one beside it.
 */
export function markerCss(
  paint: MarkerPaint,
  shape: MarkerShape,
  size = MARKER_PLATE_SIZE,
): MarkerCss {
  const glyph = {
    width: `${round(size * MARKER_GLYPH_RATIO)}px`,
    height: `${round(size * MARKER_GLYPH_RATIO)}px`,
    color: paint.ink,
  }

  // No plate, no ring, no shadow — a bare glyph takes a halo instead, which is
  // the only thing holding it off the map underneath.
  if (shape === 'glyph') {
    return {
      plate: {
        width: `${size}px`,
        height: `${size}px`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        filter: `drop-shadow(0 0 1.5px ${paint.ring}) drop-shadow(0 0 1.5px ${paint.ring})`,
      },
      glyph,
    }
  }

  return {
    plate: {
      width: `${size + MARKER_RING_WIDTH * 2}px`,
      height: `${size + MARKER_RING_WIDTH * 2}px`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: paint.plate ?? 'transparent',
      border: `${MARKER_RING_WIDTH}px solid ${paint.ring}`,
      borderRadius:
        shape === 'square' ? `${round(size * MARKER_SQUARE_CORNER)}px` : '9999px',
    },
    glyph,
  }
}

const round = (n: number) => Math.round(n * 100) / 100
