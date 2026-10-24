import { describe, expect, test } from 'vitest'
import { INDEX_ZOOM, indexTiles, parseIndex } from './mesh-index'
import { mercator } from '../decks'

describe('deck mesh indexes', () => {
  test('each listed mesh comes with its deck\'s bounds, grown as the detail tiles\' decks are', () => {
    const file = `${'ab'.repeat(32)}.brm`
    const [entry, ...rest] = parseIndex({ decks: [[file, -74, 40.7, -73.99, 40.71], ['../secret', 0, 0, 1, 1], [file, 'x', 0, 1, 1]] })
    expect(rest).toEqual([])
    expect(entry.file).toBe(file)
    const [w, n] = mercator([-74, 40.71]), [e, s] = mercator([-73.99, 40.7])
    expect(entry.bounds.minX).toBeLessThan(w)
    expect(entry.bounds.maxX).toBeGreaterThan(e)
    expect(entry.bounds.minY).toBeLessThan(n)
    expect(entry.bounds.maxY).toBeGreaterThan(s)
  })

  test('anything but an index is refused', () => {
    expect(() => parseIndex({ nope: [] })).toThrow()
  })

  test('the tiles a view meets, and none for a view too far out', () => {
    const n = 2 ** INDEX_ZOOM
    expect(indexTiles({ minX: 100.2 / n, minY: 200.9 / n, maxX: 101.1 / n, maxY: 201.5 / n })).toEqual(['100/200', '100/201', '101/200', '101/201'])
    expect(indexTiles({ minX: 0, minY: 0, maxX: 10 / n, maxY: 10 / n })).toEqual([])
  })
})
