import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { deckField, decodeDeckTile, splitDeckTile } from './deck-tile'
import { deckTile, vectorTile } from './fixtures/deck-tiles'

const brm = new Uint8Array(readFileSync('src/lib/map-decks/baked/fixtures/arched-bridge.brm'))
const file = `${'a'.repeat(64)}.brm`

test('finds the deck pieces after a tile\'s layers, and nothing in a tile without them', () => {
  const payload = deckTile([brm, brm])
  expect([...deckField(vectorTile(payload))!]).toEqual([...payload])
  expect(deckField(vectorTile())).toBeNull()
})

test('decodes each piece of a deck tile as a mesh of its own', () => {
  const { pieces, failed } = decodeDeckTile(deckField(vectorTile(deckTile([brm, brm])))!)
  expect(failed).toEqual([])
  expect(pieces).toHaveLength(2)
  for (const { file: name, mesh } of pieces) {
    expect(name).toBe(file)
    expect(mesh.indices.length).toBe(276)
  }
})

test('splits a deck tile into payloads that decode to the same pieces, in order', () => {
  const payload = deckField(vectorTile(deckTile([brm, brm, brm])))!
  const parts = splitDeckTile(payload, 2)
  expect(parts).toHaveLength(2)
  const pieces = parts.flatMap(part => decodeDeckTile(part).pieces)
  expect(pieces.map(p => p.mesh.indices.length)).toEqual(decodeDeckTile(payload).pieces.map(p => p.mesh.indices.length))
})
