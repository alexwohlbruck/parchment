import { describe, expect, test } from 'vitest'
import { BUNDLE_ZOOM, bundleTiles, unpackBundle } from './mesh-bundle'

function pack(meshes: Array<{ name: string; bytes: number[] }>): ArrayBuffer {
  const size = 8 + meshes.reduce((n, m) => n + 36 + Math.ceil(m.bytes.length / 4) * 4, 0)
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  view.setUint32(0, 0x31545242, true)
  view.setUint32(4, meshes.length, true)
  let at = 8
  for (const { name, bytes } of meshes) {
    for (let i = 0; i < 32; i++) out[at + i] = parseInt(name.slice(i * 2, i * 2 + 2), 16)
    view.setUint32(at + 32, bytes.length, true)
    out.set(bytes, at + 36)
    at += 36 + Math.ceil(bytes.length / 4) * 4
  }
  return out.buffer
}

describe('mesh bundles', () => {
  test('each mesh comes out under its file name, in a buffer of its own', () => {
    const a = 'ab'.repeat(32), b = '0f'.repeat(32)
    const meshes = unpackBundle(pack([{ name: a, bytes: [1, 2, 3, 4, 5] }, { name: b, bytes: [9] }]))
    expect(meshes.map(m => m.file)).toEqual([`${a}.brm`, `${b}.brm`])
    expect([...new Uint8Array(meshes[0].buffer)]).toEqual([1, 2, 3, 4, 5])
    expect([...new Uint8Array(meshes[1].buffer)]).toEqual([9])
  })

  test('a truncated or foreign buffer is refused', () => {
    const whole = pack([{ name: 'ab'.repeat(32), bytes: [1, 2, 3] }])
    expect(() => unpackBundle(whole.slice(0, 30))).toThrow()
    expect(() => unpackBundle(new ArrayBuffer(8))).toThrow()
  })

  test('the tiles a view meets, and none for a view too far out', () => {
    const n = 2 ** BUNDLE_ZOOM
    expect(bundleTiles({ minX: 100.2 / n, minY: 200.9 / n, maxX: 101.1 / n, maxY: 201.5 / n })).toEqual(['100/200', '100/201', '101/200', '101/201'])
    expect(bundleTiles({ minX: 0, minY: 0, maxX: 10 / n, maxY: 10 / n })).toEqual([])
  })
})
