/**
 * Terrain tiles past the source's most detailed zoom, upsampled from it, in
 * the areas they are asked for. The ground keeps the shape it had; what the
 * finer grid adds is room for what is carved into it. Elsewhere the tile is
 * missing, and the map draws its parent.
 */
import { fetchHeights, sampleHeights, type Heights } from '@/lib/map-decks/ground'
import type { Bounds } from '@/lib/map-decks/decks'
import { FINE_TERRAIN_PROTOCOL, TERRAIN_TILES } from './terrain'

const SOURCE_MAXZOOM = 15
const SIZE = 512
const CACHE = 24

/** A tile's heights cut out of an ancestor `depth` zooms up, at `size` pixels a side. */
export function upsample(parent: Heights, depth: number, [x, y]: [number, number], size: number): Heights {
  const n = 2 ** depth
  const data = new Float32Array(size * size)
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) data[py * size + px] = sampleHeights(parent, (x + px / size) / n, (y + py / size) / n)
  return { size, data }
}

/** Heights packed as terrarium RGBA. */
export function encodeTerrarium({ size, data }: Heights): Uint8ClampedArray<ArrayBuffer> {
  const rgba = new Uint8ClampedArray(size * size * 4)
  for (let i = 0; i < data.length; i++) {
    const v = data[i] + 32768
    const whole = Math.floor(v)
    rgba[i * 4] = whole >> 8
    rgba[i * 4 + 1] = whole & 255
    rgba[i * 4 + 2] = Math.floor((v - whole) * 256)
    rgba[i * 4 + 3] = 255
  }
  return rgba
}

const missing = () => Object.assign(new Error('No terrain here'), { status: 404 })

export class FineTerrain {
  private parents = new Map<string, Promise<Heights | null>>()
  private load = fetchHeights(TERRAIN_TILES, 'terrarium')
  private areas: Bounds[] = []

  /** Serve finer tiles over these areas only, in mercator units. */
  focus(areas: Bounds[]) {
    this.areas = areas
  }

  /** The image for a `fine-terrain://z/x/y` tile: fetched as it is up to the source's zoom, upsampled past it. */
  async tile(url: string): Promise<ArrayBuffer | ImageBitmap> {
    const [z, x, y] = url.slice(FINE_TERRAIN_PROTOCOL.length + 3).split('/').map(Number)
    if (z <= SOURCE_MAXZOOM) {
      const res = await fetch(TERRAIN_TILES.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)))
      if (res.status === 404 || res.status === 204) throw missing()
      if (!res.ok) throw new Error(`terrain ${res.status}`)
      return res.arrayBuffer()
    }
    const n = 2 ** z
    if (!this.areas.some(a => a.maxX >= x / n && a.minX <= (x + 1) / n && a.maxY >= y / n && a.minY <= (y + 1) / n)) throw missing()
    for (let depth = z - SOURCE_MAXZOOM; z - depth >= SOURCE_MAXZOOM - 5; depth++) {
      const n = 2 ** depth
      const parent = await this.parent(z - depth, Math.floor(x / n), Math.floor(y / n))
      if (!parent) continue
      const image = new ImageData(encodeTerrarium(upsample(parent, depth, [x % n, y % n], SIZE)), SIZE, SIZE)
      return createImageBitmap(image, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
    }
    throw missing()
  }

  private parent(z: number, x: number, y: number): Promise<Heights | null> {
    const key = `${z}/${x}/${y}`
    let found = this.parents.get(key)
    if (found) this.parents.delete(key)
    else found = this.load(z, x, y).catch(() => null)
    this.parents.set(key, found)
    if (this.parents.size > CACHE) this.parents.delete(this.parents.keys().next().value!)
    return found
  }
}
