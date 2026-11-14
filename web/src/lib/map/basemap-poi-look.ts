/** The basemap's POI symbol layers, and the look an overlay borrows to pass for one. */

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

const LAYOUT_KEYS = [
  'icon-size',
  'icon-padding',
  'text-font',
  'text-size',
  'text-offset',
  'text-anchor',
  'text-justify',
  'text-variable-anchor',
  'text-radial-offset',
  'text-max-width',
  'text-letter-spacing',
  'text-line-height',
  'text-padding',
  'text-transform',
  'text-optional',
]

const PAINT_KEYS = ['text-halo-color', 'text-halo-width', 'text-halo-blur']

function pick(from: Record<string, unknown> | undefined, keys: string[]) {
  const out: Record<string, unknown> = {}
  for (const key of keys) if (from?.[key] !== undefined) out[key] = from[key]
  return out
}

/** Lettering and sizing of the first labelled basemap POI layer, or null when the style has none. */
export function basemapPoiLook(
  layers: readonly StyleLayer[],
): { layout: Record<string, unknown>; paint: Record<string, unknown> } | null {
  const poi = layers.find(l => isBasemapPoiLayer(l) && l.layout?.['text-field'] !== undefined)
  if (!poi) return null
  return { layout: pick(poi.layout, LAYOUT_KEYS), paint: pick(poi.paint, PAINT_KEYS) }
}
