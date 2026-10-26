import { describe, expect, test } from 'vitest'
import { layerProperties, readCutTile } from './cut-tile'

const varint = (n: number): number[] => {
  const out: number[] = []
  for (; n >= 0x80; n = Math.floor(n / 0x80)) out.push((n % 0x80) | 0x80)
  return [...out, n]
}
const field = (n: number, wire: number) => varint(n * 8 + wire)
const bytes = (n: number, b: number[]) => [...field(n, 2), ...varint(b.length), ...b]
const text = (n: number, s: string) => bytes(n, [...new TextEncoder().encode(s)])
const double = (v: number) => [...field(3, 1), ...new Uint8Array(Float64Array.of(v).buffer)]

/** A layer whose features carry these properties, with a point geometry each. */
function layer(name: string, features: Array<Record<string, string | number>>): number[] {
  const keys = [...new Set(features.flatMap(Object.keys))]
  const values: Array<string | number> = []
  const index = (v: string | number) => (values.includes(v) ? values.indexOf(v) : values.push(v) - 1)
  const encoded = features.map(props => {
    const tags = Object.entries(props).flatMap(([k, v]) => [keys.indexOf(k), index(v)])
    return bytes(2, [...bytes(2, tags.flatMap(varint)), ...field(3, 0), 1, ...bytes(4, [9, 2, 2])])
  })
  return [
    ...text(1, name),
    ...encoded.flat(),
    ...keys.flatMap(k => text(3, k)),
    ...values.flatMap(v => bytes(4, typeof v === 'string' ? text(1, v) : Number.isInteger(v) ? [...field(4, 0), ...varint(v)] : double(v))),
    ...field(15, 0), 2,
  ]
}
const tile = (...layers: number[][]) => new Uint8Array(layers.flatMap(l => bytes(3, l)))

describe('layerProperties', () => {
  test('reads each feature of the named layer, skipping the others', () => {
    const raw = tile(layer('woods', [{ kind: 'oak' }]), layer('tunnel_cuts', [{ id: 'a', at: 3, crown: 12.5 }, { id: 'b', at: 7, crown: 3.25 }]))
    expect(layerProperties(raw, 'tunnel_cuts')).toEqual([{ id: 'a', at: 3, crown: 12.5 }, { id: 'b', at: 7, crown: 3.25 }])
  })

  test('is empty where the tile has no such layer', () => {
    expect(layerProperties(tile(layer('woods', [{ kind: 'oak' }])), 'tunnel_cuts')).toEqual([])
    expect(layerProperties(new Uint8Array(), 'tunnel_cuts')).toEqual([])
  })
})

describe('readCutTile', () => {
  test('takes the cuts that hold together and leaves out the rest', () => {
    const cut = {
      id: 'road:1,2', kind: 'road', at: 2, open: 1, left_edge: 3.5, right_edge: 4,
      line: '-808340000,352250000;-1000,0;-1000,0;-1000,0', floor: '2000,1990,1980,1980', wall_left: '2000,2010,2034,2034', wall_right: '2000,2012,2034,2034',
      crown: 203.4, headroom: 4.6, base: 198,
    }
    const cuts = readCutTile(tile(layer('tunnel_cuts', [cut, { ...cut, id: 'broken', floor: '1,2' }])))
    expect(cuts.map(c => c.key)).toEqual(['road:1,2'])
    expect(cuts[0].cut.floor).toEqual([200, 199, 198, 198])
  })
})
