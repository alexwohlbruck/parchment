/** Which paint properties make a layer see-through, by layer type. */
const OPACITY: Record<string, string[]> = {
  fill: ['fill-opacity'],
  line: ['line-opacity'],
  circle: ['circle-opacity', 'circle-stroke-opacity'],
  symbol: ['icon-opacity', 'text-opacity'],
  'fill-extrusion': ['fill-extrusion-opacity'],
  raster: ['raster-opacity'],
  heatmap: ['heatmap-opacity'],
}

/** A layer's opacity paint scaled to `factor`, by property, for each one it has. */
export function fadedPaint(type: string, current: (property: string) => unknown, factor: number): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const property of OPACITY[type] ?? []) out[property] = scaleOpacity(current(property), factor)
  return out
}

const isZoom = (e: unknown) => Array.isArray(e) && e[0] === 'zoom'

/**
 * An opacity value times `factor`. A zoom curve has to stay the outermost
 * expression, so its outputs are scaled rather than the whole of it.
 */
export function scaleOpacity(value: unknown, factor: number): unknown {
  if (value === undefined || value === null) return factor
  if (typeof value === 'number') return value * factor
  if (Array.isArray(value)) {
    if (value[0] === 'interpolate' && isZoom(value[2]))
      return value.map((v, i) => (i >= 4 && i % 2 === 0 ? scaleOpacity(v, factor) : v))
    if (value[0] === 'step' && isZoom(value[1]))
      return value.map((v, i) => (i >= 2 && i % 2 === 0 ? scaleOpacity(v, factor) : v))
    return ['*', value, factor]
  }
  if (typeof value === 'object' && Array.isArray((value as any).stops))
    return { ...(value as any), stops: (value as any).stops.map(([z, v]: [unknown, unknown]) => [z, scaleOpacity(v, factor)]) }
  return value
}
