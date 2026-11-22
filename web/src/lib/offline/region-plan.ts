import type { Bounds, OfflineLayerOption, OfflineRegion, OfflineSource } from '@/types/offline.types'
import { countTilesByZoom, sourceTileUrls } from './tiles'

/** Fallback bytes per tile, for a source no sample has been measured for. */
const AVERAGE_TILE_BYTES: Record<OfflineSource['kind'], number> = {
  vector: 45_000,
  raster: 30_000,
  'raster-dem': 90_000,
}
const AVERAGE_FILE_BYTES = 40_000
/** A sample is taken at the centre, which is usually denser than the edges. */
const SAMPLE_WEIGHT = 0.5
const MIN_TILE_BYTES = 2_000
/** Tile servers cap tiles near this size however much a low zoom gathers. */
const MAX_TILE_BYTES = 500_000

/**
 * Bytes for one tile at `z`, from one sampled at the source's deepest zoom.
 * A tile a zoom out covers four times the ground; generalisation keeps it near
 * twice the size, which is what barrelman's city tiles measure.
 */
export function scaledTileBytes(sample: number, maxzoom: number, z: number): number {
  const grown = sample * SAMPLE_WEIGHT * 2 ** (maxzoom - z)
  return Math.min(MAX_TILE_BYTES, Math.max(MIN_TILE_BYTES, grown))
}

export interface RegionPlan {
  sources: OfflineSource[]
  files: string[]
  total: number
  estimatedBytes: number
  /** Estimated bytes per option id; a source or file two options share counts toward the first. */
  optionBytes: Record<string, number>
}

/** `sampledBytes` gives the measured size of one tile from a source, when known. */
export function planRegion(
  bounds: Bounds,
  options: OfflineLayerOption[],
  sampledBytes: (source: OfflineSource) => number | undefined = () => undefined,
): RegionPlan {
  const seen = new Set<string>()
  const sources: OfflineSource[] = []
  const files = new Set<string>()
  const optionBytes: Record<string, number> = {}
  let tiles = 0
  for (const option of options) {
    let bytes = 0
    const optionFiles = [...option.files]
    for (const source of option.sources) {
      if (seen.has(source.tiles[0])) continue
      seen.add(source.tiles[0])
      const zooms = countTilesByZoom(source, bounds)
      const count = zooms.reduce((sum, z) => sum + z.count, 0)
      if (!count) continue
      sources.push(source)
      optionFiles.push(...(source.files ?? []))
      tiles += count
      const sample = sampledBytes(source)
      for (const { z, count: n } of zooms) {
        bytes += n * (sample === undefined ? AVERAGE_TILE_BYTES[source.kind] : scaledTileBytes(sample, source.maxzoom, z))
      }
    }
    for (const file of optionFiles) {
      if (files.has(file)) continue
      files.add(file)
      bytes += AVERAGE_FILE_BYTES
    }
    optionBytes[option.id] = bytes
  }
  const estimatedBytes = Object.values(optionBytes).reduce((sum, b) => sum + b, 0)
  return { sources, files: [...files], total: tiles + files.size, estimatedBytes, optionBytes }
}

export function* regionUrls(region: Pick<OfflineRegion, 'bounds' | 'sources' | 'files'>): Generator<string> {
  yield* region.files
  for (const source of region.sources) yield* sourceTileUrls(source, region.bounds)
}
