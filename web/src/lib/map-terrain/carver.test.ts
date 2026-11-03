import { describe, expect, test, vi } from 'vitest'
import { TerrainCarver, type Carving } from './carver'

/** A loaded elevation tile: just what the carver touches of MapLibre's. */
function demTile(z: number, x: number, y: number) {
  const dim = 4
  const dem = {
    dim, min: 20,
    data: new Uint8Array((dim + 4) ** 2 * 4),
    _idx: (px: number, py: number) => (py + 2) * (dim + 4) + px + 2,
    get: () => 20,
    pack: () => ({ r: 0, g: 0, b: 0 }),
  }
  return { tileID: { canonical: { z, x, y }, key: `${z}/${x}/${y}` }, dem }
}

function fakeMap(tiles: ReturnType<typeof demTile>[]) {
  const refreshTiles = vi.fn()
  return {
    refreshTiles,
    triggerRepaint: vi.fn(),
    terrain: { tileManager: { tileManager: { refreshTiles, _inViewTiles: { getAllTiles: () => tiles } } } },
  }
}

/** A carving over the whole world that writes `metres` at pixel (0, 0), recording the order it ran in. */
const writes = (metres: number, log: number[]): Carving => ({
  bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  carve: tile => {
    log.push(metres)
    tile.set(0, 0, metres)
    return true
  },
})

describe('TerrainCarver', () => {
  test('carves every owner\'s shapes, lowest rank first', () => {
    const tile = demTile(14, 1, 1)
    const map = fakeMap([tile])
    const carver = new TerrainCarver(() => map)
    const log: number[] = []
    carver.set('tunnels', new Map([['cut', writes(5, log)]]), { rank: 1 })
    carver.set('landmarks', new Map([['fill', writes(15, log)]]))
    carver.carveTiles()
    expect(log).toEqual([15, 5])
    expect(carver.size).toBe(2)
  })

  test('keeps one owner\'s shapes when another\'s change or go', () => {
    const map = fakeMap([demTile(14, 1, 1)])
    const carver = new TerrainCarver(() => map)
    const log: number[] = []
    carver.set('tunnels', new Map([['cut', writes(5, log)]]), { rank: 1 })
    carver.set('landmarks', new Map([['fill', writes(15, log)]]))
    carver.clear('landmarks')
    expect(carver.size).toBe(1)
    // Only the ground under what went is loaded afresh, so the rest keeps its carving.
    expect(map.refreshTiles).toHaveBeenCalledTimes(1)
    carver.carveTiles()
    expect(log).toEqual([5])
  })

  test('asks for finer terrain only for the owners that want it, under each', () => {
    const focus = vi.fn()
    const carver = new TerrainCarver(() => fakeMap([]), focus)
    carver.set('landmarks', new Map([['fill', writes(15, [])]]))
    expect(focus).not.toHaveBeenCalled()
    carver.set('tunnels', new Map([['cut', writes(5, [])]]), { rank: 1, focus: true })
    expect(focus).toHaveBeenCalledWith([{ minX: 0, minY: 0, maxX: 1, maxY: 1 }], 'tunnels')
    carver.clear('tunnels')
    expect(focus).toHaveBeenLastCalledWith([], 'tunnels')
  })

  test('carves a tile once a round', () => {
    const map = fakeMap([demTile(14, 1, 1)])
    const carver = new TerrainCarver(() => map)
    const log: number[] = []
    carver.set('landmarks', new Map([['fill', writes(15, log)]]))
    carver.carveTiles()
    carver.carveTiles()
    expect(log).toEqual([15])
  })
})
