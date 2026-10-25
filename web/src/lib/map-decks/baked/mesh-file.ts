import type { Chain, DeckSurface, Point, UnderWay } from '../decks'

export const BRIDGE_MESH_FILE = /^[0-9a-f]{64}\.brm$/
export const MATERIALS = ['surface', 'concrete', 'parapet', 'track', 'deck', 'lowRoad', 'lowMajor', 'lowHighway', 'lowPath', 'walkway', 'rail', 'white', 'yellow', 'green', 'red', 'route', 'routeCasing', 'travelled', 'travelledCasing'] as const
const STREAMS = ['position', 'normal', 'color', 'low', 'bias', 'spread', 'ground', 'lift'] as const
/** Compact meshes keep normals as signed bytes and palette slots as bytes: the GPU reads them as they are. */
export type BakedMesh = Record<Exclude<typeof STREAMS[number], 'normal' | 'color' | 'low'>, Float32Array> & {
  normal: Float32Array | Int8Array
  color: Float32Array | Uint8Array
  low: Float32Array | Uint8Array
  indices: Uint32Array
  origin: Point
  ranges: { paintFrom: number; railsFrom: number; routesFrom: number }
  under: UnderWay[]
  tracks: UnderWay[]
  stands: Array<{ chain: Chain; surface: DeckSurface }>
}

/** Bytes a decoded mesh takes once uploaded. */
export const gpuBytes = (mesh: BakedMesh) => [...STREAMS.map(name => mesh[name]), mesh.indices].reduce((n, a) => n + a.byteLength, 0)

/** Version 3 stores each stream compactly; `delta` is the stride of a difference-coded stream, `scale` turns its integers back into values. */
type Layout = { type: Int32ArrayConstructor | Uint32ArrayConstructor | Int8ArrayConstructor | Uint8ArrayConstructor | Float32ArrayConstructor; delta?: number; quantum?: boolean; scale?: number; raw?: boolean }
const COMPACT: Layout[] = [
  { type: Int32Array, delta: 3, quantum: true }, { type: Int8Array, raw: true }, { type: Uint8Array, raw: true }, { type: Uint8Array, raw: true },
  { type: Float32Array }, { type: Float32Array }, { type: Int32Array, delta: 1, quantum: true }, { type: Int32Array, delta: 1, quantum: true },
]
const align = (n: number) => Math.ceil(n / 4) * 4

/** The surfaces a mesh's decks stand on and the ways under them: what objects and routes read, not what is drawn. */
export type MeshGeometry = Pick<BakedMesh, 'stands' | 'under' | 'tracks'>

/** A header's small part (version, quantum, origin, ranges, lengths) and the JSON of its surfaces, written between them; null if laid out otherwise. */
function splitHeader(text: string): { head: any; geometry: string } | null {
  const from = text.indexOf(',"stands":'), to = text.lastIndexOf(',"lengths":')
  if (from < 0 || to < from) return null
  try {
    const head = JSON.parse(text.slice(0, from) + text.slice(to))
    return Array.isArray(head.lengths) && head.ranges && head.origin && head.version ? { head, geometry: `{${text.slice(from + 1, to)}}` } : null
  } catch {
    return null
  }
}

/** A mesh's surfaces from the JSON `decodeBridge` left unread. */
export function readGeometry(text: string): MeshGeometry {
  const { stands, under = [], tracks = [] } = JSON.parse(text)
  if (!Array.isArray(stands) || !Array.isArray(under) || !Array.isArray(tracks)) throw new Error('Invalid bridge mesh metadata')
  return { stands, under, tracks }
}

export function decodeBridge(buffer: ArrayBuffer): BakedMesh {
  return decodeBridgeDeferred(buffer, false).mesh
}

/**
 * A mesh's streams, ready to draw; with `defer`, its surfaces are left as JSON (`geometry`) for later, the mesh holding
 * none until then. Parsing them is about two thirds of the work, and nothing drawn needs them.
 */
