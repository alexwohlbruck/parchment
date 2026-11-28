import { describe, expect, it, vi } from 'vitest'
import { sourceFeatures, sourceTileFeatureSteps, sourceTileFeatures } from './source-features'

function tile(key: string, features: any[]) {
  return {
    tileID: { canonical: { key } },
    latestFeatureIndex: { rawTileData: new ArrayBuffer(1) },
    querySourceFeatures: vi.fn((out: any[], { range }: { range: [number, number] }) => {
      out.push(...features.slice(...range).map(f => ({ ...f })))
      return features.length
    }),
  }
}

const mapOf = (tiles: any[]) => ({
  style: { tileManagers: { detail: { getRenderableIds: () => tiles.map((_, i) => i), getTileByID: (i: number) => tiles[i] } } },
})

describe('sourceFeatures', () => {
  it('reads a tile once and hands back the same features until it reloads', () => {
    const a = tile('a', [{ id: 1 }])
    const map = mapOf([a, tile('b', [{ id: 2 }])])
    const first = sourceFeatures(map, 'detail', 'trees')
    const second = sourceFeatures(map, 'detail', 'trees')
    expect(first.map(f => f.id)).toEqual([1, 2])
    expect(second[0]).toBe(first[0])
    expect(a.querySourceFeatures).toHaveBeenCalledTimes(1)

    a.latestFeatureIndex = { rawTileData: new ArrayBuffer(1) }
    expect(sourceFeatures(map, 'detail', 'trees')[0]).not.toBe(first[0])
    expect(a.querySourceFeatures).toHaveBeenCalledTimes(2)
  })

  it('reads a tile drawn at two zooms once, and each source layer apart', () => {
    const a = tile('a', [{ id: 1 }])
    const map = mapOf([a, a])
    expect(sourceFeatures(map, 'detail', 'trees')).toHaveLength(1)
    sourceFeatures(map, 'detail', 'woods')
    expect(a.querySourceFeatures).toHaveBeenCalledTimes(2)
  })

  it('asks the map where its tiles cannot be reached', () => {
    const map = { querySourceFeatures: vi.fn(() => [{ id: 3 }]) }
    expect(sourceFeatures(map, 'detail', 'trees')).toEqual([{ id: 3 }])
    expect(map.querySourceFeatures).toHaveBeenCalledWith('detail', { sourceLayer: 'trees' })
  })

  it('hands back each tile as the same array until that tile reloads', () => {
    const a = tile('a', [{ id: 1 }])
    const b = tile('b', [{ id: 2 }])
    const map = mapOf([a, b])
    const [firstA, firstB] = sourceTileFeatures(map, 'detail', 'poi')
    a.latestFeatureIndex = { rawTileData: new ArrayBuffer(1) }
    const [nextA, nextB] = sourceTileFeatures(map, 'detail', 'poi')
    expect(nextB).toBe(firstB)
    expect(nextA).not.toBe(firstA)
  })

  it('reads a dense tile a chunk a step, and shares the reading between two readers', () => {
    const dense = tile('a', Array.from({ length: 1200 }, (_, id) => ({ id })))
    const map = mapOf([dense])
    const first = sourceTileFeatureSteps(map, 'detail', 'trees')
    expect(first.next().done).toBe(false)
    expect(dense.querySourceFeatures).toHaveBeenCalledTimes(1)

    const [all] = sourceTileFeatures(map, 'detail', 'trees')
    expect(all.map(f => f.id)).toEqual(Array.from({ length: 1200 }, (_, id) => id))
    expect(dense.querySourceFeatures).toHaveBeenCalledTimes(3)

    const done = first.next()
    expect(done.done).toBe(true)
    expect((done.value as any[][])[0]).toBe(all)
    expect(dense.querySourceFeatures).toHaveBeenCalledTimes(3)
  })
})
