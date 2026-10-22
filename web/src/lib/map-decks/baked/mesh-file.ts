import type { Chain, DeckSurface, Point, UnderWay } from '../decks'

export const BRIDGE_MESH_FILE = /^[0-9a-f]{64}\.brm$/
export const MATERIALS = ['surface', 'concrete', 'parapet', 'track', 'deck', 'lowRoad', 'lowMajor', 'lowHighway', 'lowPath', 'walkway', 'rail', 'white', 'yellow', 'green', 'red', 'route', 'routeCasing'] as const
const STREAMS = ['position', 'normal', 'color', 'low', 'bias', 'spread', 'ground', 'lift'] as const
export type BakedMesh = Record<typeof STREAMS[number], Float32Array> & {
  indices: Uint32Array
  origin: Point
  ranges: { paintFrom: number; railsFrom: number; routesFrom: number }
  under: UnderWay[]
  tracks: UnderWay[]
  stands: Array<{ chain: Chain; surface: DeckSurface }>
}

export function decodeBridge(buffer: ArrayBuffer): BakedMesh {
  if (buffer.byteLength < 12 || buffer.byteLength > 64 * 1024 * 1024) throw new Error('Invalid bridge mesh size')
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== 0x314d5242) throw new Error('Unsupported bridge mesh')
  const length = view.getUint32(4, true)
  const start = view.getUint32(8, true)
  if (length > 8 * 1024 * 1024 || start !== 12 + Math.ceil(length / 4) * 4 || start > buffer.byteLength) throw new Error('Invalid bridge mesh header')
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 12, length)))
  if (header.version !== 2 || !Array.isArray(header.lengths) || header.lengths.length !== STREAMS.length + 1 ||
      !header.lengths.every((n: number) => Number.isSafeInteger(n) && n >= 0) ||
      !Array.isArray(header.origin) || header.origin.length !== 2 || !header.origin.every(Number.isFinite) || !Array.isArray(header.stands)) throw new Error('Invalid bridge mesh metadata')
  const count = header.lengths[0] / 3
  const indices = header.lengths[8]
  const ranges = header.ranges
  if (!Number.isInteger(count) || indices % 3 || header.lengths.slice(1, 4).some((n: number) => n !== count * 3) ||
      header.lengths[4] !== count || header.lengths[5] !== count * 3 ||
      !ranges || ![ranges.paintFrom, ranges.railsFrom, ranges.routesFrom].every(n => Number.isInteger(n) && n >= 0 && n <= indices && n % 3 === 0) ||
      ranges.paintFrom > ranges.railsFrom || ranges.railsFrom > ranges.routesFrom || header.lengths[6] !== count || header.lengths[7] !== count ||
      start + header.lengths.reduce((a: number, b: number) => a + b * 4, 0) !== buffer.byteLength) throw new Error('Invalid bridge mesh streams')
  let offset = start
  const mesh = { origin: header.origin, ranges, stands: header.stands, under: header.under ?? [], tracks: header.tracks ?? [] } as BakedMesh
  STREAMS.forEach((name, i) => {
    mesh[name] = new Float32Array(buffer, offset, header.lengths[i])
    offset += header.lengths[i] * 4
  })
  mesh.indices = new Uint32Array(buffer, offset, indices)
  return mesh
}
