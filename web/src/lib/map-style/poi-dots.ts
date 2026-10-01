/**
 * Every POI as a small dot under the badges, so a dense block still reads as
 * dense once the badges have thinned out by rank. Its placement is isolated
 * from every other symbol (see `ISOLATED_COLLISION_LAYERS`): dots declutter
 * among themselves without ever costing a badge or a label its place.
 */
import { isTransitPoi } from './transit-poi.mjs'

export const POI_DOTS_LAYER = 'POI dots'

/** Layers whose symbols collide only with each other. */
export const ISOLATED_COLLISION_LAYERS = [POI_DOTS_LAYER]

const MIN_ZOOM = 15

/** A layer's filter without its zoom-stepped rank gate. */
function ungated(filter: any[]): any[] {
  return ['all', ...filter.slice(1).filter(clause => clause[0] !== 'step')]
}

function isPoiBadgeLayer(l: any): boolean {
  return l.type === 'symbol' && l['source-layer'] === 'poi' && Array.isArray(l.filter)
}

/** The badge name's `|`-separated parts, as expressions; see `parseBadgeName`. */
function badgeParts(iconImage: any): any[][] | null {
  if (!Array.isArray(iconImage) || iconImage[0] !== 'concat' || iconImage[1] !== 'poi|') return null
  const parts: any[][] = [[]]
  for (const arg of iconImage.slice(2)) {
    if (arg === '|') parts.push([])
    else parts[parts.length - 1].push(arg)
  }
  return parts
}

const PLATE_TOKEN = /^@poi_plate_(.+)$/

/** The badge's plate expression, with each category plate swapped for a dot tint. */
function retint(plate: any, kind: 'fill' | 'edge'): any {
  if (typeof plate === 'string') {
    const category = PLATE_TOKEN.exec(plate)?.[1]
    return category ? `@@category-dot-${kind}:${category}` : plate
  }
  return Array.isArray(plate) ? plate.map(p => retint(p, kind)) : plate
}

/** A dot's fill and edge: its badge's category tint, or the glyph-only style's icon and halo. */
function dotColors(layer: any): { fill: unknown; edge: unknown } {
  const plate = badgeParts(layer.layout?.['icon-image'])?.[1][0]
  if (plate) return { fill: retint(plate, 'fill'), edge: retint(plate, 'edge') }
  return { fill: layer.paint?.['icon-color'], edge: layer.paint?.['icon-halo-color'] }
}

/** The dot layer for an unresolved layer list, or null if it has no POI layers. */
export function poiDotLayer(layers: any[]): any | null {
  const badges = layers.filter(isPoiBadgeLayer)
  if (!badges.length) return null

  const colors = badges.map(dotColors)
  const byLayer = (key: 'fill' | 'edge') => [
    'case',
    ...badges.flatMap((l, i) => [ungated(l.filter), colors[i][key]]),
    colors[0][key],
  ]

  return {
    id: POI_DOTS_LAYER,
    type: 'symbol',
    source: badges[0].source,
    'source-layer': 'poi',
    minzoom: MIN_ZOOM,
    filter: ['all', ['!', isTransitPoi()], ['any', ...badges.map(l => ungated(l.filter))]],
    layout: {
      'icon-image': 'circle',
      'icon-size': ['interpolate', ['linear'], ['zoom'], MIN_ZOOM, 0, MIN_ZOOM + 2, 0.3, 19, 0.4],
      'icon-padding': 1,
      'symbol-sort-key': ['to-number', ['get', 'rank']],
    },
    paint: {
      'icon-color': byLayer('fill'),
      'icon-halo-color': byLayer('edge'),
      'icon-halo-width': 1,
    },
  }
}
