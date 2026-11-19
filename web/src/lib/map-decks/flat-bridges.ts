/**
 * The flat copies of what a deck draws: bridge ways, bridge areas, and the
 * lane geometry served for them. Muted, not hidden, so their tiles keep
 * loading for the decks to read.
 */
type StyleLayer = { id: string; type: string; 'source-layer'?: string }

/** Whether a layer draws a bridge flat on the ground, which a deck stands in for. */
export function isFlatBridge(layer: StyleLayer): boolean {
  const flat = layer['source-layer'] ?? ''
  return (flat === 'transportation' && (layer.type === 'line' || layer.type === 'fill') && /bridge/i.test(layer.id)) ||
    (/^road_/.test(flat) && / bridge$/.test(layer.id))
}

/** Whether a layer places basemap road names or arrows, which are left out wherever a deck stands over them. */
export function isFlatBridgeLabel(layer: StyleLayer): boolean {
  return layer.type === 'symbol' && ['transportation', 'transportation_name'].includes(layer['source-layer'] ?? '')
}
