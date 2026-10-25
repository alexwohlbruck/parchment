import { decodeBridge, type BakedMesh, type MeshGeometry } from './mesh-file'
import { decodeDeckTile, splitDeckTile, type DeckTile } from './deck-tile'

export type DecodeRequest = { id: number; buffer: ArrayBuffer; tile?: boolean }
export type DecodeResult = { id: number; mesh: BakedMesh } | { id: number; tile: DeckTile } | { id: number; geometry: Array<MeshGeometry | null> } | { id: number; error: string }

/** A tile's decoded pieces, with the surfaces each stands on once they are read (null for a piece that came with its own). */
export type DecodedTile = Omit<DeckTile, 'geometry'> & { geometry: Promise<Array<MeshGeometry | null>> }

/** The worker decoding a mesh failed with its bytes: fetch the mesh again. */
export class DecoderLost extends Error {
  constructor() { super('Bridge mesh decoder failed') }
}

type Job = { resolve: (result: any) => void; reject: (error: Error) => void; geometry?: { resolve: (geometry: Array<MeshGeometry | null>) => void; reject: (error: Error) => void } }
type Decoder = { worker: Worker; jobs: Map<number, Job> }

/** Workers decoding at once: a view's meshes arrive together, and one worker would take them in turn. */
const POOL = Math.max(1, Math.min(3, Math.floor((globalThis.navigator?.hardwareConcurrency ?? 2) / 2)))

let pool: Decoder[] | null = null
let next = 0

function start(): Decoder | null {
  try {
    const decoder: Decoder = { worker: new Worker(new URL('./mesh-worker.ts', import.meta.url), { type: 'module' }), jobs: new Map() }
    decoder.worker.onmessage = ({ data }: MessageEvent<DecodeResult>) => {
      const job = decoder.jobs.get(data.id)
      if ('tile' in data && job?.geometry) return job.resolve(data.tile)
      decoder.jobs.delete(data.id)
      if ('error' in data) {
        job?.reject(new Error(data.error))
        job?.geometry?.reject(new Error(data.error))
      } else if ('geometry' in data) job?.geometry?.resolve(data.geometry)
      else job?.resolve('mesh' in data ? data.mesh : data.tile)
    }
    // A worker that fails gives up what it holds and leaves the pool; with none left, meshes decode here.
    decoder.worker.onerror = decoder.worker.onmessageerror = () => {
      pool = pool?.filter(d => d !== decoder) ?? null
      decoder.worker.terminate()
      for (const job of decoder.jobs.values()) {
        job.reject(new DecoderLost())
        job.geometry?.reject(new DecoderLost())
      }
      decoder.jobs.clear()
    }
    return decoder
  } catch {
    return null
  }
}

/** The least busy decoder, or null where workers are unavailable. */
function decoders(): Decoder[] {
  return (pool ??= Array.from({ length: POOL }, start).filter((d): d is Decoder => !!d))
}

function decoder(): Decoder | null {
  const all = decoders()
  return all.length ? all.reduce((a, b) => (b.jobs.size < a.jobs.size ? b : a)) : null
}

/** Decodes a mesh file off the main thread, or on it where workers are unavailable. */
export function decodeMesh(buffer: ArrayBuffer): Promise<BakedMesh> {
  return decode(() => buffer, false, () => decodeBridge(buffer))
}

/** Decodes a vector tile's deck payload off the main thread, its pieces shared between the decoders, or on it where workers are unavailable. */
export async function decodeTilePieces(payload: Uint8Array): Promise<DecodedTile> {
  const workers = decoders()
  if (!workers.length) {
    const { pieces, failed } = decodeDeckTile(payload)
    return { pieces, failed, geometry: Promise.resolve(pieces.map(() => null)) }
  }
  const parts = splitDeckTile(payload, workers.length).map(part => decodePart(part === payload ? part.slice() : part))
  const tiles = await Promise.all(parts.map(p => p.tile))
  const geometry = Promise.all(parts.map(p => p.geometry)).then(all => all.flat())
  geometry.catch(() => {})
  return { pieces: tiles.flatMap(t => t.pieces), failed: tiles.flatMap(t => t.failed), geometry }
}

/** One part of a tile on the least busy decoder: its meshes, then the surfaces they stand on. */
function decodePart(part: Uint8Array): { tile: Promise<DeckTile>; geometry: Promise<Array<MeshGeometry | null>> } {
  const target = decoder()!
  const id = next++
  let geometry!: Job['geometry']
  const surfaces = new Promise<Array<MeshGeometry | null>>((resolve, reject) => { geometry = { resolve, reject } })
  surfaces.catch(() => {})
  const tile = new Promise<DeckTile>((resolve, reject) => {
    target.jobs.set(id, { resolve, reject, geometry })
    try {
      const buffer = part.buffer as ArrayBuffer
      target.worker.postMessage({ id, buffer, tile: true } satisfies DecodeRequest, [buffer])
    } catch (error) {
      target.jobs.delete(id)
      reject(error)
      geometry!.reject(error as Error)
    }
  })
  return { tile, geometry: surfaces }
}

function decode<T>(bytes: () => ArrayBuffer, tile: boolean, here: () => T): Promise<T> {
  const target = decoder()
  if (!target) {
    try {
      return Promise.resolve(here())
    } catch (error) {
      return Promise.reject(error)
    }
  }
  const id = next++
  return new Promise((resolve, reject) => {
    target.jobs.set(id, { resolve, reject })
    try {
      const buffer = bytes()
      target.worker.postMessage({ id, buffer, tile } satisfies DecodeRequest, [buffer])
    } catch (error) {
      target.jobs.delete(id)
      reject(error)
    }
  })
}
