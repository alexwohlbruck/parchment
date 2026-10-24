import { decodeBridge, type BakedMesh } from './mesh-file'

export type DecodeRequest = { id: number; buffer: ArrayBuffer }
export type DecodeResult = { id: number; mesh: BakedMesh } | { id: number; error: string }

let worker: Worker | null | undefined
let next = 0
const waiting = new Map<number, { resolve: (mesh: BakedMesh) => void; reject: (error: Error) => void }>()

function decoder(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./mesh-worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<DecodeResult>) => {
      const job = waiting.get(data.id)
      waiting.delete(data.id)
      if ('error' in data) job?.reject(new Error(data.error))
      else job?.resolve(data.mesh)
    }
    // A worker that cannot start fails what it holds; later meshes decode here.
    worker.onerror = worker.onmessageerror = () => {
      worker = null
      for (const job of waiting.values()) job.reject(new Error('Bridge mesh decoder failed'))
      waiting.clear()
    }
  } catch {
    worker = null
  }
  return worker
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
    waiting.set(id, { resolve, reject })
    try {
      target.postMessage({ id, buffer } satisfies DecodeRequest, [buffer])
    } catch (error) {
      waiting.delete(id)
      reject(error)
    }
  })
}
