/**
 * Monorails: OpenMapTiles carries them as `class=transit, subclass=monorail`,
 * which MapTiler's spec has no layer for. Hand-authored because `spec.json` is
 * regenerated wholesale. The basemap has them from z14 only.
 */
import type { FlavorId } from './build'

export const MONORAIL_LAYER = 'Monorail'
export const MONORAIL_CASING_LAYER = 'Monorail casing'

export const MONORAIL_FILTER = [
  'all',
  ['==', ['get', 'class'], 'transit'],
  ['==', ['get', 'subclass'], 'monorail'],
] as any

const MONORAIL_COLORS: Record<FlavorId, { beam: string; casing: string }> = {
  light: { beam: 'hsl(36, 12%, 90%)', casing: 'hsl(30, 7%, 60%)' },
  dark: { beam: 'hsl(34, 6%, 60%)', casing: 'hsl(216, 28%, 13%)' },
}

// Wider than any rail line, so it reads as a solid beam rather than track.
const width = (extra: number) => [
  'interpolate', ['exponential', 1.6], ['zoom'],
  14, 1.4 + extra,
  16, 2.6 + extra,
  18, 5 + extra * 1.5,
  20, 12 + extra * 2,
]

const OPACITY = [
  'case',
  ['==', ['get', 'brunnel'], 'tunnel'], 0.4,
  ['match', ['get', 'service'], ['yard', 'siding'], true, false], 0.6,
  1,
]

export function monorailLayers(flavor: FlavorId, source: string): any[] {
  const c = MONORAIL_COLORS[flavor]
  const common = {
    type: 'line',
    source,
    'source-layer': 'transportation',
    minzoom: 14,
    filter: MONORAIL_FILTER,
    layout: {
      'line-join': 'round',
      'line-cap': 'butt',
      'line-sort-key': ['coalesce', ['get', 'layer'], 0],
    },
  }
  return [
    {
      ...common,
      id: MONORAIL_CASING_LAYER,
      paint: { 'line-color': c.casing, 'line-width': width(1.5), 'line-opacity': OPACITY },
    },
    {
      ...common,
      id: MONORAIL_LAYER,
      paint: { 'line-color': c.beam, 'line-width': width(0), 'line-opacity': OPACITY },
    },
  ]
}
