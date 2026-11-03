import { expect, test } from 'vitest'
import { deckCover, type CoverInputs } from './cover'

const view = (over: Partial<CoverInputs>): CoverInputs => ({ missing: false, failed: false, wanted: 3, resident: 3, settled: true, ...over })

test('covers once every wanted mesh is drawable', () => {
  expect(deckCover(false, view({}))).toBe(true)
  expect(deckCover(false, view({ resident: 2 }))).toBe(false)
})

test('a deck coming into view keeps the cover while its mesh loads', () => {
  expect(deckCover(true, view({ resident: 2 }))).toBe(true)
})

test('a view with none of its decks loaded shows the flat bridges', () => {
  expect(deckCover(true, view({ resident: 0 }))).toBe(false)
})

test('a deck without a mesh, or a failed one, falls back to flat bridges', () => {
  expect(deckCover(true, view({ missing: true }))).toBe(false)
  expect(deckCover(true, view({ failed: true }))).toBe(false)
})

test('an empty view uncovers only once its deck tiles have loaded', () => {
  expect(deckCover(true, view({ wanted: 0, resident: 0, settled: false }))).toBe(true)
  expect(deckCover(true, view({ wanted: 0, resident: 0 }))).toBe(false)
})
