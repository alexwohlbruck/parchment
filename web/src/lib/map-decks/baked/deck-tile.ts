import { decodeBridge, type BakedMesh } from './mesh-file'

/** The MVT `Tile` field barrelman carries a detail tile's deck pieces in, when asked with `decks=1`. */
export const DECK_TILE_FIELD = 20
const MAGIC = 0x31544442

/** One deck's triangles that fall in a tile, with the stretch of its surface near it. */
export type DeckPiece = { file: string; mesh: BakedMesh }

/** The deck payload of a vector tile, or null when it carries none. Walks only the tile's top-level fields. */
export function deckField(raw: ArrayBuffer): Uint8Array | null {
  const bytes = new Uint8Array(raw)
  let at = 0
  const varint = () => {
    let value = 0
    for (let shift = 0; at < bytes.length; shift += 7) {
      const b = bytes[at++]
      value += (b & 0x7f) * 2 ** shift
      if (b < 0x80) return value
    }
    throw new Error('Truncated vector tile')
  }
  while (at < bytes.length) {
    const key = varint()
    const [field, wire] = [Math.floor(key / 8), key & 7]
    if (wire === 2) {
      const length = varint()
      if (field === DECK_TILE_FIELD) return bytes.subarray(at, at + length)
      at += length
    } else if (wire === 0) varint()
    else if (wire === 1) at += 8
    else if (wire === 5) at += 4
    else return null
  }
  return null
}

/** A tile's pieces, and the decks in it barrelman could not read. */
export type DeckTile = { pieces: DeckPiece[]; failed: string[] }

/** A deck payload's pieces: `BDT1`, a JSON header of each piece's deck mesh and length, then BRM meshes 4-byte aligned. */
export function decodeDeckTile(payload: Uint8Array): DeckTile {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  if (payload.byteLength < 8 || view.getUint32(0, true) !== MAGIC) throw new Error('Unsupported deck tile')
  const length = view.getUint32(4, true)
  const { decks, lengths, failed = [] } = JSON.parse(new TextDecoder().decode(payload.subarray(8, 8 + length))) as { decks: string[]; lengths: number[]; failed?: string[] }
  if (!Array.isArray(decks) || !Array.isArray(lengths) || decks.length !== lengths.length) throw new Error('Invalid deck tile header')
  let at = Math.ceil((8 + length) / 4) * 4
  const pieces = decks.map((file, i) => {
    const piece = payload.slice(at, at + lengths[i])
    at += Math.ceil(lengths[i] / 4) * 4
    return { file, mesh: decodeBridge(piece.buffer) }
  })
  return { pieces, failed }
}

/** A deck payload split into up to `parts` payloads of about equal size, each piece kept whole: decoded side by side. */
export function splitDeckTile(payload: Uint8Array, parts: number): Uint8Array[] {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  if (payload.byteLength < 8 || view.getUint32(0, true) !== MAGIC) throw new Error('Unsupported deck tile')
  const length = view.getUint32(4, true)
  const header = JSON.parse(new TextDecoder().decode(payload.subarray(8, 8 + length))) as { decks: string[]; lengths: number[]; failed?: string[] }
  if (parts <= 1 || header.decks.length <= 1) return [payload]
  const align = (n: number) => Math.ceil(n / 4) * 4
  let at = align(8 + length)
  const pieces = header.decks.map((file, i) => {
    const bytes = payload.subarray(at, at + header.lengths[i])
    at += align(header.lengths[i])
    return { file, bytes }
  })
  const total = pieces.reduce((n, p) => n + p.bytes.byteLength, 0)
  const groups: Array<typeof pieces> = [[]]
  let size = 0
  for (const piece of pieces) {
    if (size >= total / parts && groups.length < parts) { groups.push([]); size = 0 }
    groups.at(-1)!.push(piece)
    size += piece.bytes.byteLength
  }
  return groups.map((group, g) => {
    const text = new TextEncoder().encode(JSON.stringify({ decks: group.map(p => p.file), lengths: group.map(p => p.bytes.byteLength), ...(g === 0 && header.failed ? { failed: header.failed } : {}) }))
    const out = new Uint8Array(group.reduce((n, p) => align(n + p.bytes.byteLength), align(8 + text.length)))
    const v = new DataView(out.buffer)
    v.setUint32(0, MAGIC, true)
    v.setUint32(4, text.length, true)
    out.set(text, 8)
    group.reduce((offset, p) => { out.set(p.bytes, offset); return align(offset + p.bytes.byteLength) }, align(8 + text.length))
    return out
  })
}