export function decodeBridgeDeferred(buffer: ArrayBuffer, defer = true): { mesh: BakedMesh; geometry: string | null } {
  if (buffer.byteLength < 12 || buffer.byteLength > 64 * 1024 * 1024) throw new Error('Invalid bridge mesh size')
  const view = new DataView(buffer)
  if (view.getUint32(0, true) !== 0x314d5242) throw new Error('Unsupported bridge mesh')
  const length = view.getUint32(4, true)
  const start = view.getUint32(8, true)
  if (length > 8 * 1024 * 1024 || start !== 12 + Math.ceil(length / 4) * 4 || start > buffer.byteLength) throw new Error('Invalid bridge mesh header')
  const text = new TextDecoder().decode(new Uint8Array(buffer, 12, length))
  const split = defer ? splitHeader(text) : null
  const header = split?.head ?? JSON.parse(text)
  // Version 1 has no lift stream: such a mesh is drawn exaggerated as a whole.
  const streams = header.version === 1 ? STREAMS.length - 1 : STREAMS.length
  const compact = header.version === 3
  if (![1, 2, 3].includes(header.version) || !Array.isArray(header.lengths) || header.lengths.length !== streams + 1 ||
      !header.lengths.every((n: number) => Number.isSafeInteger(n) && n >= 0) || (compact && !(header.quantum > 0)) ||
      !Array.isArray(header.origin) || header.origin.length !== 2 || !header.origin.every(Number.isFinite) || (!split && !Array.isArray(header.stands))) throw new Error('Invalid bridge mesh metadata')
  const count = header.lengths[0] / 3
  const indices = header.lengths[streams]
  const ranges = header.ranges
  const layouts: Layout[] = compact ? [...COMPACT, { type: Int32Array, delta: 1 }] : [...header.lengths.slice(0, -1).map(() => ({ type: Float32Array })), { type: Uint32Array }]
  const end = header.lengths.reduce((at: number, n: number, i: number) => compact ? align(at + n * layouts[i].type.BYTES_PER_ELEMENT) : at + n * 4, start)
  if (!Number.isInteger(count) || indices % 3 || header.lengths.slice(1, 4).some((n: number) => n !== count * 3) ||
      header.lengths[4] !== count || header.lengths[5] !== count * 3 ||
      !ranges || ![ranges.paintFrom, ranges.railsFrom, ranges.routesFrom].every(n => Number.isInteger(n) && n >= 0 && n <= indices && n % 3 === 0) ||
      ranges.paintFrom > ranges.railsFrom || ranges.railsFrom > ranges.routesFrom || header.lengths[6] !== count || (streams > 7 && header.lengths[7] !== count) ||
      end !== buffer.byteLength) throw new Error('Invalid bridge mesh streams')
  let offset = start
  const stream = (layout: Layout, n: number) => {
    const raw = new layout.type(buffer, offset, n)
    offset = compact ? align(offset + raw.byteLength) : offset + raw.byteLength
    return raw
  }
  const mesh = { origin: header.origin, ranges, stands: header.stands ?? [], under: header.under ?? [], tracks: header.tracks ?? [] } as BakedMesh
  STREAMS.forEach((name, i) => {
    const raw = i < streams ? stream(layouts[i], header.lengths[i]) : new Float32Array(0)
    ;(mesh as Record<string, unknown>)[name] = compact && !layouts[i].raw ? expand(raw, layouts[i], header.quantum) : raw
  })
  const index = stream(layouts[streams], indices)
  mesh.indices = compact ? summed(index as Int32Array) : index as Uint32Array
  if (compact) for (let i = 0; i < mesh.indices.length; i++) if (mesh.indices[i] >= count) throw new Error('Invalid bridge mesh indices')
  return { mesh, geometry: split?.geometry ?? null }
}

function summed(deltas: Int32Array): Uint32Array {
  const out = new Uint32Array(deltas.length)
  for (let i = 0, at = 0; i < deltas.length; i++) out[i] = at += deltas[i]
  return out
}

function expand(raw: ArrayLike<number>, { type, delta = 0, quantum, scale = 1 }: Layout, step: number): Float32Array {
  if (type === Float32Array) return raw as Float32Array
  const factor = quantum ? step : scale
  const out = new Float32Array(raw.length)
  const n = raw.length
  if (!delta) {
    for (let i = 0; i < n; i++) out[i] = raw[i] * factor
  } else if (delta === 1) {
    for (let i = 0, a = 0; i < n; i++) out[i] = (a += raw[i]) * factor
  } else if (delta === 3) {
    for (let i = 0, a = 0, b = 0, c = 0; i < n; i += 3) {
      out[i] = (a += raw[i]) * factor
      out[i + 1] = (b += raw[i + 1]) * factor
      out[i + 2] = (c += raw[i + 2]) * factor
    }
  } else {
    const sums = new Float64Array(delta)
    for (let i = 0; i < n; i++) out[i] = (sums[i % delta] += raw[i]) * factor
  }
  return out
}
