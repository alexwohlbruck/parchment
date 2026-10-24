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

/** A deck payload's pieces: `BDT1`, a JSON header of each piece's deck mesh and length, then BRM meshes 4-byte aligned. */
export function decodeDeckTile(payload: Uint8Array): DeckPiece[] {
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  if (payload.byteLength < 8 || view.getUint32(0, true) !== MAGIC) throw new Error('Unsupported deck tile')
  const length = view.getUint32(4, true)
  const { decks, lengths } = JSON.parse(new TextDecoder().decode(payload.subarray(8, 8 + length))) as { decks: string[]; lengths: number[] }
  if (!Array.isArray(decks) || !Array.isArray(lengths) || decks.length !== lengths.length) throw new Error('Invalid deck tile header')
  let at = Math.ceil((8 + length) / 4) * 4
  return decks.map((file, i) => {
    const piece = payload.slice(at, at + lengths[i])
    at += Math.ceil(lengths[i] / 4) * 4
    return { file, mesh: decodeBridge(piece.buffer) }
  })
}
