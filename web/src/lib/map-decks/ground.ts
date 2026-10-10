/**
 * The ground under bridges, read from the terrain's elevation tiles at one
 * fixed zoom. The drawn surface varies with the camera (a pitched view loads
 * coarser terrain farther from the eye); one zoom gives a point the same height
 * however the map looks at it. Heights are true metres, before exaggeration.
 */
import type { Point } from './decks'

export type Heights = { size: number; data: Float32Array }

/** Fetches one tile's heights; null where the source has no tile there. */
export type HeightsLoader = (z: number, x: number, y: number) => Promise<Heights | null>

/** Metres from a DEM tile's pixels: `terrarium`, or `mapbox` (Terrain-RGB). */
export function decodeHeights(rgba: ArrayLike<number>, size: number, encoding: 'terrarium' | 'mapbox' = 'terrarium'): Heights {
  const data = new Float32Array(size * size)
  for (let i = 0; i < data.length; i++) {
    const [r, g, b] = [rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]
    data[i] = encoding === 'mapbox' ? -10000 + (r * 65536 + g * 256 + b) * 0.1 : r * 256 + g + b / 256 - 32768
  }
  return { size, data }
}

/**
 * Bilinear height at a position within a tile, `u` and `v` from 0 to 1, with
 * each pixel's value at its top-left corner as MapLibre's terrain reads it.
 */
export function sampleHeights({ size, data }: Heights, u: number, v: number): number {
  const fx = Math.min(size - 1, Math.max(0, u * size))
  const fy = Math.min(size - 1, Math.max(0, v * size))
  const [x0, y0] = [Math.floor(fx), Math.floor(fy)]
  const [x1, y1] = [Math.min(size - 1, x0 + 1), Math.min(size - 1, y0 + 1)]
  const [tx, ty] = [fx - x0, fy - y0]
  const top = data[y0 * size + x0] * (1 - tx) + data[y0 * size + x1] * tx
  const bottom = data[y1 * size + x0] * (1 - tx) + data[y1 * size + x1] * tx
  return top * (1 - ty) + bottom * ty
}

type Entry = Heights | 'missing' | 'loading'

export class GroundSampler {
  private tiles = new Map<string, Entry>()

  /**
   * `zoom` is the zoom read everywhere; where the source has no tile there, its
   * parents are tried down to `minZoom`. `onLoad` runs as each tile arrives.
   */
  constructor(
    private load: HeightsLoader,
    private options: { zoom: number; minZoom?: number; capacity?: number; onLoad?: () => void },
  ) {}

  /** Height at a mercator point: null while its tile loads, NaN where the source has none. */
  at([x, y]: Point): number | null {
    for (let z = this.options.zoom; z >= (this.options.minZoom ?? 0); z--) {
      const n = 2 ** z
      const [tx, ty] = [Math.floor(x * n), Math.floor(y * n)]
      const entry = this.entry(z, tx, ty)
      if (entry === 'loading') return null
      if (entry !== 'missing') return sampleHeights(entry, x * n - tx, y * n - ty)
    }
    return NaN
  }

  private entry(z: number, x: number, y: number): Entry {
    const key = `${z}/${x}/${y}`
    const entry = this.tiles.get(key)
    if (entry) {
      // Most recently used last, so the oldest is the first evicted.
      this.tiles.delete(key)
      this.tiles.set(key, entry)
      return entry
    }
    this.tiles.set(key, 'loading')
    this.load(z, x, y).then(
      heights => this.settle(key, heights ?? 'missing'),
      () => this.tiles.delete(key),
    )
    return 'loading'
  }

  private settle(key: string, entry: Entry) {
    this.tiles.set(key, entry)
    const capacity = this.options.capacity ?? 16
    for (const [k, e] of this.tiles) {
      if (this.tiles.size <= capacity) break
      if (k !== key && e !== 'loading') this.tiles.delete(k)
    }
    this.options.onLoad?.()
  }
}

/** A loader for a raster-dem source's tile URL template. */
export function fetchHeights(template: string, encoding: 'terrarium' | 'mapbox'): HeightsLoader {
  return async (z, x, y) => {
    const res = await fetch(template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)))
    if (res.status === 404 || res.status === 204) return null
    if (!res.ok) throw new Error(`terrain ${res.status}`)
    const image = await createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
    const { width, height } = image
    const context = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true })!
    context.drawImage(image, 0, 0)
    image.close()
    return decodeHeights(context.getImageData(0, 0, width, height).data, width, encoding)
  }
}
