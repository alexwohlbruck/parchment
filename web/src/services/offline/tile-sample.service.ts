import { latToTileY, lngToTileX, tileUrl } from '@/lib/offline/tiles'
import type { Bounds, OfflineSource } from '@/types/offline.types'

const MAX_SAMPLES = 500
const samples = new Map<string, number>()

/** The URL of the deepest tile under the centre of `bounds`. */
export function sampleUrl(source: OfflineSource, bounds: Bounds): string {
  const z = source.maxzoom
  const lng = (bounds[0] + bounds[2]) / 2
  const lat = (bounds[1] + bounds[3]) / 2
  return tileUrl(source.tiles, z, lngToTileX(lng, z), latToTileY(lat, z))
}

/** Bytes of one real tile, usually already in the HTTP cache from drawing the map. */
export async function sampleTileBytes(url: string): Promise<number | undefined> {
  const known = samples.get(url)
  if (known !== undefined) return known
  try {
    const res = await fetch(url)
    const bytes = res.ok ? (await res.arrayBuffer()).byteLength : 0
    if (samples.size >= MAX_SAMPLES) samples.clear()
    samples.set(url, bytes)
    return bytes
  } catch {
    return undefined
  }
}
