/**
 * Names of buildings that are not otherwise a place, such as the halls of a
 * campus. The tiles carry them in the `poi` layer as class `building`, which no
 * badge layer matches, so they draw here as plain text.
 */

export const BUILDING_LABELS_LAYER = 'Building labels'

const MIN_ZOOM = 16

function buildingLabelLayer(source: string): any {
  return {
    id: BUILDING_LABELS_LAYER,
    type: 'symbol',
    source,
    'source-layer': 'poi',
    minzoom: MIN_ZOOM,
    filter: ['all', ['==', ['get', 'class'], 'building'], ['has', 'name']],
    layout: {
      'text-field': '{name}',
      'text-font': ['Geist Medium'],
      'text-size': ['interpolate', ['linear'], ['zoom'], MIN_ZOOM, 11, 19, 13],
      'text-max-width': 7,
      'text-line-height': 1.05,
      'text-padding': 4,
      'symbol-sort-key': ['to-number', ['get', 'rank']],
    },
    paint: {
      'text-color': '@label_ink_muted',
      'text-halo-color': '@label_halo',
      'text-halo-width': 1.2,
      'text-opacity': ['interpolate', ['linear'], ['zoom'], MIN_ZOOM, 0, MIN_ZOOM + 0.5, 1],
    },
  }
}

/** Under the lowest POI layer, so a place's badge wins the space from a building's name. */
export function withBuildingLabels(layers: any[]): any[] {
  const at = layers.findIndex(l => l.type === 'symbol' && l['source-layer'] === 'poi')
  if (at < 0) return layers
  return [...layers.slice(0, at), buildingLabelLayer(layers[at].source), ...layers.slice(at)]
}
