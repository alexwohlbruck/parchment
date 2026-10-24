import type { Bounds } from '../decks'

/** Barrelman's BRT1: every deck mesh a tile meets, as u32 magic, u32 count, then per mesh a 32-byte sha256 name, u32 length and the BRM bytes padded to 4. */
const BUNDLE_MAGIC = 0x31545242
/** The one zoom bundles are cut at. */
export const BUNDLE_ZOOM = 14
/** More bundle tiles than this means the view is too far out for decks. */
const MAX_TILES = 16

const hex = (bytes: Uint8Array) => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')

/** Each mesh in a bundle as the file name it is stored under and a buffer of its own. */
export function unpackBundle(buffer: ArrayBuffer): Array<{ file: string; buffer: ArrayBuffer }> {
  const view = new DataView(buffer)
  if (buffer.byteLength < 8 || view.getUint32(0, true) !== BUNDLE_MAGIC) throw new Error('Unsupported bridge mesh bundle')
  const count = view.getUint32(4, true)
  const meshes: Array<{ file: string; buffer: ArrayBuffer }> = []
  let at = 8
  for (let i = 0; i < count; i++) {
    if (at + 36 > buffer.byteLength) throw new Error('Truncated bridge mesh bundle')
    const length = view.getUint32(at + 32, true)
    if (at + 36 + length > buffer.byteLength) throw new Error('Truncated bridge mesh bundle')
    meshes.push({ file: `${hex(new Uint8Array(buffer, at, 32))}.brm`, buffer: buffer.slice(at + 36, at + 36 + length) })
    at += 36 + Math.ceil(length / 4) * 4
  }
  return meshes
}

/** The bundle tiles, as `x/y` at BUNDLE_ZOOM, that mercator bounds meet; none when there would be too many. */
export function bundleTiles({ minX, minY, maxX, maxY }: Bounds): string[] {
  const n = 2 ** BUNDLE_ZOOM
  const clamp = (v: number) => Math.min(n - 1, Math.max(0, Math.floor(v * n)))
  const [x0, x1, y0, y1] = [clamp(minX), clamp(maxX), clamp(minY), clamp(maxY)]
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return []
  const tiles: string[] = []
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push(`${x}/${y}`)
  return tiles
}
