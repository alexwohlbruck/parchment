import { decodeBridge, type BakedMesh } from './mesh-file'
import { unpackBundle } from './mesh-bundle'
import type { DecodeRequest, DecodeResult } from './mesh-decoder'

const buffersOf = (mesh: BakedMesh) => [...new Set(Object.values(mesh).flatMap(v => ArrayBuffer.isView(v) ? [v.buffer as ArrayBuffer] : []))]

self.onmessage = ({ data: { id, buffer, file } }: MessageEvent<DecodeRequest>) => {
  let result: DecodeResult
  try {
    const files = file ? [{ file, buffer }] : unpackBundle(buffer)
    result = { id, meshes: files.map(f => ({ file: f.file, mesh: decodeBridge(f.buffer) })) }
  } catch (error) {
    result = { id, error: String(error) }
  }
  ;(self as unknown as Worker).postMessage(result, 'meshes' in result ? result.meshes.flatMap(m => buffersOf(m.mesh)) : [])
}
