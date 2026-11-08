/**
 * Neighbourhood names below z14, where the OpenMapTiles basemap carries none.
 * Barrelman serves them from z10 with a `tier`, and each tier enters at its own
 * zoom, the way Google and Apple reveal the best-known neighbourhoods first.
 */

export const NEIGHBOURHOOD_SOURCE = 'neighbourhoods'
export const NEIGHBOURHOOD_TILES = 'neighbourhood_labels'
export const NEIGHBOURHOOD_LAYER = 'Neighbourhood labels'

/** The basemap's own place labels take over here. */
const BASEMAP_ZOOM = 14

/** Zoom each tier enters at: quarters, then neighbourhoods with a Wikidata item, then the rest. */
export const TIER_MINZOOM = [11, 12, 13] as const

const PLACE_LABELS = 'Place labels'

export function neighbourhoodSource(tileUrl: string) {
  return {
    type: 'vector' as const,
    tiles: [tileUrl],
    minzoom: 10,
    maxzoom: 13,
  }
}

/** Which tiers are on at the current zoom. */
export function tierFilter(): any {
  const tier = ['to-number', ['get', 'tier']]
  return [
    'step', ['zoom'], false,
    ...TIER_MINZOOM.flatMap((zoom, i) => [zoom, ['<=', tier, i]]),
  ]
}

/** The neighbourhood layer, styled as the basemap's place labels and placed just under them. */
export function withNeighbourhoodLabels(layers: any[]): any[] {
  const at = layers.findIndex(l => l.id === PLACE_LABELS)
  if (at < 0) return layers
  const place = layers[at]
  const labels = {
    ...place,
    id: NEIGHBOURHOOD_LAYER,
    source: NEIGHBOURHOOD_SOURCE,
    'source-layer': NEIGHBOURHOOD_TILES,
    minzoom: TIER_MINZOOM[0],
    maxzoom: BASEMAP_ZOOM,
    filter: tierFilter(),
    layout: {
      ...place.layout,
      'symbol-sort-key': ['to-number', ['get', 'tier']],
    },
  }
  return [...layers.slice(0, at), labels, ...layers.slice(at)]
}
