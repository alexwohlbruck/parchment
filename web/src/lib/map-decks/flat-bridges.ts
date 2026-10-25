/**
 * The flat copies of what a deck draws: bridge ways, bridge areas, and the
 * lane geometry served for them. Muted, not hidden, so their tiles keep
 * loading for the decks to read.
 */
import type { FilterSpecification } from '@maplibre/maplibre-gl-style-spec'
import { combineFilters } from '@/lib/map-style/combine-filters'

type StyleLayer = { id: string; type: string; 'source-layer'?: string }

/** The opacity property to zero for a flat bridge layer, or null if it is not one. */
export function flatBridgeOpacity(layer: StyleLayer): string | null {
  const flat = layer['source-layer'] ?? ''
  const bridge = (flat === 'transportation' && (layer.type === 'line' || layer.type === 'fill') && /bridge/i.test(layer.id)) ||
    (/^road_/.test(flat) && / bridge$/.test(layer.id))
  if (!bridge) return null
  return layer.type === 'symbol' ? 'icon-opacity' : `${layer.type}-opacity`
}

const NOT_BRIDGE = ['!=', ['get', 'brunnel'], 'bridge']

/** Whether a layer places basemap road names or arrows, which decks leave out under them. */
export function isFlatBridgeLabel(layer: StyleLayer): boolean {
  return layer.type === 'symbol' && ['transportation', 'transportation_name'].includes(layer['source-layer'] ?? '')
}

/**
 * A basemap road symbol layer's filter with the ways on the decks left out, or
 * null if it is not one: a name or arrow placed along a bridge would lie on the
 * ground under its deck. Names carry no brunnel, so they go by lying within a deck's `footprint`.
 */
export function flatBridgeLabelFilter(layer: StyleLayer & { filter?: unknown }, footprint: GeoJSON.MultiPolygon): FilterSpecification | null {
  if (!isFlatBridgeLabel(layer)) return null
  return combineFilters([layer.filter, NOT_BRIDGE, ['!', ['within', footprint]]])
}
