/**
 * Reading barrelman's `tunnel_cuts` tiles straight off the wire. A cut lives
 * in its feature's properties, so only those are read: the tile is a few
 * kilobytes, and parsing it here keeps it out of the map's tile worker, where
 * it would wait behind the view's heavy detail tiles.
 */
import { parseCut, type ServedCut } from './tunnels'

type Properties = Record<string, string | number | boolean>

class Reader {
  at = 0
  constructor(readonly bytes: Uint8Array, readonly end = bytes.length) {}

  varint(): number {
    let value = 0
    for (let shift = 0; this.at < this.end; shift += 7) {
      const b = this.bytes[this.at++]
      value += (b & 0x7f) * 2 ** shift
      if (b < 0x80) return value
    }
    throw new Error('Truncated vector tile')
  }

  /** The next field's number and wire type, or null at the end. */
  field(): [number, number] | null {
    if (this.at >= this.end) return null
    const key = this.varint()
    return [Math.floor(key / 8), key & 7]
  }

  /** The bytes of a length-delimited field, as a reader of its own. */
  sub(): Reader {
    const length = this.varint()
    const sub = new Reader(this.bytes, this.at + length)
    sub.at = this.at
    this.at += length
    return sub
  }

  skip(wire: number) {
    if (wire === 0) this.varint()
    else if (wire === 1) this.at += 8
    else if (wire === 2) {
      const length = this.varint()
      this.at += length
    }
    else if (wire === 5) this.at += 4
    else throw new Error(`Unknown wire type ${wire}`)
  }

  string(): string {
    const { bytes, at, end } = this.sub()
    return new TextDecoder().decode(bytes.subarray(at, end))
  }
}

function value(r: Reader): string | number | boolean {
  let out: string | number | boolean = ''
  for (let f = r.field(); f; f = r.field()) {
    const [field, wire] = f
    const view = new DataView(r.bytes.buffer, r.bytes.byteOffset)
    if (field === 1) out = r.string()
    else if (field === 2) { out = view.getFloat32(r.at, true); r.at += 4 }
    else if (field === 3) { out = view.getFloat64(r.at, true); r.at += 8 }
    else if (field === 4 || field === 5) out = r.varint()
    else if (field === 6) { const n = r.varint(); out = n % 2 ? -(n + 1) / 2 : n / 2 }
    else if (field === 7) out = r.varint() !== 0
    else r.skip(wire)
  }
  return out
}

/** Each feature's properties in the named layer of a vector tile; none where the tile has no such layer. */
export function layerProperties(raw: ArrayBuffer | Uint8Array, name: string): Properties[] {
  const tile = new Reader(raw instanceof Uint8Array ? raw : new Uint8Array(raw))
  for (let f = tile.field(); f; f = tile.field()) {
    if (f[0] !== 3 || f[1] !== 2) { tile.skip(f[1]); continue }
    const layer = tile.sub()
    let layerName = ''
    const keys: string[] = []
    const values: Array<string | number | boolean> = []
    const features: Reader[] = []
    for (let g = layer.field(); g; g = layer.field()) {
      const [field, wire] = g
      if (field === 1) layerName = layer.string()
      else if (field === 2) features.push(layer.sub())
      else if (field === 3) keys.push(layer.string())
      else if (field === 4) values.push(value(layer.sub()))
      else layer.skip(wire)
    }
    if (layerName !== name) continue
    return features.map(feature => {
      const props: Properties = {}
      for (let g = feature.field(); g; g = feature.field()) {
        if (g[0] !== 2) { feature.skip(g[1]); continue }
        const tags = feature.sub()
        while (tags.at < tags.end) {
          const [k, v] = [tags.varint(), tags.varint()]
          props[keys[k]] = values[v]
        }
      }
      return props
    })
  }
  return []
}

/** The cuts in a `tunnel_cuts` tile. */
export function readCutTile(raw: ArrayBuffer | Uint8Array): ServedCut[] {
  return layerProperties(raw, 'tunnel_cuts').map(parseCut).filter((cut): cut is ServedCut => cut !== null)
}
