import { decodeBridge, type BakedMesh } from './mesh-file'
import type { DecodeRequest, DecodeResult } from './mesh-decoder'

const buffersOf = (mesh: BakedMesh) => [...new Set(Object.values(mesh).flatMap(v => (ArrayBuffer.isView(v) ? [v.buffer as ArrayBuffer] : [])))]

self.onmessage = ({ data: { id, buffer } }: MessageEvent<DecodeRequest>) => {
  let result: DecodeResult
  try {
    result = { id, mesh: decodeBridge(buffer) }
  } catch (error) {
    result = { id, error: String(error) }
  }
  ;(self as unknown as Worker).postMessage(result, 'mesh' in result ? buffersOf(result.mesh) : [])
}
