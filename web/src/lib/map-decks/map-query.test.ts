import { describe, expect, test } from 'vitest'
import { hasLayer } from './map-query'

/** A minimal tile: each layer a field-3 message holding only its name. */
function tile(...names: string[]): Uint8Array {
  const parts = names.flatMap(name => {
    const bytes = [...new TextEncoder().encode(name)]
    const layer = [0x0a, bytes.length, ...bytes]
    return [0x1a, layer.length, ...layer]
  })
  return new Uint8Array(parts)
}

describe('hasLayer', () => {
  test('finds a layer by name among the others', () => {
    expect(hasLayer(tile('bridge_decks', 'tunnel_cuts', 'woods'), 'tunnel_cuts')).toBe(true)
    expect(hasLayer(tile('bridge_decks', 'woods').buffer as ArrayBuffer, 'tunnel_cuts')).toBe(false)
  })

  test('takes no name that only starts another', () => {
    expect(hasLayer(tile('tunnel_cuts_old'), 'tunnel_cuts')).toBe(false)
    expect(hasLayer(undefined, 'tunnel_cuts')).toBe(false)
  })
})
