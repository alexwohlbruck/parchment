/**
 * The flat copies of what a deck draws: bridge ways, bridge areas, and the
 * lane geometry served for them. Muted, not hidden, so their tiles keep
 * loading for the decks to read.
 */
type StyleLayer = { id: string; type: string; 'source-layer'?: string }

/** The opacity property to zero for a flat bridge layer, or null if it is not one. */
export function flatBridgeOpacity(layer: StyleLayer): string | null {
  const flat = layer['source-layer'] ?? ''
  const bridge = (flat === 'transportation' && (layer.type === 'line' || layer.type === 'fill') && /bridge/i.test(layer.id)) ||
    (/^road_/.test(flat) && / bridge$/.test(layer.id))
  if (!bridge) return null
  return layer.type === 'symbol' ? 'icon-opacity' : `${layer.type}-opacity`
}
