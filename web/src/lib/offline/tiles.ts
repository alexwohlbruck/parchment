import type { Bounds, OfflineSource } from '@/types/offline.types'

const MAX_LAT = 85.0511287798

export interface TileRange {
  z: number
  minX: number
  maxX: number
  minY: number
  maxY: number
}

const clampLat = (lat: number) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))

export function lngToTileX(lng: number, z: number): number {
  const n = 2 ** z
  return Math.min(n - 1, Math.max(0, Math.floor(((lng + 180) / 360) * n)))
}

export function latToTileY(lat: number, z: number): number {
  const n = 2 ** z
  const rad = (clampLat(lat) * Math.PI) / 180
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n)
  return Math.min(n - 1, Math.max(0, y))
}

export function intersectBounds(a: Bounds, b?: Bounds): Bounds | null {
  if (!b) return a
  const w = Math.max(a[0], b[0])
  const s = Math.max(a[1], b[1])
  const e = Math.min(a[2], b[2])
  const n = Math.min(a[3], b[3])
  return w < e && s < n ? [w, s, e, n] : null
}

export function tileRange(bounds: Bounds, z: number): TileRange {
  const [w, s, e, n] = bounds
  return {
    z,
    minX: lngToTileX(w, z),
    maxX: lngToTileX(e, z),
    minY: latToTileY(n, z),
    maxY: latToTileY(s, z),
  }
}

function sourceRanges(source: OfflineSource, bounds: Bounds): TileRange[] {
  const area = intersectBounds(bounds, source.bounds)
  if (!area) return []
  const ranges: TileRange[] = []
  for (let z = source.minzoom; z <= source.maxzoom; z++) ranges.push(tileRange(area, z))
  return ranges
}

const rangeSize = (r: TileRange) => (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1)

export function countTilesByZoom(source: OfflineSource, bounds: Bounds): { z: number; count: number }[] {
  return sourceRanges(source, bounds).map(r => ({ z: r.z, count: rangeSize(r) }))
}

/** Fill a tile template the way MapLibre does, including its subdomain pick. */
export function tileUrl(templates: string[], z: number, x: number, y: number): string {
  const template = templates[(x + y) % templates.length]
  return template
    .replace(/{z}/g, String(z))
    .replace(/{x}/g, String(x))
    .replace(/{y}/g, String(y))
    .replace(/{-y}/g, String(2 ** z - 1 - y))
}

export function* sourceTileUrls(source: OfflineSource, bounds: Bounds): Generator<string> {
  for (const r of sourceRanges(source, bounds)) {
    for (let x = r.minX; x <= r.maxX; x++) {
      for (let y = r.minY; y <= r.maxY; y++) yield tileUrl(source.tiles, r.z, x, y)
    }
  }
}

/** Templates with placeholders other than z/x/y can't be enumerated. */
export function isEnumerableTemplate(template: string): boolean {
  return !/{(?!z}|x}|y}|-y})[^}]*}/.test(template)
}

/** Approximate east-west width of the bounds at their centre, in kilometres. */
export function boundsWidthKm(bounds: Bounds): number {
  const midLat = (bounds[1] + bounds[3]) / 2
  return (bounds[2] - bounds[0]) * 111.32 * Math.cos((midLat * Math.PI) / 180)
}
