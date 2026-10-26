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

async function served(image: Promise<ImageBitmap | null>): Promise<ImageBitmap> {
  const found = await image
  if (!found) throw missing()
  return found
}

/** Recently read source tiles' heights, shared by the finer tiles cut from them. */
export class ParentHeights {
  private parents = new Map<string, Promise<Heights | null>>()
  private load = fetchHeights(TERRAIN_TILES, 'terrarium')

  get(z: number, x: number, y: number): Promise<Heights | null> {
    const key = `${z}/${x}/${y}`
    let found = this.parents.get(key)
    if (found) this.parents.delete(key)
    else found = this.load(z, x, y).catch(() => null)
    this.parents.set(key, found)
    if (this.parents.size > CACHE) this.parents.delete(this.parents.keys().next().value!)
    return found
  }
}

/** A tile past the source's zoom, upsampled from its nearest ancestor with data; null where none has. */
export async function upsampledTile(z: number, x: number, y: number, parents: ParentHeights): Promise<ImageBitmap | null> {
  for (let depth = z - SOURCE_MAXZOOM; z - depth >= SOURCE_MAXZOOM - 5; depth++) {
    const n = 2 ** depth
    const parent = await parents.get(z - depth, Math.floor(x / n), Math.floor(y / n))
    if (!parent) continue
    const image = new ImageData(encodeTerrarium(upsample(parent, depth, [x % n, y % n], SIZE)), SIZE, SIZE)
    return createImageBitmap(image, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })
  }
  return null
}

type Job = { resolve: (data: any) => void; fallback: () => Promise<any> }
type Upsampler = { worker: Worker; jobs: Map<number, Job>; alive: boolean }

/** What a held tile waits on: the areas carved there, or null while the map tiles that say so are loading. */
export type HeldAreas = () => Bounds[] | null

/** Milliseconds a finer tile outside every area waits to learn whether it is carved before it is turned away, asking again every `RECHECK_MS`. */
const HOLD_MS = 10000
const RECHECK_MS = 100

export class FineTerrain {
  private parents: ParentHeights | null = null
  private upsampler: Upsampler | null | undefined
  private next = 0
  private owners = new Map<string, Bounds[]>()
  private areas: Bounds[] = []
  private held: HeldAreas | null = null
  private waiting = new Set<() => void>()

  /** Serve finer tiles over these areas, in mercator units, as asked by one owner; another's areas are kept. */
  focus(areas: Bounds[], owner = '') {
    this.owners.set(owner, areas)
    this.areas = [...this.owners.values()].flat()
    this.release()
  }

  /**
   * Hold finer tiles outside every area until `areas` can say whether they are
   * carved, so they arrive finer the first time rather than being reloaded; null stops holding.
   */
  hold(areas: HeldAreas | null) {
    this.held = areas
    this.release()
  }

  /** Have the held tiles ask again. */
  release() {
    for (const wake of this.waiting) wake()
    this.waiting.clear()
  }

  /** Heights of a source tile, read off the main thread where it can be. */
  heights(z: number, x: number, y: number): Promise<Heights | null> {
    return this.ask({ heights: [z, x, y] }, () => this.parentHeights().get(z, x, y))
  }

  /** The image for a `fine-terrain://z/x/y` tile: fetched as it is up to the source's zoom, upsampled past it, off the main thread where it can be. */
  async tile(url: string): Promise<ArrayBuffer | ImageBitmap> {
    const [z, x, y] = url.slice(FINE_TERRAIN_PROTOCOL.length + 3).split('/').map(Number)
    this.start()
    if (z <= SOURCE_MAXZOOM) {
      const res = await fetch(TERRAIN_TILES.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)), { priority: 'high' })
      if (res.status === 404 || res.status === 204) throw missing()
      if (!res.ok) throw new Error(`terrain ${res.status}`)
      return res.arrayBuffer()
    }
    const n = 2 ** z
    const meets = (areas: Bounds[]) => areas.some(a => a.maxX >= x / n && a.minX <= (x + 1) / n && a.maxY >= y / n && a.minY <= (y + 1) / n)
    if (meets(this.areas)) return served(this.upsample(z, x, y))
    if (!this.held) throw missing()
    // Cut while it waits, so a tile a cut reaches is ready the moment the cut is known.
    const ahead = this.upsample(z, x, y)
    const deadline = performance.now() + HOLD_MS
    for (;;) {
      const known = this.held?.()
      if (meets(this.areas) || (known && meets(known))) return served(ahead)
      if (known || !this.held || performance.now() >= deadline) break
      await new Promise<void>(wake => {
        const timer = setTimeout(wake, Math.min(RECHECK_MS, deadline - performance.now()))
        this.waiting.add(() => { clearTimeout(timer); wake() })
      })
    }
    void ahead.then(image => image?.close(), () => {})
    throw missing()
  }

  /** Started with the terrain, so it is ready by the time something is cut into it. */
  private start() {
    if (this.upsampler === undefined) this.upsampler = startUpsampler()
  }

  private parentHeights() {
    return (this.parents ??= new ParentHeights())
  }

  private upsample(z: number, x: number, y: number): Promise<ImageBitmap | null> {
    return this.ask({ tile: [z, x, y] }, () => upsampledTile(z, x, y, this.parentHeights()))
  }

  /** A job for the worker, or done here where it cannot be. */
  private ask<T>(job: object, here: () => Promise<T>): Promise<T> {
    this.start()
    const upsampler = this.upsampler
    if (!upsampler?.alive) return here()
    const id = this.next++
    return new Promise(resolve => {
      upsampler.jobs.set(id, { resolve, fallback: here })
      upsampler.worker.postMessage({ id, ...job })
    })
  }
}

/** A worker cutting finer tiles; null where workers are unavailable. One that fails hands what it held to the main thread, and so does every later job. */
function startUpsampler(): Upsampler | null {
  try {
    const upsampler: Upsampler = { worker: new Worker(new URL('./fine-terrain.worker.ts', import.meta.url), { type: 'module' }), jobs: new Map(), alive: true }
    upsampler.worker.onmessage = ({ data }: MessageEvent<{ id: number; result: unknown }>) => {
      upsampler.jobs.get(data.id)?.resolve(data.result)
      upsampler.jobs.delete(data.id)
    }
    upsampler.worker.onerror = upsampler.worker.onmessageerror = () => {
      upsampler.alive = false
      for (const { fallback, resolve } of upsampler.jobs.values()) void fallback().then(resolve, () => resolve(null))
      upsampler.jobs.clear()
      upsampler.worker.terminate()
    }
    return upsampler
  } catch {
    return null
  }
}
