import { describe, test, expect } from 'vitest'
import { decodeHeights, GroundSampler, sampleHeights, type Heights } from './ground'

const flat = (size: number, metres: number | ((x: number, y: number) => number)): Heights => {
  const data = new Float32Array(size * size)
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) data[y * size + x] = typeof metres === 'number' ? metres : metres(x, y)
  return { size, data }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('decodeHeights', () => {
  test('terrarium and Terrain-RGB pixels to metres', () => {
    // 32768 + 212.5 m: r = 128, g = 212, b = 128.
    expect(decodeHeights([128, 212, 128, 255], 1).data[0]).toBeCloseTo(212.5)
    // (r * 65536 + g * 256 + b) * 0.1 - 10000 = 100 m.
    const value = (100 + 10000) / 0.1
    expect(decodeHeights([value >> 16, (value >> 8) & 255, value & 255, 255], 1, 'mapbox').data[0]).toBeCloseTo(100)
  })
})

describe('sampleHeights', () => {
  test('interpolates between pixel corners as MapLibre does, clamped at the far edge', () => {
    const ramp = flat(4, x => x * 10)
    expect(sampleHeights(ramp, 0.5, 0.5)).toBeCloseTo(20)
    expect(sampleHeights(ramp, 0.375, 0.5)).toBeCloseTo(15)
    expect(sampleHeights(ramp, 0, 0.5)).toBeCloseTo(0)
    expect(sampleHeights(ramp, 1, 0.5)).toBeCloseTo(30)
  })
})

describe('GroundSampler', () => {
  test('reads one zoom whatever is asked, null until the tile arrives', async () => {
    const asked: string[] = []
    let loads = 0
    const sampler = new GroundSampler(async (z, x, y) => {
      asked.push(`${z}/${x}/${y}`)
      return flat(4, 50)
    }, { zoom: 2, onLoad: () => loads++ })
    expect(sampler.at([0.3, 0.3])).toBeNull()
    await tick()
    expect(sampler.at([0.3, 0.3])).toBe(50)
    expect(asked).toEqual(['2/1/1'])
    expect(loads).toBe(1)
  })

  test('falls back to a parent where the source has no tile', async () => {
    const sampler = new GroundSampler(async z => (z === 2 ? null : flat(4, z * 100)), { zoom: 2 })
    sampler.at([0.3, 0.3])
    await tick()
    expect(sampler.at([0.3, 0.3])).toBeNull()
    await tick()
    expect(sampler.at([0.3, 0.3])).toBe(100)
  })

  test('NaN where no zoom has a tile', async () => {
    const sampler = new GroundSampler(async () => null, { zoom: 1, minZoom: 0 })
    sampler.at([0.3, 0.3])
    await tick()
    sampler.at([0.3, 0.3])
    await tick()
    expect(sampler.at([0.3, 0.3])).toBeNaN()
  })

  test('a failed fetch is asked again rather than taken for no data', async () => {
    let fail = true
    const sampler = new GroundSampler(async () => {
      if (fail) throw new Error('offline')
      return flat(4, 7)
    }, { zoom: 1 })
    sampler.at([0.1, 0.1])
    await tick()
    fail = false
    expect(sampler.at([0.1, 0.1])).toBeNull()
    await tick()
    expect(sampler.at([0.1, 0.1])).toBe(7)
  })

  test('keeps only the most recently used tiles', async () => {
    const asked: string[] = []
    const sampler = new GroundSampler(async (z, x, y) => {
      asked.push(`${x}/${y}`)
      return flat(4, 1)
    }, { zoom: 2, capacity: 2 })
    const points: Array<[number, number]> = [[0.1, 0.1], [0.3, 0.1], [0.6, 0.1]]
    for (const p of points) {
      sampler.at(p)
      await tick()
    }
    sampler.at(points[0])
    expect(asked).toEqual(['0/0', '1/0', '2/0', '0/0'])
  })
})
