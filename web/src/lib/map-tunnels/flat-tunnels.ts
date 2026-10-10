/**
 * The flat tunnels, and the marks painted on them, which the portals replace
 * from street zoom. Muted rather than hidden, and only where a tunnel runs
 * underground: a passage under a building is drawn on as it was.
 */
import { drawsTunnel, type BrunnelLayer } from '@/lib/map-style/brunnel'

/** Zoom the portals are drawn from; below it the flat tunnels stay. */
export const TUNNEL_MIN_ZOOM = 15

/** A tunnel feature mapped below ground. A passage under a building is a tunnel with no layer, so only a negative one counts. */
export const UNDERGROUND = ['<', ['to-number', ['coalesce', ['get', 'layer'], 0]], 0]

export const isFlatTunnel = (layer: BrunnelLayer) => layer.type === 'line' && drawsTunnel(layer)

/**
 * A flat tunnel layer's opacity, put out from street zoom where its tunnel is
 * underground. Only the basemap says which way that is; the cycling network's
 * ways carry no layer, so a mark on one of its tunnels goes either way.
 */
export function mutedTunnelOpacity(opacity: unknown, layer: BrunnelLayer): unknown {
  const was = typeof opacity === 'number' ? opacity : 1
  const muted = layer['source-layer'] === 'transportation' ? ['case', UNDERGROUND, 0, was] : 0
  return ['step', ['zoom'], was, TUNNEL_MIN_ZOOM, muted]
}
