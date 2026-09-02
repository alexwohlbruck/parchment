/**
 * The colours a place marker is drawn in, for any shape and any surface.
 *
 * One function, because a search result, the basemap POI underneath it and the
 * same place saved to a collection are one thing wearing one look. They used to
 * come out of three: a hand-written `measure-light` ramp per category in the
 * layer constants, a `getCategoryMarkerTint` for the DOM markers, and `tintOf`
 * in the style builder. All three are now this, over `getCustomColorTint`.
 *
 * Deliberately free of Vue, of the DOM and of stores — the style generator runs
 * this under node, and the tests run it without a map.
 */

import { getCustomColorTint } from '@/lib/color-tint'
import type { MarkerShape } from './marker-shape'

export type { MarkerShape }

/**
 * What a marker is painted with.
 *
 * `plate` is null for a `glyph` marker, which has no plate to paint — callers
 * draw the glyph alone and lean on `ring` as a halo instead.
 */
export interface MarkerPaint {
  /** The plate behind the glyph, or null when the shape has none. */
  plate: string | null
  /** The glyph itself. */
  ink: string
  /** The outline around the plate, or the halo behind a bare glyph. */
  ring: string
}

/**
 * A plate carries its colour; a bare glyph has to BE its colour.
 *
 * The solid tint puts a pale plate under a deep glyph, which is right when
 * there is a plate — but a `glyph` marker drawn in the solid foreground on open
 * map reads as almost black. The ghost tint is the same colour taken to a
 * lightness that stands on its own, which is what it exists for.
 */
const VARIANT: Record<MarkerShape, 'solid' | 'ghost'> = {
  disc: 'solid',
  square: 'solid',
  glyph: 'ghost',
}

/** The halo behind a bare glyph, per flavor — the basemap's own `poi_halo`. */
const GLYPH_HALO = { light: '#FFFFFF', dark: '#0D0D0D' }

/**
 * The plate, glyph and ring a colour tints to for a given marker shape.
 *
 * Falls back to the colour itself when it will not parse, which draws a flat
 * marker rather than none at all — a marker that throws takes its whole layer
 * down with it.
 */
export function markerPaint(
  color: string,
  shape: MarkerShape,
  isDark: boolean,
): MarkerPaint {
  const halo = isDark ? GLYPH_HALO.dark : GLYPH_HALO.light
  const tint = getCustomColorTint(color, VARIANT[shape], isDark)

  if (shape === 'glyph') {
    return { plate: null, ink: tint?.foreground ?? color, ring: halo }
  }

  const ink = tint?.foreground ?? (isDark ? '#0C0C0C' : '#FFFFFF')
  return {
    plate: tint?.background ?? color,
    ink,
    ring: tint?.ring ?? ink,
  }
}
