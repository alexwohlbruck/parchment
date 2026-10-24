import { decodeBridge, type BakedMesh } from './mesh-file'
import { decodeDeckTile } from './deck-tile'
import type { DecodeRequest, DecodeResult } from './mesh-decoder'

const buffersOf = (meshes: BakedMesh[]) => [...new Set(meshes.flatMap(mesh => Object.values(mesh).flatMap(v => (ArrayBuffer.isView(v) ? [v.buffer as ArrayBuffer] : []))))]

self.onmessage = ({ data: { id, buffer, tile } }: MessageEvent<DecodeRequest>) => {
  let result: DecodeResult
  try {
    result = tile ? { id, pieces: decodeDeckTile(new Uint8Array(buffer)) } : { id, mesh: decodeBridge(buffer) }
  } catch (error) {
    result = { id, error: String(error) }
  }
  const meshes = 'mesh' in result ? [result.mesh] : 'pieces' in result ? result.pieces.map(p => p.mesh) : []
  ;(self as unknown as Worker).postMessage(result, buffersOf(meshes))
}
