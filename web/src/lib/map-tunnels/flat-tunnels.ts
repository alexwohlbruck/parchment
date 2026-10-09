/**
 * The basemap's flat road tunnels, which the portals replace from street zoom.
 * Muted rather than hidden, and only where a tunnel runs underground: a
 * passage under a building is drawn on as it was.
 */
type StyleLayer = { id: string; type: string; 'source-layer'?: string }

/** Zoom the portals are drawn from; below it the flat tunnels stay. */
export const TUNNEL_MIN_ZOOM = 15

/** A tunnel feature mapped below ground: a negative layer, or none given. */
export const UNDERGROUND = ['<', ['to-number', ['coalesce', ['get', 'layer'], -1]], 0]

export const isFlatTunnel = (layer: StyleLayer) =>
  layer['source-layer'] === 'transportation' && layer.type === 'line' && /^Tunnel\b/.test(layer.id)

/** A flat tunnel layer's opacity, put out from street zoom where its tunnel is underground. */
export function mutedTunnelOpacity(opacity: unknown): unknown {
  const was = typeof opacity === 'number' ? opacity : 1
  return ['step', ['zoom'], was, TUNNEL_MIN_ZOOM, ['case', UNDERGROUND, 0, was]]
}
