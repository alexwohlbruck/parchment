/**
 * Names of buildings that are not otherwise a place, such as the halls of a
 * campus. The tiles carry them in the `poi` layer as class `building`, which no
 * badge layer matches, so they draw here as a name over a small dot.
 */

export const BUILDING_LABELS_LAYER = 'Building labels'

const MIN_ZOOM = 16

/** The dot a place without a category badge wears, in the default category's tint. */
const DOT = {
  layout: {
    'icon-image': 'circle',
    'icon-size': 0.4,
    'text-anchor': 'bottom',
    'text-offset': [0, -0.45],
  },
  paint: {
    'icon-color': '@@category-dot-fill:default',
    'icon-halo-color': '@@category-dot-edge:default',
    'icon-halo-width': 1,
  },
}

/** The POI layer's text settings, so a building's name reads like any other place's. */
function poiText(poi: any) {
  const text = (o: Record<string, unknown> = {}) =>
    Object.fromEntries(Object.entries(o).filter(([k]) => k.startsWith('text-')))
  return { layout: text(poi.layout), paint: text(poi.paint) }
}

function buildingLabelLayer(poi: any): any {
  const text = poiText(poi)
  return {
    id: BUILDING_LABELS_LAYER,
    type: 'symbol',
    source: poi.source,
    'source-layer': 'poi',
    minzoom: MIN_ZOOM,
    filter: ['all', ['==', ['get', 'class'], 'building'], ['has', 'name']],
    layout: {
      ...text.layout,
      ...DOT.layout,
      'text-optional': false,
      'symbol-sort-key': ['to-number', ['get', 'rank']],
    },
    paint: {
      ...text.paint,
      ...DOT.paint,
      'text-color': '@poi_ink_default',
      'text-opacity': 1,
    },
  }
}

/** Under the lowest POI layer, so a place's badge wins the space from a building's name. */
export function withBuildingLabels(layers: any[]): any[] {
  const at = layers.findIndex(l => l.type === 'symbol' && l['source-layer'] === 'poi')
  const poi = layers.find(l => l.type === 'symbol' && l['source-layer'] === 'poi' && l.layout?.['text-field'])
  if (at < 0 || !poi) return layers
  return [...layers.slice(0, at), buildingLabelLayer(poi), ...layers.slice(at)]
}
