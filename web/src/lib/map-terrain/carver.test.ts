import { describe, expect, test, vi } from 'vitest'
import { TerrainCarver, type Carving } from './carver'

/** A loaded elevation tile: just what the carver touches of MapLibre's. */
function demTile(z: number, x: number, y: number) {
  const dim = 4
  const data = new Uint8Array((dim + 4) ** 2 * 4)
  for (let i = 0; i < data.length; i += 4) data[i] = 20
  const dem = {
    dim, min: 20,
    data,
    _idx: (px: number, py: number) => (py + 2) * (dim + 4) + px + 2,
    getUnpackVector: () => [1, 0, 0, 0],
    pack: (v: number) => ({ r: v, g: 0, b: 0 }),
    backfillBorder: vi.fn(),
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

  test('carves a widened shape over the ground it already levelled instead of reloading it', () => {
    const map = fakeMap([demTile(14, 1, 1)])
    const carver = new TerrainCarver(() => map)
    const small = { bounds: { minX: 0.2, minY: 0.2, maxX: 0.4, maxY: 0.4 }, carve: () => true }
    const large = { bounds: { minX: 0.1, minY: 0.1, maxX: 0.5, maxY: 0.5 }, carve: () => true }
    carver.set('indoor', new Map([['small', small]]), { widens: true })
    carver.set('indoor', new Map([['large', large]]), { widens: true })
    expect(map.refreshTiles).not.toHaveBeenCalled()
    carver.set('indoor', new Map(), { widens: true })
    expect(map.refreshTiles).toHaveBeenCalledTimes(1)
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

  test('copies an arriving tile\'s carved edge into its neighbours rather than carving them again', () => {
    const arriving = demTile(14, 1, 1)
    const beside = demTile(14, 2, 1)
    const far = demTile(14, 5, 1)
    const map = fakeMap([arriving, beside, far])
    const carver = new TerrainCarver(() => map)
    const log: number[] = []
    carver.set('landmarks', new Map([['fill', writes(15, log)]]))
    carver.carveTiles()
    expect(log).toEqual([15, 15, 15])
    carver.recarveAround(arriving)
    carver.carveTiles()
    expect(log).toEqual([15, 15, 15, 15])
    expect(beside.dem.backfillBorder).toHaveBeenCalledWith(arriving.dem, -1, 0)
    expect(far.dem.backfillBorder).not.toHaveBeenCalled()
  })

  test('reads and writes metres through the tile\'s own encoding', () => {
    const tile = demTile(14, 1, 1)
    const carver = new TerrainCarver(() => fakeMap([tile]))
    const seen: number[] = []
    carver.set('landmarks', new Map([['fill', { bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, carve: t => { seen.push(t.get(1, 1)); t.set(1, 1, 7); seen.push(t.get(1, 1)); return true } }]]))
    carver.carveTiles()
    expect(seen).toEqual([20, 7])
  })
})
