/** The basemap's POI symbol layers, and the look an overlay borrows to pass for one. */
import { POI_DOTS_LAYER } from '@/lib/map-style/poi-dots'
import { POI_BADGE_PREFIX } from '@/lib/map-style/poi-badge'

/** The GeoJSON source the POI layers move onto once they are lifted to roof height. */
export const RAISED_POI_SOURCE = 'poi-dots-raised'

interface StyleLayer {
  id: string
  type: string
  source?: unknown
  'source-layer'?: string
  layout?: Record<string, unknown>
  paint?: Record<string, unknown>
}

export function isBasemapPoiLayer(layer: StyleLayer): boolean {
  return (
    layer.type === 'symbol' &&
    (layer['source-layer'] === 'poi' || layer.source === RAISED_POI_SOURCE)
  )
}

/** A POI layer that draws badges and names, rather than the dots under them. */
export function isBasemapPoiBadgeLayer(layer: StyleLayer): boolean {
  return isBasemapPoiLayer(layer) && layer.id !== POI_DOTS_LAYER
}

/** Per-feature or per-overlay properties, which the overlay sets itself. */
const OWN_KEYS = new Set([
  'icon-image',
  'text-field',
  'text-color',
  'symbol-sort-key',
  'icon-opacity',
  'text-opacity',
  'visibility',
])

function omitOwn(from: Record<string, unknown> | undefined) {
  return Object.fromEntries(Object.entries(from ?? {}).filter(([key]) => !OWN_KEYS.has(key)))
}

export interface BasemapPoiLook {
  layout: Record<string, unknown>
  paint: Record<string, unknown>
  /** The style composites `poi|` badges, so an overlay can name one per feature. */
  badges: boolean
}

/** Layout and paint of the first labelled basemap POI layer, or null when the style has none. */
export function basemapPoiLook(layers: readonly StyleLayer[]): BasemapPoiLook | null {
  const poi = layers.find(l => isBasemapPoiBadgeLayer(l) && l.layout?.['text-field'] !== undefined)
  if (!poi) return null
  const image = poi.layout?.['icon-image']
  return {
    layout: omitOwn(poi.layout),
    paint: omitOwn(poi.paint),
    badges: Array.isArray(image) && image[0] === 'concat' && image[1] === POI_BADGE_PREFIX,
  }
}
