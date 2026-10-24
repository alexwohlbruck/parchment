import { decodeBridge, type BakedMesh } from './mesh-file'
import { unpackBundle } from './mesh-bundle'

/** A buffer to decode: one mesh when `file` names it, else a whole bundle. */
export type DecodeRequest = { id: number; buffer: ArrayBuffer; file?: string }
export type DecodeResult = { id: number; meshes: Array<{ file: string; mesh: BakedMesh }> } | { id: number; error: string }

let worker: Worker | null | undefined
let next = 0
const waiting = new Map<number, { resolve: (meshes: Array<{ file: string; mesh: BakedMesh }>) => void; reject: (error: Error) => void }>()

function decoder(): Worker | null {
  if (worker !== undefined) return worker
  try {
    worker = new Worker(new URL('./mesh-worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = ({ data }: MessageEvent<DecodeResult>) => {
      const job = waiting.get(data.id)
      waiting.delete(data.id)
      if ('error' in data) job?.reject(new Error(data.error))
      else job?.resolve(data.meshes)
    }
  } catch {
    worker = null
  }
  return worker
}

/** Decodes a mesh file or a bundle off the main thread, or on it where workers are unavailable. */
export function decodeMeshes(buffer: ArrayBuffer, file?: string): Promise<Array<{ file: string; mesh: BakedMesh }>> {
  const target = decoder()
  if (!target) {
    try {
      return Promise.resolve((file ? [{ file, buffer }] : unpackBundle(buffer)).map(f => ({ file: f.file, mesh: decodeBridge(f.buffer) })))
    } catch (error) {
      return Promise.reject(error)
    }
  }
  const id = next++
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    target.postMessage({ id, buffer, file } satisfies DecodeRequest, [buffer])
  })
}
