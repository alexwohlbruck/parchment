import { decodeBridge, type BakedMesh } from './mesh-file'

export type DecodeRequest = { id: number; buffer: ArrayBuffer }
export type DecodeResult = { id: number; mesh: BakedMesh } | { id: number; error: string }

/** The worker decoding a mesh failed with its bytes: fetch the mesh again. */
export class DecoderLost extends Error {
  constructor() { super('Bridge mesh decoder failed') }
}

type Job = { resolve: (mesh: BakedMesh) => void; reject: (error: Error) => void }
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
      decoder.jobs.delete(data.id)
      if ('error' in data) job?.reject(new Error(data.error))
      else job?.resolve(data.mesh)
    }
    // A worker that fails gives up what it holds and leaves the pool; with none left, meshes decode here.
    decoder.worker.onerror = decoder.worker.onmessageerror = () => {
      pool = pool?.filter(d => d !== decoder) ?? null
      decoder.worker.terminate()
      for (const job of decoder.jobs.values()) job.reject(new DecoderLost())
      decoder.jobs.clear()
    }
    return decoder
  } catch {
    return null
  }
}

/** The least busy decoder, or null where workers are unavailable. */
function decoder(): Decoder | null {
  pool ??= Array.from({ length: POOL }, start).filter((d): d is Decoder => !!d)
  if (!pool.length) return null
  return pool.reduce((a, b) => (b.jobs.size < a.jobs.size ? b : a))
}

/** Decodes a mesh file off the main thread, or on it where workers are unavailable. */
export function decodeMesh(buffer: ArrayBuffer): Promise<BakedMesh> {
  const target = decoder()
  if (!target) {
    try {
      return Promise.resolve(decodeBridge(buffer))
    } catch (error) {
      return Promise.reject(error)
    }
  }
  const id = next++
  return new Promise((resolve, reject) => {
    target.jobs.set(id, { resolve, reject })
    try {
      target.worker.postMessage({ id, buffer } satisfies DecodeRequest, [buffer])
    } catch (error) {
      target.jobs.delete(id)
      reject(error)
    }
  })
}
