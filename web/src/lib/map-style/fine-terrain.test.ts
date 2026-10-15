import { describe, test, expect } from 'vitest'
import { decodeHeights, sampleHeights, type Heights } from '@/lib/map-decks/ground'
import { encodeTerrarium, upsample } from './fine-terrain'

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
