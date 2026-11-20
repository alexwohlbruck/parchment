/**
 * Indigenous lands: reserves, Inuit Owned Lands, tribal and settlement lands.
 * Barrelman serves each parcel and a label point for it, with the name in an
 * Indigenous language (`name_local`) where one is tagged, set over `name`.
 */
import type { FlavorId } from './build'

export const ABORIGINAL_LANDS_SOURCE = 'aboriginal-lands'
/** The barrelman bundle behind the source. */
export const ABORIGINAL_LANDS_TILES = 'aboriginal_lands'

export const ABORIGINAL_LAND_FILL_LAYER = 'Indigenous land'
export const ABORIGINAL_LAND_OUTLINE_LAYER = 'Indigenous land outline'
export const ABORIGINAL_LAND_LABEL_LAYER = 'Indigenous land labels'

const AREAS = 'aboriginal_land_areas'
const LABELS = 'aboriginal_land_labels'

/** Under the water, so lakes inside a parcel stay water-coloured. */
const BELOW = 'River tunnel'
/** Under the place labels, so a town keeps its name over the land around it. */
const LABEL_BELOW = 'Place labels'

const COLORS: Record<FlavorId, { fill: string; outline: string; ink: string; halo: string }> = {
  light: {
    fill: 'hsla(32, 40%, 42%, 0.09)',
    outline: 'hsla(30, 28%, 40%, 0.4)',
    ink: 'hsl(318, 32%, 36%)',
    halo: 'rgba(255, 255, 255, 0.85)',
  },
  dark: {
    fill: 'hsla(32, 30%, 72%, 0.06)',
    outline: 'hsla(32, 22%, 70%, 0.3)',
    ink: 'hsl(318, 30%, 78%)',
    halo: 'rgba(13, 16, 22, 0.85)',
  },
}

export function aboriginalLandsSource(tileUrl: string) {
  return {
    type: 'vector' as const,
    tiles: [tileUrl],
    minzoom: 4,
    maxzoom: 12,
  }
}

const area = ['to-number', ['get', 'area']]

/** Large parcels are named first; a small one only once it is big on screen. */
export function labelFilter(): any {
  return [
    'step', ['zoom'], ['>=', area, 2e9],
    6, ['>=', area, 3e8],
    8, ['>=', area, 3e7],
    10, ['>=', area, 2e6],
    12, true,
  ]
}

const name = ['get', 'name']
const local = ['get', 'name_local']

/** The Indigenous-language name over the English one, or just the one there is. */
export const LABEL_TEXT = [
  'case',
  ['all', ['has', 'name_local'], ['has', 'name']],
  ['format', local, {}, '\n', {}, name, { 'font-scale': 0.85 }],
  ['coalesce', local, name],
]

export function aboriginalLandLayers(flavor: FlavorId): { areas: any[]; labels: any } {
  const c = COLORS[flavor]
  const areas = [
    {
      id: ABORIGINAL_LAND_FILL_LAYER,
      type: 'fill',
      source: ABORIGINAL_LANDS_SOURCE,
      'source-layer': AREAS,
      minzoom: 4,
      paint: {
        'fill-color': c.fill,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0, 6, 1, 14, 1, 16, 0],
      },
    },
    {
      id: ABORIGINAL_LAND_OUTLINE_LAYER,
      type: 'line',
      source: ABORIGINAL_LANDS_SOURCE,
      'source-layer': AREAS,
      minzoom: 5,
      paint: {
        'line-color': c.outline,
        'line-width': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 1.25, 14, 1.75],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0, 7, 1, 14, 1, 16, 0],
      },
    },
  ]
  const labels = {
    id: ABORIGINAL_LAND_LABEL_LAYER,
    type: 'symbol',
    source: ABORIGINAL_LANDS_SOURCE,
    'source-layer': LABELS,
    minzoom: 5,
    maxzoom: 15,
    filter: labelFilter(),
    layout: {
      'text-field': LABEL_TEXT,
      'text-font': ['Geist SemiBold'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 5, 10, 10, 12, 14, 13],
      'text-max-width': 9,
      'text-line-height': 1.15,
      'text-padding': 8,
      'symbol-sort-key': ['-', area],
    },
    paint: {
      'text-color': c.ink,
      'text-halo-color': c.halo,
      'text-halo-width': 1.4,
    },
  }
  return { areas, labels }
}

/** The parcels over the land cover and under the water, their names under the place labels. */
export function withAboriginalLands(layers: any[], flavor: FlavorId): any[] {
  const { areas, labels } = aboriginalLandLayers(flavor)
  const out = [...layers]
  const below = out.findIndex(l => l.id === BELOW)
  if (below >= 0) out.splice(below, 0, ...areas)
  const labelBelow = out.findIndex(l => l.id === LABEL_BELOW)
  if (labelBelow >= 0) out.splice(labelBelow, 0, labels)
  return out
}
