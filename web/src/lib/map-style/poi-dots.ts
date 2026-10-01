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

/**
 * The dot layer for a resolved layer list, or null if it has no POI layers.
 * Each dot takes its colour from the label colour of the layer that would badge
 * it, so it matches in either POI style.
 */
export function poiDotLayer(layers: any[]): any | null {
  const badges = layers.filter(isPoiBadgeLayer)
  if (!badges.length) return null

  const color = ['case', ...badges.flatMap(l => [ungated(l.filter), l.paint['text-color']]), badges[0].paint['text-color']]

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
      'icon-color': color,
      'icon-halo-color': badges[0].paint['text-halo-color'],
      'icon-halo-width': 1,
    },
  }
}
