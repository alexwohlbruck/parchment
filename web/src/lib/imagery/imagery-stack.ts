import type {
  LayerSpecification,
  RasterSourceSpecification,
} from 'maplibre-gl'
import { LayerType, type Layer } from '@/types/map.types'

/** One source in the satellite basemap's stack. */
export interface ImagerySource {
  id: string
  source: RasterSourceSpecification
  paint?: Record<string, unknown>
}

const PREFIX = 'imagery:'

export const isImageryStyleId = (id: string) => id.startsWith(PREFIX)

export function isImageryLayer(layer: Layer): boolean {
  const source = layer.configuration?.source
  return (
    layer.type === LayerType.IMAGERY &&
    typeof source === 'object' &&
    source?.type === 'raster'
  )
}

/** The chosen imagery, top first, without any that left the library. */
export function resolveImageryStack(
  ids: readonly string[],
  layers: readonly Layer[],
): ImagerySource[] {
  const byId = new Map(layers.filter(isImageryLayer).map(l => [l.id, l]))
  return ids.flatMap(id => {
    const layer = byId.get(id)
    if (!layer) return []
    const { id: _, ...source } = layer.configuration.source as Record<string, unknown>
    const paint = layer.configuration.paint as Record<string, unknown> | undefined
    return [{ id, source: source as unknown as RasterSourceSpecification, ...(paint ? { paint } : {}) }]
  })
}

/**
 * The style's share of a stack. The bottom source is drawn first, so each one
 * shows through wherever those above it have no tile or a transparent one.
 */
export function imageryStyle(stack: readonly ImagerySource[]): {
  sources: Record<string, RasterSourceSpecification>
  layers: LayerSpecification[]
} {
  return {
    sources: Object.fromEntries(stack.map(s => [PREFIX + s.id, s.source])),
    layers: [...stack].reverse().map(
      s =>
        ({
          id: PREFIX + s.id,
          type: 'raster',
          source: PREFIX + s.id,
          ...(s.paint ? { paint: s.paint } : {}),
        }) as LayerSpecification,
    ),
  }
}

/** Move `id` one place up (-1) or down (+1) the stack. */
export function moveInStack(ids: readonly string[], id: string, step: -1 | 1): string[] {
  const from = ids.indexOf(id)
  const to = from + step
  if (from === -1 || to < 0 || to >= ids.length) return [...ids]
  const next = [...ids]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}
