import { DECK_TILE_FIELD } from '../deck-tile'

const file = `${'a'.repeat(64)}.brm`

/** A deck tile as barrelman writes it: BDT1, its JSON header, each piece 4-byte aligned. */
export function deckTile(pieces: Uint8Array[]): Uint8Array {
  const text = new TextEncoder().encode(JSON.stringify({ decks: pieces.map(() => file), lengths: pieces.map(p => p.byteLength) }))
  const align = (n: number) => Math.ceil(n / 4) * 4
  const out = new Uint8Array(pieces.reduce((n, p) => align(n + p.byteLength), align(8 + text.length)))
  new DataView(out.buffer).setUint32(0, 0x31544442, true)
  new DataView(out.buffer).setUint32(4, text.length, true)
  out.set(text, 8)
  pieces.reduce((at, p) => { out.set(p, at); return align(at + p.byteLength) }, align(8 + text.length))
  return out
}

/** An MVT with one layer field and, optionally, the deck field after it. */
export function vectorTile(payload?: Uint8Array): ArrayBuffer {
  const varint = (v: number) => { const b: number[] = []; while (v > 127) { b.push((v & 127) | 128); v >>>= 7 } b.push(v); return b }
  const layer = [0x1a, 3, 0x78, 1, 0]
  const field = payload ? [...varint((DECK_TILE_FIELD << 3) | 2), ...varint(payload.byteLength), ...payload] : []
  return Uint8Array.from([...layer, ...field]).buffer
}

