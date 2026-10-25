import { decodeBridge, readGeometry, type BakedMesh } from './mesh-file'
import { decodeDeckTile } from './deck-tile'
import type { DecodeRequest, DecodeResult } from './mesh-decoder'

const buffersOf = (meshes: BakedMesh[]) => [...new Set(meshes.flatMap(mesh => Object.values(mesh).flatMap(v => (ArrayBuffer.isView(v) ? [v.buffer as ArrayBuffer] : []))))]
const post = (result: DecodeResult, transfer: ArrayBuffer[] = []) => (self as unknown as Worker).postMessage(result, transfer)

self.onmessage = ({ data: { id, buffer, tile } }: MessageEvent<DecodeRequest>) => {
  try {
    if (!tile) {
      const mesh = decodeBridge(buffer)
      return post({ id, mesh }, buffersOf([mesh]))
    }
    // A tile's meshes go back first, to be drawn; the surfaces objects stand on follow.
    const { geometry = [], ...decoded } = decodeDeckTile(new Uint8Array(buffer), true)
    post({ id, tile: decoded }, buffersOf(decoded.pieces.map(p => p.mesh)))
    post({ id, geometry: geometry.map(text => (text === null ? null : readGeometry(text))) })
  } catch (error) {
    post({ id, error: String(error) })
  }
}
