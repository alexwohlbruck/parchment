/**
 * Layers ease into and out of view rather than popping. Two ways in:
 *
 * - at a zoom edge: opacity ramps over half a zoom up from a layer's `minzoom`
 *   and down into its `maxzoom`, folded into any zoom curve it already has;
 * - as a tile arrives: the detail tiles' fills and lines take the fork's
 *   `parchment:tile-fade`, since they often land after the zoom ramp is over.
 */
import { DETAIL_SOURCE } from './detail-layers'

/** Zoom levels a layer takes to come in at its `minzoom`, or to leave by its `maxzoom`. */
export const ZOOM_FADE = 0.5
/** Milliseconds a newly arrived detail tile's fills and lines take to fade in; MapLibre's own label fade. */
export const TILE_FADE_MS = 300
/** Edges below this are the globe's, which hands over by design. */
const LEAST_EDGE = 11

const OPACITY: Record<string, string[]> = {
  fill: ['fill-opacity'],
  line: ['line-opacity'],
  circle: ['circle-opacity', 'circle-stroke-opacity'],
}

type Stops = Array<[number, unknown]>
/** A layer as the style builds it, with the paint and metadata an entrance may add. */
type Faded<T> = T & { paint?: Record<string, any>; metadata?: Record<string, any> }

const isZoom = (e: unknown) => Array.isArray(e) && e[0] === 'zoom'
const isZoomCurve = (v: unknown): v is any[] => Array.isArray(v) && v[0] === 'interpolate' && isZoom(v[2])
const usesZoom = (v: unknown): boolean => Array.isArray(v) && (isZoom(v) || v.some(usesZoom))

function stopsOf(curve: any[]): Stops {
  const stops: Stops = []
  for (let i = 3; i < curve.length; i += 2) stops.push([curve[i], curve[i + 1]])
  return stops
}

/** `a` and `b` mixed by `t`, folded to a number where both are numbers. */
function mix(a: unknown, b: unknown, t: number): unknown {
  if (t <= 0) return a
  if (t >= 1) return b
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * t
  return ['+', ['*', a, 1 - t], ['*', b, t]]
}

/** A curve's value at a zoom, as a number or an expression of the feature. */
function valueAt(interpolation: any[], stops: Stops, zoom: number): unknown {
  if (zoom <= stops[0][0]) return stops[0][1]
  const after = stops.findIndex(([z]) => z >= zoom)
  if (after === -1) return stops[stops.length - 1][1]
  const [[z0, a], [z1, b]] = [stops[after - 1], stops[after]]
  const base = interpolation[0] === 'exponential' ? interpolation[1] : 1
  const t = base === 1 ? (zoom - z0) / (z1 - z0) : (base ** (zoom - z0) - 1) / (base ** (z1 - z0) - 1)
  return mix(a, b, t)
}

/** Whether a value is nothing at a zoom, as an opacity already ramping in from 0 is. */
const zeroAt = (value: unknown, zoom: number) =>
  value === 0 || (isZoomCurve(value) && valueAt(value[1], stopsOf(value), zoom) === 0)

/**
 * An opacity that is 0 at `clear` and the value it had at `full`, linearly between, and unchanged beyond `full`.
 * Null where the value cannot be folded: a stepped or legacy curve, or zoom buried inside another expression.
 */
export function rampedOpacity(value: unknown, clear: number, full: number): unknown {
  if (value === undefined) value = 1
  if (isZoomCurve(value)) {
    const stops = stopsOf(value)
    const rising = full > clear
    const kept = stops.filter(([z]) => (rising ? z > full : z < full))
    const edges: Stops = [[clear, 0], [full, valueAt(value[1], stops, full)]]
    const all = rising ? [...edges, ...kept] : [...kept, ...edges.reverse()]
    return ['interpolate', value[1], ['zoom'], ...all.flat()]
  }
  if (usesZoom(value) || (typeof value === 'object' && value !== null && !Array.isArray(value))) return null
  return full > clear
    ? ['interpolate', ['linear'], ['zoom'], clear, 0, full, value]
    : ['interpolate', ['linear'], ['zoom'], full, value, clear, 0]
}

/** Metadata for a layer that must stay opaque, so it pops in rather than fading. */
export const NO_ZOOM_FADE = { 'parchment:zoom-fade': false } as const

/** A layer that eases in from its `minzoom` and out by its `maxzoom`, where it would otherwise pop. */
export function withZoomFades<T extends Record<string, any>>(layer: T): Faded<T> {
  const properties = OPACITY[layer.type]
  if (!properties || layer.metadata?.['parchment:zoom-fade'] === false) return layer
  const from = layer.minzoom ?? 0
  const until = layer.maxzoom ?? 24
  const fadeIn = from >= LEAST_EDGE
  const fadeOut = until >= LEAST_EDGE && until < 24
  if (!fadeIn && !fadeOut) return layer
  const paint: Record<string, unknown> = { ...layer.paint }
  for (const property of properties) {
    let value = paint[property]
    if (fadeIn && !zeroAt(value, from)) value = rampedOpacity(value, from, Math.min(from + ZOOM_FADE, until)) ?? value
    if (fadeOut && !zeroAt(value, until)) value = rampedOpacity(value, until, Math.max(until - ZOOM_FADE, from)) ?? value
    if (value !== undefined) paint[property] = value
  }
  return { ...layer, paint }
}

/** A detail tile's fill or line, which fades in as its tile arrives; see `parchment:tile-fade` in the fork. */
export function withTileFade<T extends Record<string, any>>(layer: T): Faded<T> {
  if (layer.source !== DETAIL_SOURCE || (layer.type !== 'fill' && layer.type !== 'line')) return layer
  return { ...layer, metadata: { ...layer.metadata, 'parchment:tile-fade': TILE_FADE_MS } }
}

export const withEntrance = <T extends Record<string, any>>(layer: T): Faded<T> => withTileFade(withZoomFades(layer))
