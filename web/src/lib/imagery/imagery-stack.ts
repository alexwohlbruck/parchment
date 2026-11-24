import type {
  LayerSpecification,
  RasterSourceSpecification,
} from 'maplibre-gl'
import { LayerType, type Layer } from '@/types/map.types'

/** One source in the satellite basemap's stack: a raster in the style, or 3D tiles drawn by their own layer. */
export type ImagerySource =
  | { id: string; kind: 'raster'; source: RasterSourceSpecification; paint?: Record<string, unknown> }
  | { id: string; kind: '3d-tiles'; url: string }

const PREFIX = 'imagery:'

/** Zoom the 3D tiles are drawn from; below it the globe is round and the rasters show instead. */
export const PHOTOREALISTIC_MIN_ZOOM = 12

export const isImageryStyleId = (id: string) => id.startsWith(PREFIX)

const IMAGERY_SOURCE_TYPES = new Set(['raster', '3d-tiles'])

function sourceType(layer: Layer): string | undefined {
  const source = layer.configuration?.source
  return typeof source === 'object' ? source?.type : undefined
}

export function isImageryLayer(layer: Layer): boolean {
  return layer.type === LayerType.IMAGERY && IMAGERY_SOURCE_TYPES.has(sourceType(layer) ?? '')
}

/** The imagery a user may pick; Photorealistic 3D is a premium source. */
export function availableImagery(layers: readonly Layer[], photorealistic: boolean): Layer[] {
  return layers.filter(
    l => isImageryLayer(l) && (photorealistic || sourceType(l) !== '3d-tiles'),
  )
}

function toImagerySource(layer: Layer): ImagerySource {
  const { id: _, ...source } = layer.configuration.source as Record<string, unknown>
  if (source.type === '3d-tiles') return { id: layer.id, kind: '3d-tiles', url: String(source.url) }
  const paint = layer.configuration.paint as Record<string, unknown> | undefined
  return {
    id: layer.id,
    kind: 'raster',
    source: source as unknown as RasterSourceSpecification,
    ...(paint ? { paint } : {}),
  }
}

/** The chosen imagery, top first, without any that left the library. */
export function resolveImageryStack(
  ids: readonly string[],
  layers: readonly Layer[],
): ImagerySource[] {
  const byId = new Map(layers.filter(isImageryLayer).map(l => [l.id, l]))
  return ids.flatMap(id => {
    const layer = byId.get(id)
    return layer ? [toImagerySource(layer)] : []
  })
}

/** The 3D tiles to draw over the rasters: the topmost in the stack, since a mesh hides all below it. */
export function photorealisticSource(stack: readonly ImagerySource[]) {
  return stack.find(s => s.kind === '3d-tiles')
}

/**
 * The style's share of a stack. The bottom source is drawn first, so each one
 * shows through wherever those above it have no tile or a transparent one.
 * Under 3D tiles the rasters stop where the mesh starts.
 */
export function imageryStyle(stack: readonly ImagerySource[]): {
  sources: Record<string, RasterSourceSpecification>
  layers: LayerSpecification[]
} {
  const rasters = stack.flatMap(s => (s.kind === 'raster' ? [s] : []))
  const maxzoom = photorealisticSource(stack) ? { maxzoom: PHOTOREALISTIC_MIN_ZOOM } : {}
  return {
    sources: Object.fromEntries(rasters.map(s => [PREFIX + s.id, s.source])),
    layers: [...rasters].reverse().map(
      s =>
        ({
          id: PREFIX + s.id,
          type: 'raster',
          source: PREFIX + s.id,
          ...maxzoom,
          ...(s.paint ? { paint: s.paint } : {}),
        }) as LayerSpecification,
    ),
  }
}
