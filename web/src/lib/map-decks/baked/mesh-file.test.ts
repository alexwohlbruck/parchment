import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { BRIDGE_MESH_FILE, decodeBridge } from './mesh-file'

const fixture = () => {
  const bytes = readFileSync('src/lib/map-decks/baked/fixtures/arched-bridge.brm')
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

describe('server-baked mesh contract', () => {
  test('reads the Barrelman fixture directly into GPU views without copying', () => {
    const buffer = fixture(), mesh = decodeBridge(buffer)
    expect(mesh.position.buffer).toBe(buffer)
    expect(mesh.indices.buffer).toBe(buffer)
    expect(mesh.indices.length).toBe(276)
    expect(Math.max(...mesh.indices)).toBeLessThan(mesh.position.length / 3)
    expect(mesh.stands).toHaveLength(1)
    expect(mesh.ground.length).toBe(mesh.position.length / 3)
  })
  test('rejects truncated buffers and incompatible headers before GPU upload', () => {
    const buffer = fixture()
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
})
