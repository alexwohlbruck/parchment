import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { BRIDGE_MESH_FILE, decodeBridge, decodeBridgeDeferred, readGeometry } from './mesh-file'

const fixture = (name = 'arched-bridge') => {
  const bytes = readFileSync(`src/lib/map-decks/baked/fixtures/${name}.brm`)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

describe('server-baked mesh contract', () => {
  test('expands the compact Barrelman fixture to the streams the float one holds', () => {
    const mesh = decodeBridge(fixture()), floats = decodeBridge(fixture('arched-bridge-v2'))
    expect(mesh.indices.length).toBe(276)
    expect(Math.max(...mesh.indices)).toBeLessThan(mesh.position.length / 3)
    expect(mesh.stands).toHaveLength(1)
    expect(mesh.ground.length).toBe(mesh.position.length / 3)
    const drawn = (m: typeof mesh, name: 'position' | 'normal' | 'color') => Array.from(m.indices).flatMap(i => Array.from(m[name].subarray(i * 3, i * 3 + 3)))
    drawn(mesh, 'position').forEach((v, k) => expect(Math.abs(v - drawn(floats, 'position')[k])).toBeLessThan(1.1e-10))
    expect(drawn(mesh, 'color')).toEqual(drawn(floats, 'color'))
    // Normals stay signed bytes, which the GPU reads normalised: byte / 127.
    expect(mesh.normal).toBeInstanceOf(Int8Array)
    drawn(mesh, 'normal').forEach((v, k) => expect(v / 127).toBeCloseTo(drawn(floats, 'normal')[k], 2))
  })
  test('reads a float mesh directly into GPU views without copying', () => {
    const buffer = fixture('arched-bridge-v2'), mesh = decodeBridge(buffer)
    expect(mesh.position.buffer).toBe(buffer)
    expect(mesh.indices.buffer).toBe(buffer)
  })
  test('still reads a mesh baked before lifts, which draws exaggerated as a whole', () => {
    const v2 = new Uint8Array(fixture('arched-bridge-v2')), view = new DataView(v2.buffer)
    const start = view.getUint32(8, true)
    const header = JSON.parse(new TextDecoder().decode(v2.subarray(12, 12 + view.getUint32(4, true))))
    const offsets = header.lengths.reduce((at: number[], n: number) => [...at, at[at.length - 1] + n * 4], [start])
    const old = new TextEncoder().encode(JSON.stringify({ ...header, version: 1, lengths: [...header.lengths.slice(0, 7), header.lengths[8]] }))
    const head = 12 + Math.ceil(old.length / 4) * 4
    const out = new Uint8Array(head + offsets[7] - start + offsets[9] - offsets[8])
    const ov = new DataView(out.buffer)
    ov.setUint32(0, 0x314d5242, true); ov.setUint32(4, old.length, true); ov.setUint32(8, head, true)
    out.set(old, 12)
    out.set(v2.subarray(start, offsets[7]), head)
    out.set(v2.subarray(offsets[8], offsets[9]), head + offsets[7] - start)
    const mesh = decodeBridge(out.buffer)
    expect(mesh.lift.length).toBe(0)
    expect(mesh.indices.length).toBe(276)
  })
  test('rejects truncated buffers and incompatible headers before GPU upload', () => {
    const buffer = fixture()
    const indexAt = buffer.byteLength - 4
    const outOfRange = buffer.slice(0)
    new DataView(outOfRange).setInt32(indexAt, 1e6, true)
    expect(() => decodeBridge(outOfRange)).toThrow('indices')
    expect(() => decodeBridge(buffer.slice(0, -4))).toThrow()
    expect(() => decodeBridge(buffer.slice(0, 8))).toThrow()
    new DataView(buffer).setUint32(0, 0, true)
    expect(() => decodeBridge(buffer)).toThrow('Unsupported bridge mesh')
  })
  test('accepts only content-addressed mesh filenames', () => {
    expect(BRIDGE_MESH_FILE.test(`${'a'.repeat(64)}.brm`)).toBe(true)
    expect(BRIDGE_MESH_FILE.test('../secret')).toBe(false)
    expect(BRIDGE_MESH_FILE.test(`${'a'.repeat(64)}.brm/extra`)).toBe(false)
  })
  test('leaves the surfaces unread for later, and reads them to the same as at once', () => {
    const whole = decodeBridge(fixture())
    const { mesh, geometry } = decodeBridgeDeferred(fixture())
    expect(mesh.stands).toEqual([])
    expect(Array.from(mesh.indices)).toEqual(Array.from(whole.indices))
    expect(readGeometry(geometry!)).toEqual({ stands: whole.stands, under: whole.under, tracks: whole.tracks })
  })
})
