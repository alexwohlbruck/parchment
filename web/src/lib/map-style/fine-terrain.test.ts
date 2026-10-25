import { describe, test, expect, vi } from 'vitest'
import { decodeHeights, sampleHeights, type Heights } from '@/lib/map-decks/ground'
import { encodeTerrarium, FineTerrain, upsample } from './fine-terrain'
import type { Bounds } from '@/lib/map-decks/decks'

/** A tile rising 1 m a pixel eastward and 2 m a pixel southward. */
const slope = (size: number): Heights => ({
  size,
  data: Float32Array.from({ length: size * size }, (_, i) => (i % size) + 2 * Math.floor(i / size)),
})

describe('upsample', () => {
  test('keeps the shape of the ground it is cut from', () => {
    const parent = slope(16)
    const child = upsample(parent, 2, [1, 2], 32)
    for (const [u, v] of [[0, 0], [0.5, 0.25], [0.9, 0.9]])
      expect(sampleHeights(child, u, v)).toBeCloseTo(sampleHeights(parent, (1 + u) / 4, (2 + v) / 4), 4)
  })
})

describe('encodeTerrarium', () => {
  test('decodes back to the heights to within a centimetre', () => {
    const heights: Heights = { size: 2, data: Float32Array.from([-12.5, 0, 203.08, 4321.77]) }
    const back = decodeHeights(encodeTerrarium(heights), 2)
    back.data.forEach((h, i) => expect(h).toBeCloseTo(heights.data[i], 2))
  })
})

describe('FineTerrain held tiles', () => {
  const [z, x, y] = [17, 36104, 51820]
  const url = `fine-terrain://${z}/${x}/${y}`
  const over: Bounds = { minX: x / 2 ** z, minY: y / 2 ** z, maxX: (x + 1) / 2 ** z, maxY: (y + 1) / 2 ** z }
  const terrain = () => {
    const fine = new FineTerrain()
    const image = { close: vi.fn() }
    vi.spyOn(fine as any, 'upsample').mockResolvedValue(image)
    return { fine, image }
  }

  test('a tile outside every area is turned away when nothing holds it', async () => {
    const { fine } = terrain()
    await expect(fine.tile(url)).rejects.toMatchObject({ status: 404 })
  })

  test('a held tile is served once the portals around it are known', async () => {
    const { fine, image } = terrain()
    let known: Bounds[] | null = null
    fine.hold(() => known)
    const tile = fine.tile(url)
    known = [over]
    fine.release()
    await expect(tile).resolves.toBe(image)
  })

  test('a held tile no portal reaches is turned away, and its image let go', async () => {
    const { fine, image } = terrain()
    let known: Bounds[] | null = null
    fine.hold(() => known)
    const tile = fine.tile(url)
    known = []
    fine.release()
    await expect(tile).rejects.toMatchObject({ status: 404 })
    expect(image.close).toHaveBeenCalled()
  })
})
